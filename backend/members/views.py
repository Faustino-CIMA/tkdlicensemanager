import mimetypes
from pathlib import Path

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.http import FileResponse
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .models import GradePromotionHistory, Member
from .serializers import (
    GradePromotionCreateSerializer,
    GradePromotionHistorySerializer,
    LicenseHistoryEventSerializer,
    MemberProfilePictureSerializer,
    MemberProfilePictureUploadSerializer,
    MemberSerializer,
)
from .services import add_grade_promotion, clear_member_profile_picture, process_member_profile_picture
from licenses.models import LicenseHistoryEvent


class MemberViewSet(viewsets.ModelViewSet):
    serializer_class = MemberSerializer
    permission_classes = [permissions.IsAuthenticated]
    _COACH_ALLOWED_UPDATE_FIELDS = {"belt_rank"}

    def get_permissions(self):
        user = self.request.user
        if self.action in ["create", "destroy"]:
            if user and user.is_authenticated and user.role in [
                "ltf_admin",
                "ltf_finance",
                "coach",
            ]:
                return [permissions.IsAdminUser()]
        if self.action in ["update", "partial_update"]:
            if user and user.is_authenticated and user.role in ["ltf_admin", "ltf_finance"]:
                return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Member.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Member.objects.none()
        if user.role in ["ltf_admin", "ltf_finance"]:
            return Member.objects.select_related("club", "user", "photo_consent_attested_by").filter(
                is_active=True
            )
        if user.role in ["club_admin", "coach"]:
            return Member.objects.select_related("club", "user", "photo_consent_attested_by").filter(
                club__admins=user
            )
        return Member.objects.select_related("club", "user", "photo_consent_attested_by").filter(
            user=user
        )

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Member has related licenses and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )

    def _is_coach(self, user) -> bool:
        return bool(user and user.is_authenticated and user.role == "coach")

    def _coach_update_allowed(self, request) -> bool:
        if not self._is_coach(request.user):
            return True
        payload_fields = set(request.data.keys())
        return bool(payload_fields) and payload_fields.issubset(self._COACH_ALLOWED_UPDATE_FIELDS)

    def _coach_update_forbidden_response(self):
        return Response(
            {"detail": "Not allowed. Coaches can only update belt rank."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def update(self, request, *args, **kwargs):
        if not self._coach_update_allowed(request):
            return self._coach_update_forbidden_response()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self._coach_update_allowed(request):
            return self._coach_update_forbidden_response()
        return super().partial_update(request, *args, **kwargs)

    def _is_grade_manager(self, user) -> bool:
        return user and user.is_authenticated and user.role in [
            "club_admin",
            "coach",
        ]

    def _is_photo_manager(self, user) -> bool:
        return user and user.is_authenticated and user.role in [
            "club_admin",
            "member",
        ]

    @action(detail=True, methods=["get"], url_path="license-history")
    def license_history(self, request, *args, **kwargs):
        member = self.get_object()
        queryset = (
            LicenseHistoryEvent.objects.select_related(
                "license",
                "club",
                "order",
                "payment",
                "actor",
            )
            .filter(member=member)
            .order_by("-event_at", "-id")
        )
        if request.user.role == "ltf_finance":
            queryset = queryset.filter(Q(order__isnull=False) | Q(payment__isnull=False))
        serializer = LicenseHistoryEventSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="grade-history")
    def grade_history(self, request, *args, **kwargs):
        if request.user.role == "ltf_finance":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        member = self.get_object()
        queryset = (
            GradePromotionHistory.objects.select_related("club", "examiner_user")
            .filter(member=member)
            .order_by("-promotion_date", "-created_at")
        )
        serializer = GradePromotionHistorySerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, *args, **kwargs):
        member = self.get_object()
        license_queryset = (
            LicenseHistoryEvent.objects.select_related(
                "license",
                "club",
                "order",
                "payment",
                "actor",
            )
            .filter(member=member)
            .order_by("-event_at", "-id")
        )
        if request.user.role == "ltf_finance":
            license_queryset = license_queryset.filter(
                Q(order__isnull=False) | Q(payment__isnull=False)
            )
            grade_payload = []
        else:
            grade_queryset = (
                GradePromotionHistory.objects.select_related("club", "examiner_user")
                .filter(member=member)
                .order_by("-promotion_date", "-created_at")
            )
            grade_payload = GradePromotionHistorySerializer(grade_queryset, many=True).data

        return Response(
            {
                "member_id": member.id,
                "license_history": LicenseHistoryEventSerializer(
                    license_queryset, many=True
                ).data,
                "grade_history": grade_payload,
            }
        )

    @action(detail=True, methods=["post"], url_path="promote-grade")
    def promote_grade(self, request, *args, **kwargs):
        if not self._is_grade_manager(request.user):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        member = self.get_object()
        serializer = GradePromotionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        to_grade = serializer.validated_data["to_grade"]
        notes = serializer.validated_data.get("notes", "")
        proof_ref = serializer.validated_data.get("proof_ref", "")
        metadata = serializer.validated_data.get("metadata", {}) or {}
        promotion_date = serializer.validated_data.get("promotion_date")
        exam_date = serializer.validated_data.get("exam_date")

        consent_user = member.user
        if (notes or proof_ref) and consent_user and not consent_user.consent_given:
            return Response(
                {"detail": "Member consent is required for storing grade notes/proof."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        history_entry = add_grade_promotion(
            member,
            actor=request.user if request.user.is_authenticated else None,
            to_grade=to_grade,
            notes=notes,
            proof_ref=proof_ref,
            promotion_date=promotion_date,
            exam_date=exam_date,
            metadata={
                **metadata,
                "consent_required": bool(notes or proof_ref),
                "consent_confirmed": bool(consent_user and consent_user.consent_given),
                "source": "member.promote_grade",
            },
        )
        return Response(
            GradePromotionHistorySerializer(history_entry).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["get", "post", "delete"],
        url_path="profile-picture",
        parser_classes=[MultiPartParser, FormParser],
    )
    def profile_picture(self, request, *args, **kwargs):
        member = self.get_object()

        if request.method == "GET":
            serializer = MemberProfilePictureSerializer(member, context={"request": request})
            return Response(serializer.data)

        if not self._is_photo_manager(request.user):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        if request.method == "DELETE":
            clear_member_profile_picture(member, clear_consent_attestation=True)
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = MemberProfilePictureUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if member.user and not member.user.consent_given:
            return Response(
                {"detail": "Member consent is required before storing profile photos."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            updated_member = process_member_profile_picture(
                member,
                processed_image=serializer.validated_data["processed_image"],
                original_image=serializer.validated_data.get("original_image"),
                photo_edit_metadata=serializer.validated_data.get("photo_edit_metadata", {}),
                actor=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as exc:
            detail = (
                exc.message_dict
                if hasattr(exc, "message_dict")
                else exc.messages
                if hasattr(exc, "messages")
                else str(exc)
            )
            raise DRFValidationError(detail) from exc

        response_serializer = MemberProfilePictureSerializer(
            updated_member, context={"request": request}
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="profile-picture/download")
    def download_profile_picture(self, request, *args, **kwargs):
        member = self.get_object()
        return self._stream_member_image_file(
            member=member,
            image_field=member.profile_picture_processed or member.profile_picture_original,
            not_found_detail="Profile picture not found.",
            missing_detail="Profile picture file is missing.",
            fallback_name=f"member-{member.id}-profile.jpg",
            as_attachment=True,
        )

    @action(detail=True, methods=["get"], url_path="profile-picture/processed")
    def profile_picture_processed(self, request, *args, **kwargs):
        member = self.get_object()
        return self._stream_member_image_file(
            member=member,
            image_field=member.profile_picture_processed or member.profile_picture_original,
            not_found_detail="Profile picture not found.",
            missing_detail="Profile picture file is missing.",
            fallback_name=f"member-{member.id}-profile.jpg",
            as_attachment=False,
        )

    @action(detail=True, methods=["get"], url_path="profile-picture/thumbnail")
    def profile_picture_thumbnail(self, request, *args, **kwargs):
        member = self.get_object()
        return self._stream_member_image_file(
            member=member,
            image_field=(
                member.profile_picture_thumbnail
                or member.profile_picture_processed
                or member.profile_picture_original
            ),
            not_found_detail="Profile picture thumbnail not found.",
            missing_detail="Profile picture thumbnail file is missing.",
            fallback_name=f"member-{member.id}-profile-thumb.jpg",
            as_attachment=False,
        )

    def _stream_member_image_file(
        self,
        *,
        member: Member,
        image_field,
        not_found_detail: str,
        missing_detail: str,
        fallback_name: str,
        as_attachment: bool,
    ):
        if not image_field:
            return Response({"detail": not_found_detail}, status=status.HTTP_404_NOT_FOUND)

        try:
            image_field.open("rb")
        except FileNotFoundError:
            return Response({"detail": missing_detail}, status=status.HTTP_404_NOT_FOUND)

        response_name = Path(str(image_field.name or "")).name or fallback_name
        content_type = mimetypes.guess_type(response_name)[0] or "application/octet-stream"
        return FileResponse(
            image_field,
            as_attachment=as_attachment,
            filename=response_name,
            content_type=content_type,
        )

