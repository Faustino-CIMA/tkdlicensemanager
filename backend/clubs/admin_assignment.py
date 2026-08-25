from __future__ import annotations

import re

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.utils.crypto import get_random_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from accounts.email_utils import send_club_admin_welcome_email
from accounts.models import User
from licenses.models import License
from members.models import Member

from .models import Club


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

PROTECTED_ROLES = {User.Roles.LTF_ADMIN, User.Roles.LTF_FINANCE}


class AdminAssignmentError(Exception):
    def __init__(self, payload: dict, status_code: int):
        super().__init__(payload.get("detail", "assignment_error"))
        self.payload = payload
        self.status_code = status_code


MEMBER_SEARCH_LIMIT = 25
MEMBER_SEARCH_MIN_QUERY = 2


def _valid_license_exists():
    return License.objects.filter(
        member_id=OuterRef("pk"),
        status__in=[License.Status.ACTIVE, License.Status.PENDING],
    )


def _serialize_assignment_member(member: Member) -> dict:
    administered_ids = []
    if member.user_id:
        administered_ids = [club.id for club in member.user.clubs_administered.all()]
    return {
        "id": member.id,
        "first_name": member.first_name,
        "last_name": member.last_name,
        "email": member.email or "",
        "club_id": member.club_id,
        "club_name": member.club.name,
        "has_valid_license": bool(getattr(member, "has_valid_license", False)),
        "user_id": member.user_id,
        "username": member.user.username if member.user_id else "",
        "administered_club_ids": administered_ids,
    }


def search_assignment_members(
    *,
    query: str = "",
    club_id=None,
    licensed_only: bool = True,
    limit: int = MEMBER_SEARCH_LIMIT,
) -> dict:
    query = str(query or "").strip()
    try:
        club_id = int(club_id) if club_id not in (None, "") else None
    except (TypeError, ValueError):
        club_id = None
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = MEMBER_SEARCH_LIMIT
    limit = max(1, min(limit, MEMBER_SEARCH_LIMIT))

    if not club_id and len(query) < MEMBER_SEARCH_MIN_QUERY:
        return {"members": [], "total": 0, "truncated": False, "limit": limit}

    queryset = (
        Member.objects.filter(is_active=True)
        .select_related("club", "user")
        .prefetch_related("user__clubs_administered")
        .annotate(has_valid_license=Exists(_valid_license_exists()))
        .order_by("last_name", "first_name", "id")
    )
    if club_id:
        queryset = queryset.filter(club_id=club_id)
    if licensed_only:
        queryset = queryset.filter(has_valid_license=True)
    if query:
        name_filter = (
            Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(email__icontains=query)
            | Q(user__username__icontains=query)
            | Q(club__name__icontains=query)
        )
        parts = [part for part in query.split() if part]
        if len(parts) >= 2:
            name_filter |= Q(
                first_name__icontains=parts[0],
                last_name__icontains=" ".join(parts[1:]),
            )
            name_filter |= Q(first_name__icontains=parts[0], last_name__icontains=parts[-1])
        queryset = queryset.filter(name_filter)

    total = queryset.count()
    members = [_serialize_assignment_member(member) for member in queryset[:limit]]
    return {
        "members": members,
        "total": total,
        "truncated": total > len(members),
        "limit": limit,
    }


def build_assignment_board() -> dict:
    clubs = list(
        Club.objects.annotate(admin_count=Count("admins", distinct=True))
        .prefetch_related("admins")
        .order_by("name")
    )
    club_payload = []
    for club in clubs:
        admin_ids = [admin.id for admin in club.admins.all()]
        club_payload.append(
            {
                "id": club.id,
                "name": club.name,
                "locality": club.locality or club.city or "",
                "max_admins": club.max_admins,
                "admin_count": club.admin_count,
                "admin_ids": admin_ids,
            }
        )

    admin_users = (
        User.objects.filter(clubs_administered__isnull=False)
        .distinct()
        .select_related("member_profile__club")
        .prefetch_related(
            Prefetch(
                "clubs_administered",
                queryset=Club.objects.only("id", "name").order_by("name"),
            )
        )
        .order_by("last_name", "first_name", "username")
    )
    admin_payload = []
    for user in admin_users:
        member = getattr(user, "member_profile", None)
        admin_payload.append(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email or "",
                "first_name": user.first_name,
                "last_name": user.last_name,
                "role": user.role,
                "member_id": member.id if member else None,
                "member_name": (
                    f"{member.first_name} {member.last_name}".strip() if member else ""
                ),
                "home_club_id": member.club_id if member else None,
                "home_club_name": member.club.name if member else "",
                "clubs": [
                    {"id": club.id, "name": club.name}
                    for club in user.clubs_administered.all()
                ],
            }
        )

    return {
        "clubs": club_payload,
        "admins": admin_payload,
    }


