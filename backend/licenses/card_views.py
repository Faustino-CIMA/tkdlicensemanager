from __future__ import annotations

from datetime import datetime

from django.conf import settings
from django.db import transaction
from django.db.models import Max, Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from config.pagination import OptionalPaginationListMixin

from clubs.models import Club
from members.models import Member

from .card_rendering import (
    CardRenderError,
    build_card_simulation_payload,
    build_preview_data,
    render_card_pdf_bytes,
    render_sheet_pdf_bytes,
)
from .card_serializers import (
    CardFormatPresetSerializer,
    CardPreviewDataSerializer,
    CardPreviewHtmlSerializer,
    CardPreviewRequestSerializer,
    CardSheetPreviewRequestSerializer,
    CardDesignerLookupItemSerializer,
    CardFontAssetSerializer,
    CardImageAssetSerializer,
    CardTemplateCloneSerializer,
    CardTemplateDeleteResultSerializer,
    CardTemplateDeleteSerializer,
    CardTemplateSerializer,
    CardTemplateVersionSerializer,
    MergeFieldSerializer,
    PaperProfileSerializer,
    PrintJobCreateSerializer,
    PrintJobHistoryEventSerializer,
    PrintJobSerializer,
    get_merge_field_registry_payload,
)
from .models import (
    CardFormatPreset,
    CardFontAsset,
    CardImageAsset,
    CardTemplate,
    CardTemplateVersion,
    FinanceAuditLog,
    License,
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


class IsLtfAdminOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(_is_ltf_admin(request.user))


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

    def destroy(self, request, *args, **kwargs):
        return Response(
            {
                "detail": (
                    "Use POST /api/card-templates/{id}/delete/ with confirm_name for safe deletion."
                )
            },
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def _audit_template_event(
        self,
        *,
        template_id: int,
        template_name: str,
        action: str,
        message: str,
        metadata: dict | None = None,
    ) -> None:
        FinanceAuditLog.objects.create(
            action=f"card_template.{action}",
            message=message,
            actor=self.request.user if self.request.user.is_authenticated else None,
            metadata={
                "template_id": template_id,
                "template_name": template_name,
                **(metadata or {}),
            },
        )

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

    @extend_schema(
        request=CardTemplateDeleteSerializer,
        responses=CardTemplateDeleteResultSerializer,
    )
    @action(detail=True, methods=["post"], url_path="delete")
    def delete_template(self, request, pk=None):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can delete templates.")

        template = self.get_object()
        serializer = CardTemplateDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        confirm_name = serializer.validated_data["confirm_name"].strip()
        if confirm_name != template.name:
            raise serializers.ValidationError(
                {"confirm_name": "confirm_name must exactly match the template name."}
            )

        requested_mode = str(serializer.validated_data["mode"])
        applied_mode = requested_mode
        was_default = bool(template.is_default)
        referenced_by_print_jobs = False
        deleted = False
        deactivated = False
        reassigned_default_template_id: int | None = None
        rejection_detail: str | None = None
        rejection_action: str | None = None

        template_id = int(template.id)
        template_name = str(template.name)

        with transaction.atomic():
            locked_template = CardTemplate.objects.select_for_update().get(id=template_id)
            was_default = bool(locked_template.is_default)
            referenced_by_print_jobs = PrintJob.objects.filter(
                template_version__template_id=locked_template.id
            ).exists()

            if requested_mode == CardTemplateDeleteSerializer.DeleteMode.AUTO:
                applied_mode = (
                    CardTemplateDeleteSerializer.DeleteMode.SOFT
                    if was_default or referenced_by_print_jobs
                    else CardTemplateDeleteSerializer.DeleteMode.HARD
                )

            if applied_mode == CardTemplateDeleteSerializer.DeleteMode.HARD:
                if was_default:
                    rejection_detail = (
                        "Default template cannot be hard deleted. Use mode 'auto' or 'soft'."
                    )
                    rejection_action = "delete_rejected_default"
                elif referenced_by_print_jobs:
                    rejection_detail = (
                        "Template referenced by print jobs cannot be hard deleted. "
                        "Use mode 'auto' or 'soft'."
                    )
                    rejection_action = "delete_rejected_referenced"

                if rejection_detail is None:
                    locked_template.delete()
                    deleted = True
            else:
                update_fields = ["updated_at"]
                if locked_template.is_active:
                    locked_template.is_active = False
                    deactivated = True
                    update_fields.append("is_active")
                if locked_template.is_default:
                    locked_template.is_default = False
                    update_fields.append("is_default")
                if request.user.is_authenticated:
                    locked_template.updated_by = request.user
                    update_fields.append("updated_by")
                if len(update_fields) > 1:
                    locked_template.save(update_fields=update_fields)

                if was_default:
                    fallback_template = (
                        CardTemplate.objects.select_for_update()
                        .filter(is_active=True)
                        .exclude(id=locked_template.id)
                        .order_by("name", "-created_at")
                        .first()
                    )
                    if fallback_template is not None and not fallback_template.is_default:
                        CardTemplate.objects.filter(is_default=True).exclude(
                            id=fallback_template.id
                        ).update(is_default=False)
                        fallback_template.is_default = True
                        if request.user.is_authenticated:
                            fallback_template.updated_by = request.user
                            fallback_template.save(
                                update_fields=["is_default", "updated_by", "updated_at"]
                            )
                        else:
                            fallback_template.save(update_fields=["is_default", "updated_at"])
                    if fallback_template is not None:
                        reassigned_default_template_id = int(fallback_template.id)

        if rejection_detail is not None and rejection_action is not None:
            self._audit_template_event(
                template_id=template_id,
                template_name=template_name,
                action=rejection_action,
                message=rejection_detail,
                metadata={
                    "requested_mode": requested_mode,
                    "applied_mode": applied_mode,
                    "referenced_by_print_jobs": referenced_by_print_jobs,
                },
            )
            raise serializers.ValidationError({"detail": rejection_detail})

        self._audit_template_event(
            template_id=template_id,
            template_name=template_name,
            action="deleted_hard" if deleted else "deleted_soft",
            message="Card template deleted." if deleted else "Card template deactivated.",
            metadata={
                "requested_mode": requested_mode,
                "applied_mode": applied_mode,
                "referenced_by_print_jobs": referenced_by_print_jobs,
                "was_default": was_default,
                "deleted": deleted,
                "deactivated": deactivated,
                "reassigned_default_template_id": reassigned_default_template_id,
            },
        )
        result_payload = {
            "template_id": template_id,
            "template_name": template_name,
            "requested_mode": requested_mode,
            "applied_mode": applied_mode,
            "referenced_by_print_jobs": referenced_by_print_jobs,
            "was_default": was_default,
            "deleted": deleted,
            "deactivated": deactivated,
            "reassigned_default_template_id": reassigned_default_template_id,
        }
        return Response(result_payload, status=status.HTTP_200_OK)

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
                side=serializer.validated_data.get("side", "front"),
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
                side=serializer.validated_data.get("side", "front"),
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
                side=serializer.validated_data.get("side", "front"),
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

    @extend_schema(request=CardPreviewRequestSerializer, responses=CardPreviewHtmlSerializer)
    @action(detail=True, methods=["post"], url_path="preview-card-html")
    def preview_card_html(self, request, pk=None):
        self._ensure_ltf_admin_preview_access(request)
        version = self.get_object()
        serializer = CardPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            preview_payload = build_preview_data(
                template_version=version,
                side=serializer.validated_data.get("side", "front"),
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
            simulation_payload = build_card_simulation_payload(preview_payload)
        except CardRenderError as exc:
            return Response({"detail": exc.detail}, status=exc.status_code)

        response_payload = {
            "template_version_id": preview_payload["template_version_id"],
            "template_id": preview_payload["template_id"],
            "active_side": preview_payload.get("active_side", "front"),
            "available_sides": preview_payload.get("available_sides", ["front"]),
            "side_summary": preview_payload.get("side_summary", {}),
            "card_format": preview_payload["card_format"],
            "render_metadata": preview_payload.get("render_metadata", {}),
            "html": simulation_payload["html"],
            "css": simulation_payload["css"],
        }
        return Response(response_payload, status=status.HTTP_200_OK)


class CardFontAssetViewSet(viewsets.ModelViewSet):
    serializer_class = CardFontAssetSerializer
    permission_classes = [IsLtfAdminOnly]
    queryset = CardFontAsset.objects.all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CardFontAsset.objects.none()
        return CardFontAsset.objects.order_by("name", "-created_at")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)


class CardImageAssetViewSet(viewsets.ModelViewSet):
    serializer_class = CardImageAssetSerializer
    permission_classes = [IsLtfAdminOnly]
    queryset = CardImageAsset.objects.all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CardImageAsset.objects.none()
        return CardImageAsset.objects.order_by("name", "-created_at")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)


class PrintJobViewSet(
    OptionalPaginationListMixin,
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

    def _log_print_job_event(
        self,
        *,
        print_job: PrintJob,
        action: str,
        message: str,
        metadata: dict | None = None,
    ) -> None:
        metadata_payload = {"print_job_id": print_job.id, **(metadata or {})}
        FinanceAuditLog.objects.create(
            action=f"print_job.{action}",
            message=message,
            actor=self.request.user if self.request.user.is_authenticated else None,
            club=print_job.club,
            metadata=metadata_payload,
        )

    def _ensure_club_admin_scope(self, user, print_job: PrintJob) -> None:
        if _is_ltf_admin(user):
            return
        if _is_club_admin(user) and print_job.club.admins.filter(id=user.id).exists():
            return
        raise PermissionDenied("Club Admin can only access print jobs for own club.")

    def _parse_datetime_range_param(self, value: str | None, *, end_of_day: bool = False) -> datetime | None:
        raw_value = (value or "").strip()
        if not raw_value:
            return None
        parsed_datetime = parse_datetime(raw_value)
        if parsed_datetime is not None:
            if timezone.is_naive(parsed_datetime):
                return timezone.make_aware(parsed_datetime, timezone.get_current_timezone())
            return parsed_datetime
        parsed_date = parse_date(raw_value)
        if parsed_date is not None:
            parsed_datetime = datetime.combine(
                parsed_date,
                datetime.max.time() if end_of_day else datetime.min.time(),
            )
            return timezone.make_aware(parsed_datetime, timezone.get_current_timezone())
        return None

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
            queryset = base_queryset.all()
        if _is_club_admin(user):
            object_actions = {"retrieve", "execute", "retry", "cancel", "pdf", "history"}
            if self.action in object_actions:
                queryset = base_queryset.all()
            else:
                queryset = base_queryset.filter(club__admins=user)
        if not (_is_ltf_admin(user) or _is_club_admin(user)):
            return PrintJob.objects.none()

        if self.action != "list":
            return queryset.order_by("-created_at", "-id")

        status_param = self.request.query_params.get("status")
        if status_param:
            status_values = [value.strip() for value in status_param.split(",") if value.strip()]
            if status_values:
                queryset = queryset.filter(status__in=status_values)

        club_id = (self.request.query_params.get("club_id") or "").strip()
        if club_id:
            queryset = queryset.filter(club_id=club_id)

        template_version_id = (self.request.query_params.get("template_version_id") or "").strip()
        if template_version_id:
            queryset = queryset.filter(template_version_id=template_version_id)

        requested_by_id = (self.request.query_params.get("requested_by_id") or "").strip()
        if requested_by_id:
            queryset = queryset.filter(requested_by_id=requested_by_id)

        created_from = self._parse_datetime_range_param(self.request.query_params.get("created_from"))
        if created_from is not None:
            queryset = queryset.filter(created_at__gte=created_from)

        created_to = self._parse_datetime_range_param(
            self.request.query_params.get("created_to"),
            end_of_day=True,
        )
        if created_to is not None:
            queryset = queryset.filter(created_at__lte=created_to)

        search_value = (self.request.query_params.get("q") or "").strip()
        if search_value:
            queryset = queryset.filter(
                Q(job_number__icontains=search_value)
                | Q(status__icontains=search_value)
                | Q(club__name__icontains=search_value)
                | Q(template_version__template__name__icontains=search_value)
                | Q(template_version__label__icontains=search_value)
                | Q(error_detail__icontains=search_value)
            )

        return queryset.order_by("-created_at", "-id")

    @extend_schema(
        parameters=[
            OpenApiParameter("status", str, OpenApiParameter.QUERY),
            OpenApiParameter("club_id", int, OpenApiParameter.QUERY),
            OpenApiParameter("template_version_id", int, OpenApiParameter.QUERY),
            OpenApiParameter("requested_by_id", int, OpenApiParameter.QUERY),
            OpenApiParameter(
                "created_from",
                str,
                OpenApiParameter.QUERY,
                description="ISO datetime/date lower bound for created_at.",
            ),
            OpenApiParameter(
                "created_to",
                str,
                OpenApiParameter.QUERY,
                description="ISO datetime/date upper bound for created_at.",
            ),
            OpenApiParameter("q", str, OpenApiParameter.QUERY),
            OpenApiParameter("page", int, OpenApiParameter.QUERY),
            OpenApiParameter("page_size", int, OpenApiParameter.QUERY),
        ],
        responses=PrintJobSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

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
                side=serializer.validated_data.get("side", PrintJob.Side.FRONT),
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
            self._log_print_job_event(
                print_job=print_job,
                action="created",
                message="Print job created.",
                metadata={
                    "item_count": len(resolved_items),
                    "selected_slots": selected_slots,
                    "side": print_job.side,
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
        invalid_status: str | None = None
        with transaction.atomic():
            locked_job = (
                PrintJob.objects.select_for_update()
                .select_related("club")
                .get(id=print_job.id)
            )
            if locked_job.status == PrintJob.Status.SUCCEEDED and locked_job.artifact_pdf:
                self._log_print_job_event(
                    print_job=locked_job,
                    action=f"{audit_action}_noop_succeeded",
                    message="Guarded transition: print job is already succeeded.",
                )
                return locked_job, status.HTTP_200_OK
            if locked_job.status in {PrintJob.Status.QUEUED, PrintJob.Status.RUNNING}:
                self._log_print_job_event(
                    print_job=locked_job,
                    action=f"{audit_action}_noop_in_progress",
                    message="Guarded transition: print job is already queued/running.",
                )
                return locked_job, status.HTTP_202_ACCEPTED
            if locked_job.status not in allow_statuses:
                self._log_print_job_event(
                    print_job=locked_job,
                    action=f"{audit_action}_rejected_invalid_status",
                    message="Guarded transition: print job status is not eligible for queueing.",
                    metadata={"current_status": locked_job.status},
                )
                invalid_status = locked_job.status
            else:
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

        if invalid_status is not None:
            raise serializers.ValidationError(
                {"detail": f"Print job cannot be queued from status '{invalid_status}'."}
            )

        try:
            execute_print_job_task.apply_async(
                args=[locked_job.id, user.id if user is not None else None],
                queue=getattr(settings, "CELERY_PRINT_JOB_QUEUE", "print_jobs"),
            )
        except Exception as exc:
            dispatch_error = str(exc)[:1000] or "Unknown broker dispatch error."
            failure_at = timezone.now()
            with transaction.atomic():
                failed_job = (
                    PrintJob.objects.select_for_update()
                    .select_related("club")
                    .get(id=locked_job.id)
                )
                if failed_job.status == PrintJob.Status.QUEUED:
                    failed_job.status = PrintJob.Status.FAILED
                    failed_job.finished_at = failure_at
                    failed_job.error_detail = f"Task dispatch failed: {dispatch_error}"[:4000]
                    failed_job.last_error_at = failure_at
                    failed_job.execution_metadata = {
                        **dict(failed_job.execution_metadata or {}),
                        "last_dispatch_error": dispatch_error,
                        "last_dispatch_failed_at": failure_at.isoformat(),
                    }
                    failed_job.save(
                        update_fields=[
                            "status",
                            "finished_at",
                            "error_detail",
                            "last_error_at",
                            "execution_metadata",
                            "updated_at",
                        ]
                    )
                self._log_print_job_event(
                    print_job=failed_job,
                    action=f"{audit_action}_dispatch_failed",
                    message="Print job enqueue failed.",
                    metadata={"dispatch_error": dispatch_error},
                )
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Failed to enqueue print job execution. "
                        "Job moved to failed state; retry is available."
                    )
                }
            ) from exc

        locked_job = PrintJob.objects.get(id=locked_job.id)
        self._log_print_job_event(
            print_job=locked_job,
            action=audit_action,
            message="Print job queued for execution.",
        )
        return locked_job, status.HTTP_202_ACCEPTED

    @extend_schema(request=None, responses=PrintJobSerializer)
    @action(detail=True, methods=["post"], url_path="execute")
    def execute(self, request, pk=None):
        print_job = self.get_object()
        self._ensure_club_admin_scope(request.user, print_job)
        if print_job.status == PrintJob.Status.CANCELLED:
            self._log_print_job_event(
                print_job=print_job,
                action="execute_rejected_cancelled",
                message="Guarded transition: cancelled print job cannot be executed.",
            )
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
            self._log_print_job_event(
                print_job=print_job,
                action="cancel_rejected_succeeded",
                message="Guarded transition: succeeded print job cannot be cancelled.",
            )
            return Response(
                {"detail": "Cannot cancel a succeeded print job."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if print_job.status == PrintJob.Status.CANCELLED:
            self._log_print_job_event(
                print_job=print_job,
                action="cancel_noop_already_cancelled",
                message="Guarded transition: print job is already cancelled.",
            )
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
                self._log_print_job_event(
                    print_job=locked_job,
                    action="cancelled",
                    message="Print job cancelled.",
                    metadata={"status_before": print_job.status},
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
            self._log_print_job_event(
                print_job=print_job,
                action="pdf_unavailable",
                message="Guarded transition: print job artifact is not available.",
                metadata={"status": print_job.status},
            )
            return Response(
                {"detail": "Print job PDF artifact is not available yet."},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            artifact_stream = print_job.artifact_pdf.open("rb")
        except Exception:
            self._log_print_job_event(
                print_job=print_job,
                action="pdf_missing_artifact",
                message="Print job artifact file is missing from storage.",
            )
            return Response(
                {"detail": "Print job PDF artifact file is unavailable."},
                status=status.HTTP_404_NOT_FOUND,
            )
        response = FileResponse(artifact_stream, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="{print_job.job_number.lower()}-artifact.pdf"'
        )
        if print_job.artifact_size_bytes:
            response["Content-Length"] = str(print_job.artifact_size_bytes)
        self._log_print_job_event(
            print_job=print_job,
            action="pdf_downloaded",
            message="Print job PDF artifact downloaded.",
            metadata={"artifact_size_bytes": int(print_job.artifact_size_bytes or 0)},
        )
        return response

    @extend_schema(responses=PrintJobHistoryEventSerializer(many=True))
    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        print_job = self.get_object()
        self._ensure_club_admin_scope(request.user, print_job)
        events = (
            FinanceAuditLog.objects.filter(
                action__startswith="print_job.",
                metadata__print_job_id=print_job.id,
            )
            .select_related("actor")
            .order_by("-created_at", "-id")
        )
        serializer = PrintJobHistoryEventSerializer(events, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


def _read_lookup_limit(raw_value: str | None, *, default: int = 20, max_value: int = 100) -> int:
    try:
        parsed = int(str(raw_value or default).strip())
    except (TypeError, ValueError):
        return default
    return max(1, min(parsed, max_value))


class CardDesignerMembersLookupView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, OpenApiParameter.QUERY),
            OpenApiParameter("limit", int, OpenApiParameter.QUERY),
        ],
        responses=CardDesignerLookupItemSerializer(many=True),
    )
    def get(self, request):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can access designer lookups.")

        query = (request.query_params.get("q") or "").strip()
        limit = _read_lookup_limit(request.query_params.get("limit"))
        queryset = Member.objects.select_related("club").all()
        if query:
            queryset = queryset.filter(
                Q(first_name__icontains=query)
                | Q(last_name__icontains=query)
                | Q(ltf_licenseid__icontains=query)
                | Q(club__name__icontains=query)
            )
        members = queryset.order_by("last_name", "first_name", "id")[:limit]
        payload = [
            {
                "id": int(member.id),
                "label": f"{member.first_name} {member.last_name}".strip(),
                "subtitle": f"{member.club.name} · {member.ltf_licenseid or 'No LTF ID'}",
            }
            for member in members
        ]
        return Response(payload, status=status.HTTP_200_OK)


class CardDesignerLicensesLookupView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, OpenApiParameter.QUERY),
            OpenApiParameter("limit", int, OpenApiParameter.QUERY),
        ],
        responses=CardDesignerLookupItemSerializer(many=True),
    )
    def get(self, request):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can access designer lookups.")

        query = (request.query_params.get("q") or "").strip()
        limit = _read_lookup_limit(request.query_params.get("limit"))
        queryset = License.objects.select_related("member", "club", "license_type").all()
        if query:
            search_filter = (
                Q(member__first_name__icontains=query)
                | Q(member__last_name__icontains=query)
                | Q(member__ltf_licenseid__icontains=query)
                | Q(club__name__icontains=query)
                | Q(license_type__name__icontains=query)
            )
            if query.isdigit():
                search_filter = search_filter | Q(year=int(query))
            queryset = queryset.filter(search_filter)
        licenses = queryset.order_by("-year", "member__last_name", "member__first_name", "id")[:limit]
        payload = [
            {
                "id": int(license_record.id),
                "label": (
                    f"{license_record.member.first_name} {license_record.member.last_name}"
                    f" · {license_record.license_type.name} {license_record.year}"
                ),
                "subtitle": f"{license_record.club.name} · {license_record.status}",
            }
            for license_record in licenses
        ]
        return Response(payload, status=status.HTTP_200_OK)


class CardDesignerClubsLookupView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, OpenApiParameter.QUERY),
            OpenApiParameter("limit", int, OpenApiParameter.QUERY),
        ],
        responses=CardDesignerLookupItemSerializer(many=True),
    )
    def get(self, request):
        if not _is_ltf_admin(request.user):
            raise PermissionDenied("Only LTF Admin can access designer lookups.")

        query = (request.query_params.get("q") or "").strip()
        limit = _read_lookup_limit(request.query_params.get("limit"))
        queryset = Club.objects.all()
        if query:
            queryset = queryset.filter(
                Q(name__icontains=query)
                | Q(city__icontains=query)
                | Q(locality__icontains=query)
                | Q(postal_code__icontains=query)
            )
        clubs = queryset.order_by("name", "id")[:limit]
        payload = []
        for club in clubs:
            location_parts = [part for part in [club.postal_code, club.locality, club.city] if part]
            subtitle = " · ".join(location_parts).strip()
            payload.append(
                {
                    "id": int(club.id),
                    "label": str(club.name),
                    "subtitle": subtitle,
                }
            )
        return Response(payload, status=status.HTTP_200_OK)


class MergeFieldRegistryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=MergeFieldSerializer(many=True))
    def get(self, request):
        if not (_is_ltf_admin(request.user) or _is_club_admin(request.user)):
            raise PermissionDenied("Not allowed.")
        return Response(get_merge_field_registry_payload(), status=status.HTTP_200_OK)
