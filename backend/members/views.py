from django.db.models import Q
from django.db.models.deletion import ProtectedError
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import GradePromotionHistory, Member
from .serializers import (
    GradePromotionCreateSerializer,
    GradePromotionHistorySerializer,
    LicenseHistoryEventSerializer,
    MemberSerializer,
)
from .services import add_grade_promotion
from licenses.models import LicenseHistoryEvent


class MemberViewSet(viewsets.ModelViewSet):
    serializer_class = MemberSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            user = self.request.user
            if user and user.is_authenticated and user.role == "ltf_finance":
                return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Member.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Member.objects.none()
        if user.role in ["ltf_admin", "ltf_finance"]:
            return Member.objects.select_related("club", "user").all()
        if user.role in ["club_admin", "coach"]:
            return Member.objects.select_related("club", "user").filter(club__admins=user)
        return Member.objects.select_related("club", "user").filter(user=user)

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Member has related licenses and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )

    def _is_grade_manager(self, user) -> bool:
        return user and user.is_authenticated and user.role in [
            "ltf_admin",
            "club_admin",
            "coach",
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