def _grant_club_admin_role(user: User) -> None:
    if user.role in PROTECTED_ROLES or user.role == User.Roles.CLUB_ADMIN:
        return
    user.role = User.Roles.CLUB_ADMIN
    user.save(update_fields=["role"])


def _build_reset_url(user: User, locale: str) -> str:
    token = PasswordResetTokenGenerator().make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return f"{settings.FRONTEND_BASE_URL}/{locale}/reset-password?uid={uid}&token={token}"


def assign_club_admin(
    club: Club,
    *,
    member_id=None,
    user_id=None,
    email: str | None = None,
    locale: str | None = None,
) -> dict:
    if not member_id and not user_id:
        raise AdminAssignmentError(
            {"detail": "member_id or user_id is required."},
            400,
        )

    created_user = False
    linked_existing_user = False
    member = None
    requested_email = str(email or "").strip()

    if member_id:
        member = Member.objects.select_related("user", "club").filter(id=member_id).first()
        if not member:
            raise AdminAssignmentError({"detail": "Member not found."}, 400)
        if member.user:
            user = member.user
        else:
            same_name_admin = club.admins.filter(
                first_name__iexact=member.first_name,
                last_name__iexact=member.last_name,
            ).first()
            if same_name_admin:
                user = same_name_admin
                member.user = user
                member.save(update_fields=["user"])
                linked_existing_user = True
            else:
                resolved_email = requested_email or (member.email or "").strip()
                if not resolved_email:
                    raise AdminAssignmentError(
                        {"detail": "email_required", "member_id": member.id},
                        400,
                    )
                taken = (
                    User.objects.filter(email__iexact=resolved_email)
                    .exclude(email="")
                    .exists()
                )
                if taken:
                    raise AdminAssignmentError({"detail": "email_in_use"}, 400)
                if not member.email:
                    member.email = resolved_email
                    member.save(update_fields=["email"])
                username = build_username(member.first_name, member.last_name)
                user = User.objects.create_user(
                    username=username,
                    email=resolved_email,
                    password=get_random_string(20),
                    role=User.Roles.MEMBER,
                    first_name=member.first_name,
                    last_name=member.last_name,
                )
                created_user = True
                member.user = user
                member.save(update_fields=["user"])
    else:
        user = User.objects.filter(id=user_id, role=User.Roles.MEMBER).first()
        if not user:
            raise AdminAssignmentError({"detail": "User must be a member."}, 400)
        member = Member.objects.filter(user=user).first()
        if not member:
            raise AdminAssignmentError({"detail": "User must have a member profile."}, 400)

    already_admin = club.admins.filter(id=user.id).exists()
    if already_admin and not linked_existing_user:
        raise AdminAssignmentError({"detail": "already_admin"}, 400)
    if not already_admin and club.admins.count() >= club.max_admins:
        raise AdminAssignmentError({"detail": "Club admin limit reached."}, 400)

    club.admins.add(user)
    _grant_club_admin_role(user)

    locale_code = locale or settings.FRONTEND_DEFAULT_LOCALE
    email_sent = False
    email_error = None
    reset_url = ""
    if user.email and created_user:
        reset_url = _build_reset_url(user, locale_code)
        email_sent, email_error = send_club_admin_welcome_email(user, club, reset_url)

    return {
        "detail": "Admin added.",
        "created_user": created_user,
        "linked_existing_user": linked_existing_user,
        "email_sent": email_sent,
        "email_error": email_error or None,
        "reset_url": reset_url,
        "username": user.username,
        "user_id": user.id,
        "member_id": member.id if member else None,
    }


def remove_club_admin(club: Club, user_id) -> dict:
    if not user_id:
        raise AdminAssignmentError({"detail": "user_id is required."}, 400)
    user = User.objects.filter(id=user_id).first()
    if not user or not club.admins.filter(id=user.id).exists():
        raise AdminAssignmentError({"detail": "Admin not found on this club."}, 400)
    club.admins.remove(user)
    if (
        user.role == User.Roles.CLUB_ADMIN
        and not Club.objects.filter(admins=user).exists()
    ):
        user.role = User.Roles.MEMBER
        user.save(update_fields=["role"])
    return {"detail": "Admin removed."}
