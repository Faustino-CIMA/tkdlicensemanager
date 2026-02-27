from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from .card_rendering import (
    CardRenderError,
    build_preview_data,
    render_card_pdf_bytes,
    render_sheet_pdf_bytes,
)
from .card_serializers import (
    CardFormatPresetSerializer,
    CardPreviewDataSerializer,
    CardPreviewRequestSerializer,
    CardSheetPreviewRequestSerializer,
    CardTemplateCloneSerializer,
    CardTemplateSerializer,
    CardTemplateVersionSerializer,
    MergeFieldSerializer,
    PaperProfileSerializer,
    PrintJobCreateSerializer,
    PrintJobSerializer,
    get_merge_field_registry_payload,
)
from .models import (
    CardFormatPreset,
    CardTemplate,
    CardTemplateVersion,
    FinanceAuditLog,
    PaperProfile,
    PrintJob,
    PrintJobItem,
)
from .tasks import execute_print_job_task


def _is_ltf_admin(user) -> bool:
    return bool(user and user.is_authenticated and user.role == "ltf_admin")


def _is_club_admin(user) -> bool:
    return bool(user and user.is_authenticated and user.role == "club_admin")


class IsLtfAdminOrClubAdminReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if _is_ltf_admin(user):
            return True
        return bool(_is_club_admin(user) and request.method in permissions.SAFE_METHODS)


class IsLtfAdminOrClubAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(_is_ltf_admin(request.user) or _is_club_admin(request.user))


class CardFormatPresetViewSet(viewsets.ModelViewSet):
    serializer_class = CardFormatPresetSerializer
    permission_classes = [IsLtfAdminOrClubAdminReadOnly]
    queryset = CardFormatPreset.objects.all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CardFormatPreset.objects.none()
        user = self.request.user
        if _is_ltf_admin(user):
            return CardFormatPreset.objects.all()
        if _is_club_admin(user):
            return CardFormatPreset.objects.filter(is_active=True)
        return CardFormatPreset.objects.none()


class PaperProfileViewSet(viewsets.ModelViewSet):
    serializer_class = PaperProfileSerializer
    permission_classes = [IsLtfAdminOrClubAdminReadOnly]
    queryset = PaperProfile.objects.select_related("card_format").all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PaperProfile.objects.none()
        user = self.request.user
        if _is_ltf_admin(user):
            return PaperProfile.objects.select_related("card_format").all()
        if _is_club_admin(user):
            return PaperProfile.objects.select_related("card_format").filter(is_active=True)
        return PaperProfile.objects.none()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)


class CardTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = CardTemplateSerializer
    permission_classes = [IsLtfAdminOrClubAdminReadOnly]
    queryset = CardTemplate.objects.prefetch_related("versions").all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CardTemplate.objects.none()
        user = self.request.user
        if _is_ltf_admin(user):
            return CardTemplate.objects.prefetch_related("versions").all()
        if _is_club_admin(user):
            return (
                CardTemplate.objects.prefetch_related("versions")
                .filter(is_active=True, versions__status=CardTemplateVersion.Status.PUBLISHED)
                .distinct()
            )
        return CardTemplate.objects.none()

    def perform_create(self, serializer):
        serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None,
            updated_by=self.request.user if self.request.user.is_authenticated else None,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user if self.request.user.is_authenticated else None)

    @extend_schema(request=None, responses=CardTemplateSerializer)
    @action(detail=True, methods=["post"], url_path="set-default")
    def set_default(self, request, pk=None):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can set the default template.")
        template = self.get_object()
        with transaction.atomic():
            CardTemplate.objects.filter(is_default=True).exclude(pk=template.pk).update(
                is_default=False
            )
            template.is_default = True
            template.updated_by = request.user
            template.save(update_fields=["is_default", "updated_by", "updated_at"])
        return Response(self.get_serializer(template).data, status=status.HTTP_200_OK)

    @extend_schema(request=CardTemplateCloneSerializer, responses=CardTemplateSerializer)
    @action(detail=True, methods=["post"], url_path="clone")
    def clone(self, request, pk=None):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can clone templates.")
        template = self.get_object()
        serializer = CardTemplateCloneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        source_version_id = serializer.validated_data.get("source_version_id")
        source_version = None
        if source_version_id is not None:
            source_version = template.versions.filter(pk=source_version_id).first()
            if source_version is None:
                raise serializers.ValidationError(
                    {"source_version_id": "Source version does not belong to this template."}
                )
        if source_version is None:
            source_version = template.versions.order_by("-version_number").first()
        if source_version is None:
            raise serializers.ValidationError(
                {"detail": "Template must have at least one version to clone."}
            )

        with transaction.atomic():
            cloned_template = CardTemplate.objects.create(
                name=serializer.validated_data["name"],
                description=serializer.validated_data.get("description", template.description),
                is_default=False,
                is_active=True,
                created_by=request.user if request.user.is_authenticated else None,
                updated_by=request.user if request.user.is_authenticated else None,
            )
            CardTemplateVersion.objects.create(
                template=cloned_template,
                version_number=1,
                label=source_version.label,
                status=CardTemplateVersion.Status.DRAFT,
                card_format=source_version.card_format,
                paper_profile=source_version.paper_profile,
                design_payload=source_version.design_payload,
                notes=source_version.notes,
                created_by=request.user if request.user.is_authenticated else None,
            )
        return Response(
            CardTemplateSerializer(cloned_template).data,
            status=status.HTTP_201_CREATED,
        )


