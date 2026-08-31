from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.utils import timezone

from accounts.email_utils import (
    send_member_transfer_fee_notice,
    send_member_transfer_request_email,
    send_member_transfer_status_email,
)
from accounts.models import User
from clubs.models import Club, FederationProfile
from licenses.history import create_license_history_event
from licenses.models import License, LicenseHistoryEvent

from .models import Member, MemberTransfer, MemberTransferMessage

DEFAULT_CLUB_TOURIST_THRESHOLD = 3


def get_club_tourist_threshold() -> int:
    profile = (
        FederationProfile.objects.filter(pk=1)
        .only("club_tourist_transfer_threshold")
        .first()
    )
    if not profile:
        return DEFAULT_CLUB_TOURIST_THRESHOLD
    return max(1, int(profile.club_tourist_transfer_threshold or DEFAULT_CLUB_TOURIST_THRESHOLD))


def is_club_tourist(completed_count: int, threshold: int | None = None) -> bool:
    limit = threshold if threshold is not None else get_club_tourist_threshold()
    return int(completed_count or 0) >= max(1, int(limit))

MEMBER_SEARCH_LIMIT = 25
CLUB_SEARCH_LIMIT = 20


class TransferError(Exception):
    def __init__(self, payload: dict, status_code: int = 400):
        super().__init__(payload.get("detail", "transfer_error"))
        self.payload = payload
        self.status_code = status_code


def _clubs_administered(user: User):
    return Club.objects.filter(admins=user).distinct()


def _user_admins_club(user: User, club: Club) -> bool:
    return club.admins.filter(id=user.id).exists()


def _parse_fee(raw) -> Decimal:
    if raw in (None, "", False):
        return Decimal("0.00")
    try:
        amount = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise TransferError({"detail": "invalid_fee"}) from error
    if amount < 0:
        raise TransferError({"detail": "invalid_fee"})
    return amount.quantize(Decimal("0.01"))


def _has_valid_license():
    return License.objects.filter(
        member_id=OuterRef("pk"),
        status__in=[License.Status.ACTIVE, License.Status.PENDING],
    )


def serialize_transfer(transfer: MemberTransfer) -> dict:
    member = transfer.member
    messages = []
    for message in transfer.messages.all():
        messages.append(
            {
                "id": message.id,
                "author_id": message.author_id,
                "author_name": (
                    f"{message.author.first_name} {message.author.last_name}".strip()
                    or message.author.username
                ),
                "body": message.body,
                "created_at": message.created_at.isoformat(),
            }
        )
    license_rows = [
        {
            "id": license.id,
            "year": license.year,
            "status": license.status,
            "license_type_name": license.license_type.name,
        }
        for license in member.licenses.filter(
            status__in=[License.Status.ACTIVE, License.Status.PENDING]
        ).select_related("license_type")
    ]
    return {
        "id": transfer.id,
        "status": transfer.status,
        "member": {
            "id": member.id,
            "first_name": member.first_name,
            "last_name": member.last_name,
            "email": member.email or "",
        },
        "from_club": {"id": transfer.from_club.id, "name": transfer.from_club.name},
        "to_club": {"id": transfer.to_club.id, "name": transfer.to_club.name},
        "initiated_by": {
            "id": transfer.initiated_by_id,
            "username": transfer.initiated_by.username,
        },
        "decided_by": (
            {
                "id": transfer.decided_by_id,
                "username": transfer.decided_by.username,
            }
            if transfer.decided_by_id
            else None
        ),
        "fee_amount": str(transfer.fee_amount),
        "fee_currency": transfer.fee_currency,
        "has_fee": transfer.fee_amount > 0,
        "note": transfer.note or "",
        "ltf_notified": transfer.ltf_notified,
        "current_licenses": license_rows,
        "messages": messages,
        "completed_at": transfer.completed_at.isoformat() if transfer.completed_at else None,
        "created_at": transfer.created_at.isoformat(),
        "updated_at": transfer.updated_at.isoformat(),
    }


