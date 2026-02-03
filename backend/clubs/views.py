from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.decorators import action

from .models import Club
from .serializers import ClubSerializer
import re

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.utils.crypto import get_random_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from accounts.models import User
from accounts.email_utils import send_club_admin_welcome_email
from members.models import Member


def build_username(first_name, last_name):
    base = f"{(first_name or '')[:1]}{last_name or ''}".lower()
    base = re.sub(r"[^a-z0-9]", "", base) or "member"
    base = base[:10]
    username = base
    counter = 1
    while User.objects.filter(username=username).exists():
        suffix = str(counter)
        trim = max(1, 10 - len(suffix))
        username = f"{base[:trim]}{suffix}"
        counter += 1
    return username


class ClubViewSet(viewsets.ModelViewSet):
    serializer_class = ClubSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Club.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Club.objects.none()
        if user.role == "nma_admin":
            return Club.objects.all()
        return (
            Club.objects.filter(admins=user)
            | Club.objects.filter(members__user=user)
        ).distinct()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        club = self.get_object()
        if club.members.exists():
            return Response(
                {"detail": "Club has members and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        if club.licenses.exists():
            return Response(
                {"detail": "Club has licenses and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def admins(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "nma_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        admins = club.admins.all().values("id", "username", "email")
        return Response(
            {
                "admins": list(admins),
                "max_admins": club.max_admins,
                "current_admins": club.admins.count(),
            }
        )

    @action(detail=True, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def eligible_members(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "nma_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        queryset = (
            Member.objects.filter(user__isnull=True)
            | Member.objects.filter(user__isnull=False).exclude(user__in=club.admins.all())
        )
        queryset = queryset.select_related("user", "club").order_by("last_name", "first_name")
        data = [
            {
                "id": member.id,
                "label": f"{member.first_name} {member.last_name} · {member.club.name}",
                "first_name": member.first_name,
                "last_name": member.last_name,
                "email": member.email or "",
                "club_name": member.club.name,
            }
            for member in queryset
        ]
        return Response({"eligible": data})

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def add_admin(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "nma_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        user_id = request.data.get("user_id")
        member_id = request.data.get("member_id")
        email = request.data.get("email")
        if not user_id and not member_id:
            return Response(
                {"detail": "member_id or user_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if club.admins.count() >= club.max_admins:
            return Response({"detail": "Club admin limit reached."}, status=status.HTTP_400_BAD_REQUEST)
        created_user = False
        if member_id:
            member = Member.objects.select_related("user").filter(id=member_id).first()
            if not member:
                return Response({"detail": "Member not found."}, status=status.HTTP_400_BAD_REQUEST)
            if member.user:
                user = member.user
            else:
                existing_user = User.objects.filter(
                    first_name__iexact=member.first_name,
                    last_name__iexact=member.last_name,
                ).first()
                if existing_user:
                    user = existing_user
                else:
                    if not member.email and not email:
                        return Response(
                            {"detail": "email_required", "member_id": member.id},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if email and not member.email:
                        member.email = email
                        member.save(update_fields=["email"])
                    username = build_username(member.first_name, member.last_name)
                    temp_password = get_random_string(20)
                    user = User.objects.create_user(
                        username=username,
                        email=member.email or "",
                        password=temp_password,
                        role="member",
                        first_name=member.first_name,
                        last_name=member.last_name,
                    )
                created_user = True
                member.user = user
                member.save(update_fields=["user"])
        else:
            user = User.objects.filter(id=user_id, role="member").first()
            if not user:
                return Response({"detail": "User must be a member."}, status=status.HTTP_400_BAD_REQUEST)
            if not Member.objects.filter(user=user).exists():
                return Response({"detail": "User must have a member profile."}, status=status.HTTP_400_BAD_REQUEST)
        club.admins.add(user)
        if user.role != "club_admin":
            user.role = "club_admin"
            user.save(update_fields=["role"])
        locale = request.data.get("locale") or settings.FRONTEND_DEFAULT_LOCALE
        token = PasswordResetTokenGenerator().make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        reset_url = f"{settings.FRONTEND_BASE_URL}/{locale}/reset-password?uid={uid}&token={token}"
        if user.email and created_user:
            email_sent, email_error = send_club_admin_welcome_email(user, club, reset_url)
            if not email_sent:
                return Response(
                    {"detail": "email_send_failed", "error": email_error},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
        return Response({"detail": "Admin added."})

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def remove_admin(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "nma_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        user_id = request.data.get("user_id")
        if not user_id:
            return Response({"detail": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        club.admins.remove(user_id)
        user = User.objects.filter(id=user_id).first()
        if user and not Club.objects.filter(admins=user).exists():
            user.role = "member"
            user.save(update_fields=["role"])
        return Response({"detail": "Admin removed."})

    @action(detail=True, methods=["patch"], permission_classes=[permissions.IsAuthenticated])
    def set_max_admins(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "nma_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        try:
            max_admins = int(request.data.get("max_admins"))
        except (TypeError, ValueError):
            return Response({"detail": "max_admins must be an integer."}, status=status.HTTP_400_BAD_REQUEST)
        if max_admins < 1:
            return Response({"detail": "max_admins must be at least 1."}, status=status.HTTP_400_BAD_REQUEST)
        if max_admins < club.admins.count():
            return Response(
                {"detail": "max_admins cannot be lower than current admin count."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        club.max_admins = max_admins
        club.save(update_fields=["max_admins"])
        return Response({"detail": "Max admins updated.", "max_admins": club.max_admins})