class CardTemplateVersionViewSet(viewsets.ModelViewSet):
    serializer_class = CardTemplateVersionSerializer
    permission_classes = [IsLtfAdminOrClubAdminReadOnly]
    queryset = CardTemplateVersion.objects.select_related(
        "template", "card_format", "paper_profile"
    ).all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CardTemplateVersion.objects.none()
        user = self.request.user
        if _is_ltf_admin(user):
            queryset = CardTemplateVersion.objects.select_related(
                "template", "card_format", "paper_profile"
            ).all()
        elif _is_club_admin(user):
            queryset = CardTemplateVersion.objects.select_related(
                "template", "card_format", "paper_profile"
            ).filter(status=CardTemplateVersion.Status.PUBLISHED, template__is_active=True)
        else:
            queryset = CardTemplateVersion.objects.none()
        template_id = self.request.query_params.get("template_id")
        if template_id:
            queryset = queryset.filter(template_id=template_id)
        return queryset

    def _ensure_ltf_admin_preview_access(self, request) -> None:
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can generate template previews.")

    def perform_create(self, serializer):
        if not _is_ltf_admin(self.request.user):
            raise PermissionDenied("Only LTF Admin can create template versions.")
        template = serializer.validated_data["template"]
        max_version = (
            template.versions.aggregate(max_value=Max("version_number")).get("max_value") or 0
        )
        serializer.save(
            version_number=max_version + 1,
            status=CardTemplateVersion.Status.DRAFT,
            created_by=self.request.user if self.request.user.is_authenticated else None,
        )

    def perform_update(self, serializer):
        if not _is_ltf_admin(self.request.user):
            raise PermissionDenied("Only LTF Admin can update template versions.")
        instance = serializer.instance
        if instance.status != CardTemplateVersion.Status.DRAFT:
            raise serializers.ValidationError("Only draft versions can be edited.")
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can delete template versions.")
        instance = self.get_object()
        if instance.status != CardTemplateVersion.Status.DRAFT:
            return Response(
                {"detail": "Only draft versions can be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @extend_schema(request=None, responses=CardTemplateVersionSerializer)
    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request, pk=None):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can publish template versions.")
        version = self.get_object()
        if version.status == CardTemplateVersion.Status.PUBLISHED:
            return Response(self.get_serializer(version).data, status=status.HTTP_200_OK)

        if version.status != CardTemplateVersion.Status.DRAFT:
            return Response(
                {"detail": "Only draft versions can be published."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        version.status = CardTemplateVersion.Status.PUBLISHED
        version.published_at = timezone.now()
        version.published_by = request.user if request.user.is_authenticated else None
        version.save(update_fields=["status", "published_at", "published_by", "updated_at"])
        return Response(self.get_serializer(version).data, status=status.HTTP_200_OK)

    @extend_schema(request=CardSheetPreviewRequestSerializer, responses=CardPreviewDataSerializer)
    @action(detail=True, methods=["post"], url_path="preview-data")
    def preview_data(self, request, pk=None):
        self._ensure_ltf_admin_preview_access(request)
        version = self.get_object()
        serializer = CardSheetPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            preview_payload = build_preview_data(
                template_version=version,
                member_id=serializer.validated_data.get("member_id"),
                license_id=serializer.validated_data.get("license_id"),
                club_id=serializer.validated_data.get("club_id"),
                sample_data=serializer.validated_data.get("sample_data") or {},
                include_bleed_guide=serializer.validated_data.get("include_bleed_guide", False),
                include_safe_area_guide=serializer.validated_data.get(
                    "include_safe_area_guide", False
                ),
                bleed_mm=serializer.validated_data.get("bleed_mm", "2.00"),
                safe_area_mm=serializer.validated_data.get("safe_area_mm", "3.00"),
                paper_profile_id=serializer.validated_data.get("paper_profile_id"),
                selected_slots=serializer.validated_data.get("selected_slots"),
                request=request,
            )
        except CardRenderError as exc:
            return Response({"detail": exc.detail}, status=exc.status_code)
        return Response(preview_payload, status=status.HTTP_200_OK)

    @extend_schema(
        request=CardPreviewRequestSerializer,
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Card preview PDF.",
            )
        },
    )
    @action(detail=True, methods=["post"], url_path="preview-card-pdf")
    def preview_card_pdf(self, request, pk=None):
        self._ensure_ltf_admin_preview_access(request)
        version = self.get_object()
        serializer = CardPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            preview_payload = build_preview_data(
                template_version=version,
                member_id=serializer.validated_data.get("member_id"),
                license_id=serializer.validated_data.get("license_id"),
                club_id=serializer.validated_data.get("club_id"),
                sample_data=serializer.validated_data.get("sample_data") or {},
                include_bleed_guide=serializer.validated_data.get("include_bleed_guide", False),
                include_safe_area_guide=serializer.validated_data.get(
                    "include_safe_area_guide", False
                ),
                bleed_mm=serializer.validated_data.get("bleed_mm", "2.00"),
                safe_area_mm=serializer.validated_data.get("safe_area_mm", "3.00"),
                request=request,
            )
            pdf_bytes = render_card_pdf_bytes(
                preview_payload,
                base_url=request.build_absolute_uri("/"),
            )
        except CardRenderError as exc:
            return Response({"detail": exc.detail}, status=exc.status_code)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="card-preview-v{version.id}.pdf"'
        return response

    @extend_schema(
        request=CardSheetPreviewRequestSerializer,
        responses={
            200: OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Sheet preview PDF.",
            )
        },
    )
    @action(detail=True, methods=["post"], url_path="preview-sheet-pdf")
    def preview_sheet_pdf(self, request, pk=None):
        self._ensure_ltf_admin_preview_access(request)
        version = self.get_object()
        serializer = CardSheetPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            preview_payload = build_preview_data(
                template_version=version,
                member_id=serializer.validated_data.get("member_id"),
                license_id=serializer.validated_data.get("license_id"),
                club_id=serializer.validated_data.get("club_id"),
                sample_data=serializer.validated_data.get("sample_data") or {},
                include_bleed_guide=serializer.validated_data.get("include_bleed_guide", False),
                include_safe_area_guide=serializer.validated_data.get(
                    "include_safe_area_guide", False
                ),
                bleed_mm=serializer.validated_data.get("bleed_mm", "2.00"),
                safe_area_mm=serializer.validated_data.get("safe_area_mm", "3.00"),
                paper_profile_id=serializer.validated_data.get("paper_profile_id"),
                selected_slots=serializer.validated_data.get("selected_slots"),
                request=request,
            )
            pdf_bytes = render_sheet_pdf_bytes(
                preview_payload,
                base_url=request.build_absolute_uri("/"),
            )
        except CardRenderError as exc:
            return Response({"detail": exc.detail}, status=exc.status_code)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="sheet-preview-v{version.id}.pdf"'
        return response


class PrintJobViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = PrintJobSerializer
    permission_classes = [IsLtfAdminOrClubAdmin]
    queryset = PrintJob.objects.select_related(
        "club",
        "template_version",
        "template_version__card_format",
        "paper_profile",
        "requested_by",
        "executed_by",
    ).prefetch_related("items").all()

    def get_serializer_class(self):
        if self.action == "create":
            return PrintJobCreateSerializer
        return PrintJobSerializer

    def _ensure_club_admin_scope(self, user, print_job: PrintJob) -> None:
        if _is_ltf_admin(user):
            return
        if _is_club_admin(user) and print_job.club.admins.filter(id=user.id).exists():
            return
        raise PermissionDenied("Club Admin can only access print jobs for own club.")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PrintJob.objects.none()
        user = self.request.user
        base_queryset = PrintJob.objects.select_related(
            "club",
            "template_version",
            "template_version__card_format",
            "paper_profile",
            "requested_by",
            "executed_by",
        ).prefetch_related("items")
        if _is_ltf_admin(user):
            return base_queryset.all()
        if _is_club_admin(user):
            object_actions = {"retrieve", "execute", "retry", "cancel", "pdf"}
            if self.action in object_actions:
                return base_queryset.all()
            return base_queryset.filter(club__admins=user)
        return PrintJob.objects.none()

    @extend_schema(request=PrintJobCreateSerializer, responses=PrintJobSerializer)
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        club = serializer.validated_data["club"]
        if _is_club_admin(user) and not club.admins.filter(id=user.id).exists():
            raise PermissionDenied("Club Admin can only create print jobs for own club.")

        template_version = serializer.validated_data["template_version"]
        resolved_paper_profile = serializer.validated_data["resolved_paper_profile"]
        resolved_items = serializer.validated_data["resolved_items"]
        selected_slots = serializer.validated_data.get("selected_slots") or []
        metadata = serializer.validated_data.get("metadata") or {}

        with transaction.atomic():
            print_job = PrintJob.objects.create(
                club=club,
                template_version=template_version,
                paper_profile=resolved_paper_profile,
                status=PrintJob.Status.DRAFT,
                total_items=len(resolved_items),
                selected_slots=selected_slots,
                include_bleed_guide=serializer.validated_data.get("include_bleed_guide", False),
                include_safe_area_guide=serializer.validated_data.get(
                    "include_safe_area_guide", False
                ),
                bleed_mm=serializer.validated_data.get("bleed_mm", "2.00"),
                safe_area_mm=serializer.validated_data.get("safe_area_mm", "3.00"),
                metadata=metadata,
                requested_by=user if user.is_authenticated else None,
            )
            print_items: list[PrintJobItem] = []
            for index, item_payload in enumerate(resolved_items):
                slot_index = selected_slots[index] if selected_slots else index
                print_items.append(
                    PrintJobItem(
                        print_job=print_job,
                        member=item_payload["member"],
                        license=item_payload["license"],
                        quantity=1,
                        slot_index=slot_index,
                        status=PrintJobItem.Status.PENDING,
                    )
                )
            PrintJobItem.objects.bulk_create(print_items)
            FinanceAuditLog.objects.create(
                action="print_job.created",
                message="Print job created.",
                actor=user if user.is_authenticated else None,
                club=club,
                metadata={
                    "print_job_id": print_job.id,
                    "item_count": len(resolved_items),
                    "selected_slots": selected_slots,
                },
            )

        response_serializer = PrintJobSerializer(print_job, context={"request": request})
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        print_job = self.get_object()
        self._ensure_club_admin_scope(request.user, print_job)
        serializer = PrintJobSerializer(print_job, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    def _queue_print_job(
        self,
        *,
        request,
        print_job: PrintJob,
        allow_statuses: set[str],
        audit_action: str,
    ) -> tuple[PrintJob, int]:
        user = request.user if request.user.is_authenticated else None
        with transaction.atomic():
            locked_job = (
                PrintJob.objects.select_for_update()
                .select_related("club")
                .get(id=print_job.id)
            )
            if locked_job.status == PrintJob.Status.SUCCEEDED and locked_job.artifact_pdf:
                return locked_job, status.HTTP_200_OK
            if locked_job.status in {PrintJob.Status.QUEUED, PrintJob.Status.RUNNING}:
                return locked_job, status.HTTP_202_ACCEPTED
            if locked_job.status not in allow_statuses:
                raise serializers.ValidationError(
                    {"detail": f"Print job cannot be queued from status '{locked_job.status}'."}
                )

            locked_job.status = PrintJob.Status.QUEUED
            locked_job.queued_at = timezone.now()
            locked_job.finished_at = None
            locked_job.cancelled_at = None
            locked_job.error_detail = ""
            locked_job.last_error_at = None
            if user and locked_job.executed_by_id is None:
                locked_job.executed_by = user
            locked_job.save(
                update_fields=[
                    "status",
                    "queued_at",
                    "finished_at",
                    "cancelled_at",
                    "error_detail",
                    "last_error_at",
                    "executed_by",
                    "updated_at",
                ]
            )
            FinanceAuditLog.objects.create(
                action=f"print_job.{audit_action}",
                message="Print job queued for execution.",
                actor=user,
                club=locked_job.club,
                metadata={"print_job_id": locked_job.id},
            )

        execute_print_job_task.delay(
            locked_job.id,
            user.id if user is not None else None,
        )
        return locked_job, status.HTTP_202_ACCEPTED

    @extend_schema(request=None, responses=PrintJobSerializer)
    @action(detail=True, methods=["post"], url_path="execute")
    def execute(self, request, pk=None):
        print_job = self.get_object()
        self._ensure_club_admin_scope(request.user, print_job)
        if print_job.status == PrintJob.Status.CANCELLED:
            return Response(
                {"detail": "Cancelled print jobs must be retried, not executed directly."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        queued_job, response_status = self._queue_print_job(
            request=request,
            print_job=print_job,
            allow_statuses={PrintJob.Status.DRAFT, PrintJob.Status.FAILED},
            audit_action="execute_queued",
        )
        payload = PrintJobSerializer(queued_job, context={"request": request}).data
        return Response(payload, status=response_status)

    @extend_schema(request=None, responses=PrintJobSerializer)
    @action(detail=True, methods=["post"], url_path="retry")
    def retry(self, request, pk=None):
        print_job = self.get_object()
        self._ensure_club_admin_scope(request.user, print_job)
        queued_job, response_status = self._queue_print_job(
            request=request,
            print_job=print_job,
            allow_statuses={PrintJob.Status.FAILED, PrintJob.Status.CANCELLED},
            audit_action="retry_queued",
        )
        payload = PrintJobSerializer(queued_job, context={"request": request}).data
        return Response(payload, status=response_status)

    @extend_schema(request=None, responses=PrintJobSerializer)
    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        print_job = self.get_object()
        self._ensure_club_admin_scope(request.user, print_job)
        if print_job.status == PrintJob.Status.SUCCEEDED:
            return Response(
                {"detail": "Cannot cancel a succeeded print job."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if print_job.status == PrintJob.Status.CANCELLED:
            payload = PrintJobSerializer(print_job, context={"request": request}).data
            return Response(payload, status=status.HTTP_200_OK)

        with transaction.atomic():
            locked_job = (
                PrintJob.objects.select_for_update()
                .select_related("club")
                .get(id=print_job.id)
            )
            if locked_job.status != PrintJob.Status.CANCELLED:
                locked_job.status = PrintJob.Status.CANCELLED
                locked_job.cancelled_at = timezone.now()
                locked_job.finished_at = timezone.now()
                locked_job.save(
                    update_fields=[
                        "status",
                        "cancelled_at",
                        "finished_at",
                        "updated_at",
                    ]
                )
                locked_job.items.filter(status=PrintJobItem.Status.PENDING).update(
                    status=PrintJobItem.Status.FAILED
                )
                FinanceAuditLog.objects.create(
                    action="print_job.cancelled",
                    message="Print job cancelled.",
                    actor=request.user if request.user.is_authenticated else None,
                    club=locked_job.club,
                    metadata={"print_job_id": locked_job.id},
                )
        locked_job = PrintJob.objects.get(id=print_job.id)
        payload = PrintJobSerializer(locked_job, context={"request": request}).data
        return Response(payload, status=status.HTTP_200_OK)

    @extend_schema(
        responses={
            200: OpenApiResponse(response=OpenApiTypes.BINARY, description="Rendered print job PDF.")
        }
    )
    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        print_job = self.get_object()
        self._ensure_club_admin_scope(request.user, print_job)
        if print_job.status != PrintJob.Status.SUCCEEDED or not print_job.artifact_pdf:
            return Response(
                {"detail": "Print job PDF artifact is not available yet."},
                status=status.HTTP_404_NOT_FOUND,
            )
        artifact_stream = print_job.artifact_pdf.open("rb")
        response = FileResponse(artifact_stream, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="{print_job.job_number.lower()}-artifact.pdf"'
        )
        if print_job.artifact_size_bytes:
            response["Content-Length"] = str(print_job.artifact_size_bytes)
        return response


class MergeFieldRegistryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=MergeFieldSerializer(many=True))
    def get(self, request):
        if not (_is_ltf_admin(request.user) or _is_club_admin(request.user)):
            raise PermissionDenied("Not allowed.")
        return Response(get_merge_field_registry_payload(), status=status.HTTP_200_OK)