def search_transfer_members(*, user: User, club_id, query: str = "") -> dict:
    query = str(query or "").strip()
    try:
        club_id = int(club_id)
    except (TypeError, ValueError) as error:
        raise TransferError({"detail": "club_id is required."}) from error
    club = Club.objects.filter(id=club_id).first()
    if not club or not _user_admins_club(user, club):
        raise TransferError({"detail": "Not allowed."}, 403)

    queryset = (
        Member.objects.filter(is_active=True, club=club)
        .annotate(has_valid_license=Exists(_has_valid_license()))
        .order_by("last_name", "first_name", "id")
    )
    if query:
        name_filter = (
            Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(email__icontains=query)
            | Q(ltf_licenseid__icontains=query)
        )
        parts = [part for part in query.split() if part]
        if len(parts) >= 2:
            name_filter |= Q(
                first_name__icontains=parts[0],
                last_name__icontains=" ".join(parts[1:]),
            )
        queryset = queryset.filter(name_filter)
    total = queryset.count()
    pending_ids = set(
        MemberTransfer.objects.filter(
            member__club=club,
            status=MemberTransfer.Status.PENDING,
        ).values_list("member_id", flat=True)
    )
    admin_user_ids = set(club.admins.values_list("id", flat=True))
    members = []
    for member in queryset[:MEMBER_SEARCH_LIMIT]:
        members.append(
            {
                "id": member.id,
                "first_name": member.first_name,
                "last_name": member.last_name,
                "email": member.email or "",
                "club_id": member.club_id,
                "has_valid_license": bool(member.has_valid_license),
                "pending_transfer": member.id in pending_ids,
                "is_club_admin": bool(member.user_id and member.user_id in admin_user_ids),
            }
        )
    return {
        "members": members,
        "total": total,
        "truncated": total > len(members),
        "limit": MEMBER_SEARCH_LIMIT,
    }


def search_destination_clubs(*, user: User, from_club_id, query: str = "") -> dict:
    query = str(query or "").strip()
    try:
        from_club_id = int(from_club_id)
    except (TypeError, ValueError) as error:
        raise TransferError({"detail": "from_club_id is required."}) from error
    from_club = Club.objects.filter(id=from_club_id).first()
    if not from_club or not _user_admins_club(user, from_club):
        raise TransferError({"detail": "Not allowed."}, 403)

    queryset = (
        Club.objects.exclude(id=from_club_id)
        .annotate(admin_count=Count("admins", distinct=True))
        .filter(admin_count__gt=0)
        .order_by("name", "id")
    )
    if query:
        queryset = queryset.filter(
            Q(name__icontains=query) | Q(locality__icontains=query) | Q(city__icontains=query)
        )
    total = queryset.count()
    clubs = [
        {
            "id": club.id,
            "name": club.name,
            "locality": club.locality or club.city or "",
            "admin_count": club.admin_count,
        }
        for club in queryset[:CLUB_SEARCH_LIMIT]
    ]
    return {
        "clubs": clubs,
        "total": total,
        "truncated": total > len(clubs),
        "limit": CLUB_SEARCH_LIMIT,
    }


def list_transfers(*, user: User, fee_only: bool = False):
    if user.role == User.Roles.LTF_ADMIN:
        queryset = MemberTransfer.objects.all()
        if fee_only:
            queryset = queryset.filter(fee_amount__gt=0)
    elif user.role == User.Roles.CLUB_ADMIN:
        administered = _clubs_administered(user)
        queryset = MemberTransfer.objects.filter(
            Q(from_club__in=administered) | Q(to_club__in=administered)
        ).distinct()
    else:
        raise TransferError({"detail": "Not allowed."}, 403)
    queryset = queryset.select_related(
        "member",
        "from_club",
        "to_club",
        "initiated_by",
        "decided_by",
    ).prefetch_related(
        Prefetch(
            "messages",
            queryset=MemberTransferMessage.objects.select_related("author").order_by("created_at"),
        )
    )
    return [serialize_transfer(item) for item in queryset]


