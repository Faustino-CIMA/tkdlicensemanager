from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from .card_serializers import (
    CardFormatPresetSerializer,
    CardTemplateCloneSerializer,
    CardTemplateSerializer,
    CardTemplateVersionSerializer,
    MergeFieldSerializer,
    PaperProfileSerializer,
    PrintJobSerializer,
    get_merge_field_registry_payload,
)
from .models import (
    CardFormatPreset,
    CardTemplate,
    CardTemplateVersion,
    PaperProfile,
    PrintJob,
)


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


class PrintJobViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = PrintJobSerializer
    permission_classes = [IsLtfAdminOrClubAdmin]
    queryset = PrintJob.objects.select_related("club", "template_version", "paper_profile").all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PrintJob.objects.none()
        user = self.request.user
        if _is_ltf_admin(user):
            return PrintJob.objects.select_related("club", "template_version", "paper_profile").all()
        if _is_club_admin(user):
            return PrintJob.objects.select_related("club", "template_version", "paper_profile").filter(
                club__admins=user
            )
        return PrintJob.objects.none()

    def perform_create(self, serializer):
        user = self.request.user
        club = serializer.validated_data["club"]
        if _is_club_admin(user) and not club.admins.filter(id=user.id).exists():
            raise PermissionDenied("Club Admin can only create print jobs for own club.")
        template_version = serializer.validated_data["template_version"]
        selected_profile = serializer.validated_data.get("paper_profile") or template_version.paper_profile
        serializer.save(
            requested_by=user if user.is_authenticated else None,
            paper_profile=selected_profile,
            status=PrintJob.Status.QUEUED,
        )


class MergeFieldRegistryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=MergeFieldSerializer(many=True))
    def get(self, request):
        if not (_is_ltf_admin(request.user) or _is_club_admin(request.user)):
            raise PermissionDenied("Not allowed.")
        return Response(get_merge_field_registry_payload(), status=status.HTTP_200_OK)