def serialize_movement_event(transfer: MemberTransfer) -> dict:
    return {
        "id": transfer.id,
        "status": transfer.status,
        "from_club": {"id": transfer.from_club_id, "name": transfer.from_club.name},
        "to_club": {"id": transfer.to_club_id, "name": transfer.to_club.name},
        "fee_amount": str(transfer.fee_amount),
        "fee_currency": transfer.fee_currency,
        "completed_at": transfer.completed_at.isoformat() if transfer.completed_at else None,
        "created_at": transfer.created_at.isoformat(),
    }


def list_member_club_transfers(*, user: User, member_id: int) -> dict:
    member = Member.objects.select_related("club").filter(id=member_id).first()
    if not member:
        raise TransferError({"detail": "Member not found."}, 404)
    if user.role == User.Roles.CLUB_ADMIN:
        if not _user_admins_club(user, member.club):
            raise TransferError({"detail": "Not allowed."}, 403)
    elif user.role not in {User.Roles.LTF_ADMIN, User.Roles.LTF_FINANCE}:
        raise TransferError({"detail": "Not allowed."}, 403)

    transfers = list(
        MemberTransfer.objects.filter(member=member)
        .select_related("from_club", "to_club")
        .order_by("created_at", "id")
    )
    completed = [
        item for item in transfers if item.status == MemberTransfer.Status.COMPLETED
    ]
    threshold = get_club_tourist_threshold()
    return {
        "member": {
            "id": member.id,
            "first_name": member.first_name,
            "last_name": member.last_name,
            "club_id": member.club_id,
            "club_name": member.club.name,
        },
        "threshold": threshold,
        "completed_transfer_count": len(completed),
        "is_club_tourist": is_club_tourist(len(completed), threshold),
        "transfers": [serialize_movement_event(item) for item in transfers],
    }


def build_movement_monitor(*, user: User) -> dict:
    if user.role != User.Roles.LTF_ADMIN:
        raise TransferError({"detail": "Not allowed."}, 403)

    threshold = get_club_tourist_threshold()
    completed = MemberTransfer.objects.filter(status=MemberTransfer.Status.COMPLETED)
    member_rows = list(
        completed.values(
            "member_id",
            "member__first_name",
            "member__last_name",
            "member__ltf_licenseid",
            "member__club_id",
            "member__club__name",
        )
        .annotate(completed_count=Count("id"))
        .order_by("-completed_count", "member__last_name", "member__first_name")
    )
    flagged_members = [
        {
            "id": row["member_id"],
            "first_name": row["member__first_name"],
            "last_name": row["member__last_name"],
            "ltf_licenseid": row["member__ltf_licenseid"] or "",
            "club_id": row["member__club_id"],
            "club_name": row["member__club__name"],
            "completed_transfer_count": row["completed_count"],
            "is_club_tourist": True,
        }
        for row in member_rows
        if is_club_tourist(row["completed_count"], threshold)
    ]

    outgoing = {
        row["from_club_id"]: row["total"]
        for row in completed.values("from_club_id").annotate(total=Count("id"))
    }
    incoming = {
        row["to_club_id"]: row["total"]
        for row in completed.values("to_club_id").annotate(total=Count("id"))
    }
    club_ids = set(outgoing) | set(incoming)
    club_names = {
        club.id: club.name for club in Club.objects.filter(id__in=club_ids).only("id", "name")
    }
    clubs = []
    for club_id in club_ids:
        incoming_count = int(incoming.get(club_id, 0))
        outgoing_count = int(outgoing.get(club_id, 0))
        clubs.append(
            {
                "id": club_id,
                "name": club_names.get(club_id, ""),
                "incoming": incoming_count,
                "outgoing": outgoing_count,
                "total": incoming_count + outgoing_count,
            }
        )
    clubs.sort(key=lambda item: (-item["total"], item["name"]))

    recent = [
        {
            **serialize_movement_event(item),
            "member": {
                "id": item.member_id,
                "first_name": item.member.first_name,
                "last_name": item.member.last_name,
            },
        }
        for item in completed.select_related("member", "from_club", "to_club").order_by(
            "-completed_at", "-id"
        )[:25]
    ]
    return {
        "threshold": threshold,
        "flagged_member_count": len(flagged_members),
        "flagged_members": flagged_members,
        "clubs": clubs,
        "recent_completed": recent,
    }


def _transfer_queryset():
    return MemberTransfer.objects.select_related(
        "member",
        "member__club",
        "from_club",
        "to_club",
        "initiated_by",
        "decided_by",
    ).prefetch_related(
        Prefetch(
            "messages",
            queryset=MemberTransferMessage.objects.select_related("author").order_by("created_at"),
        )
    )


def get_transfer(*, user: User, transfer_id: int) -> MemberTransfer:
    transfer = _transfer_queryset().filter(id=transfer_id).first()
    if not transfer:
        raise TransferError({"detail": "Transfer not found."}, 404)
    if user.role == User.Roles.LTF_ADMIN:
        return transfer
    if user.role != User.Roles.CLUB_ADMIN:
        raise TransferError({"detail": "Not allowed."}, 403)
    if not (
        _user_admins_club(user, transfer.from_club) or _user_admins_club(user, transfer.to_club)
    ):
        raise TransferError({"detail": "Not allowed."}, 403)
    return transfer


def create_transfer(
    *,
    user: User,
    member_id,
    to_club_id,
    from_club_id=None,
    fee_amount=None,
    note: str = "",
    locale: str | None = None,
) -> dict:
    if user.role != User.Roles.CLUB_ADMIN:
        raise TransferError({"detail": "Not allowed."}, 403)
    member = Member.objects.select_related("club", "user").filter(id=member_id).first()
    if not member or not member.is_active:
        raise TransferError({"detail": "Member not found."}, 400)
    from_club = member.club
    if from_club_id and int(from_club_id) != from_club.id:
        raise TransferError({"detail": "Member is not in that club."}, 400)
    if not _user_admins_club(user, from_club):
        raise TransferError({"detail": "Not allowed."}, 403)
    to_club = Club.objects.filter(id=to_club_id).first()
    if not to_club:
        raise TransferError({"detail": "Destination club not found."}, 400)
    if to_club.id == from_club.id:
        raise TransferError({"detail": "same_club"}, 400)
    if not to_club.admins.exists():
        raise TransferError({"detail": "destination_has_no_admin"}, 400)
    if member.user_id and from_club.admins.filter(id=member.user_id).exists():
        raise TransferError({"detail": "member_is_club_admin"}, 400)
    if MemberTransfer.objects.filter(member=member, status=MemberTransfer.Status.PENDING).exists():
        raise TransferError({"detail": "pending_transfer_exists"}, 400)

    fee = _parse_fee(fee_amount)
    note_text = str(note or "").strip()[:2000]

    with transaction.atomic():
        transfer = MemberTransfer.objects.create(
            member=member,
            from_club=from_club,
            to_club=to_club,
            initiated_by=user,
            fee_amount=fee,
            note=note_text,
        )
        if note_text:
            MemberTransferMessage.objects.create(
                transfer=transfer, author=user, body=note_text
            )

    send_member_transfer_request_email(transfer, locale=locale)
    if fee > 0:
        send_member_transfer_fee_notice(transfer, locale=locale)
        transfer.ltf_notified = True
        transfer.save(update_fields=["ltf_notified", "updated_at"])
        cache.delete("dashboard:overview:ltf_admin:v3")

    return serialize_transfer(get_transfer(user=user, transfer_id=transfer.id))


def add_transfer_message(*, user: User, transfer_id: int, body: str) -> dict:
    transfer = get_transfer(user=user, transfer_id=transfer_id)
    if user.role == User.Roles.LTF_ADMIN:
        raise TransferError({"detail": "Not allowed."}, 403)
    if transfer.status != MemberTransfer.Status.PENDING:
        raise TransferError({"detail": "transfer_not_pending"}, 400)
    text = str(body or "").strip()
    if not text:
        raise TransferError({"detail": "message_required"}, 400)
    MemberTransferMessage.objects.create(transfer=transfer, author=user, body=text[:2000])
    return serialize_transfer(get_transfer(user=user, transfer_id=transfer.id))


def _complete_transfer(transfer: MemberTransfer, *, actor: User) -> None:
    member = transfer.member
    if member.club_id != transfer.from_club_id:
        raise TransferError({"detail": "member_club_changed"}, 400)
    member.club = transfer.to_club
    member.save(update_fields=["club", "updated_at"])
    licenses = member.licenses.filter(
        status__in=[License.Status.ACTIVE, License.Status.PENDING]
    ).select_related("club", "license_type")
    for license in licenses:
        from_name = license.club.name
        license.club = transfer.to_club
        license.save(update_fields=["club", "updated_at"])
        create_license_history_event(
            license,
            event_type=LicenseHistoryEvent.EventType.STATUS_CHANGED,
            actor=actor,
            reason=f"Member transferred from {from_name} to {transfer.to_club.name}.",
            status_before=license.status,
            status_after=license.status,
            metadata={
                "event": "club_transfer",
                "from_club_id": transfer.from_club_id,
                "to_club_id": transfer.to_club_id,
                "transfer_id": transfer.id,
            },
        )
    transfer.status = MemberTransfer.Status.COMPLETED
    transfer.decided_by = actor
    transfer.completed_at = timezone.now()
    transfer.save(update_fields=["status", "decided_by", "completed_at", "updated_at"])


def accept_transfer(*, user: User, transfer_id: int, locale: str | None = None) -> dict:
    transfer = get_transfer(user=user, transfer_id=transfer_id)
    if transfer.status != MemberTransfer.Status.PENDING:
        raise TransferError({"detail": "transfer_not_pending"}, 400)
    if not _user_admins_club(user, transfer.to_club):
        raise TransferError({"detail": "Not allowed."}, 403)
    with transaction.atomic():
        _complete_transfer(transfer, actor=user)
    send_member_transfer_status_email(transfer, kind="accepted", locale=locale)
    if transfer.fee_amount > 0:
        cache.delete("dashboard:overview:ltf_admin:v3")
    return serialize_transfer(get_transfer(user=user, transfer_id=transfer.id))


def reject_transfer(*, user: User, transfer_id: int, locale: str | None = None) -> dict:
    transfer = get_transfer(user=user, transfer_id=transfer_id)
    if transfer.status != MemberTransfer.Status.PENDING:
        raise TransferError({"detail": "transfer_not_pending"}, 400)
    if not _user_admins_club(user, transfer.to_club):
        raise TransferError({"detail": "Not allowed."}, 403)
    transfer.status = MemberTransfer.Status.REJECTED
    transfer.decided_by = user
    transfer.save(update_fields=["status", "decided_by", "updated_at"])
    send_member_transfer_status_email(transfer, kind="rejected", locale=locale)
    if transfer.fee_amount > 0:
        cache.delete("dashboard:overview:ltf_admin:v3")
    return serialize_transfer(get_transfer(user=user, transfer_id=transfer.id))


def cancel_transfer(*, user: User, transfer_id: int, locale: str | None = None) -> dict:
    transfer = get_transfer(user=user, transfer_id=transfer_id)
    if transfer.status != MemberTransfer.Status.PENDING:
        raise TransferError({"detail": "transfer_not_pending"}, 400)
    if not _user_admins_club(user, transfer.from_club):
        raise TransferError({"detail": "Not allowed."}, 403)
    transfer.status = MemberTransfer.Status.CANCELLED
    transfer.decided_by = user
    transfer.save(update_fields=["status", "decided_by", "updated_at"])
    send_member_transfer_status_email(transfer, kind="cancelled", locale=locale)
    if transfer.fee_amount > 0:
        cache.delete("dashboard:overview:ltf_admin:v3")
    return serialize_transfer(get_transfer(user=user, transfer_id=transfer.id))
