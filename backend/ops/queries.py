from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Count, Q
from django.utils import timezone

from accounts.models import User
from clubs.models import Club, FederationProfile
from licenses.models import (
    ClubFeeBillingSchedule,
    FinanceAuditLog,
    Invoice,
    License,
    OrderItem,
    Payment,
    PrintJob,
)
from members.models import Member, MemberTransfer
from rest_framework.authtoken.models import Token

from .models import AuthEvent, OpsAuditLog


class QueryError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _int_param(params: dict, name: str, default: int) -> int:
    raw = params.get(name, default)
    try:
        return int(raw)
    except (TypeError, ValueError) as exc:
        raise QueryError(f"Invalid integer parameter '{name}'.") from exc


def _rows(values):
    rows = list(values)
    if not rows:
        return [], []
    columns = list(rows[0].keys())
    return columns, rows


def q_active_sessions(params: dict):
    minutes = _int_param(params, "minutes", int(getattr(settings, "OPS_SESSION_ONLINE_MINUTES", 15)))
    since = timezone.now() - timedelta(minutes=minutes)
    qs = (
        Token.objects.select_related("user", "ops_meta")
        .filter(ops_meta__last_used_at__gte=since)
        .order_by("-ops_meta__last_used_at")
    )
    rows = [
        {
            "username": token.user.username,
            "role": token.user.role,
            "is_superuser": token.user.is_superuser,
            "last_used_at": getattr(token.ops_meta, "last_used_at", None),
            "last_ip": getattr(token.ops_meta, "last_ip", None),
            "user_agent": getattr(token.ops_meta, "user_agent", ""),
        }
        for token in qs[:500]
    ]
    columns = ["username", "role", "is_superuser", "last_used_at", "last_ip", "user_agent"]
    return columns, rows


def q_failed_logins(params: dict):
    hours = _int_param(params, "hours", 24)
    since = timezone.now() - timedelta(hours=hours)
    qs = (
        AuthEvent.objects.filter(
            event_type=AuthEvent.EventType.LOGIN_FAILURE,
            created_at__gte=since,
        )
        .values("username_attempted", "ip")
        .annotate(failures=Count("id"))
        .order_by("-failures")
    )
    return _rows(qs[:500])


def q_accounts_hygiene(_params: dict):
    users = User.objects.all().order_by("username")
    rows = [
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "is_active": user.is_active,
            "is_superuser": user.is_superuser,
            "is_email_verified": user.is_email_verified,
            "last_login": user.last_login,
        }
        for user in users
        if (not user.is_email_verified) or (not user.is_active) or user.is_superuser
    ]
    columns = [
        "id",
        "username",
        "email",
        "role",
        "is_active",
        "is_superuser",
        "is_email_verified",
        "last_login",
    ]
    return columns, rows[:500]


def q_clubs_without_admin(_params: dict):
    qs = (
        Club.objects.annotate(admin_count=Count("admins"))
        .filter(admin_count=0)
        .values("id", "name", "is_active", "admin_count")
        .order_by("name")
    )
    return _rows(qs[:500])


def q_inactive_clubs_with_schedules(_params: dict):
    qs = (
        Club.objects.filter(is_active=False, fee_billing_schedules__is_active=True)
        .distinct()
        .values("id", "name")
        .order_by("name")
    )
    return _rows(qs[:500])


def q_members_without_active_license(params: dict):
    year = _int_param(params, "year", timezone.localdate().year)
    qs = (
        Member.objects.filter(is_active=True)
        .exclude(licenses__status=License.Status.ACTIVE, licenses__year=year)
        .values("id", "first_name", "last_name", "club_id", "email")
        .order_by("last_name", "first_name")
    )
    return _rows(qs[:500])


def q_overdue_invoices(params: dict):
    days = _int_param(params, "days", 30)
    cutoff = timezone.now() - timedelta(days=days)
    qs = (
        Invoice.objects.filter(status=Invoice.Status.ISSUED, issued_at__lt=cutoff)
        .values("id", "invoice_number", "club_id", "total", "currency", "issued_at", "status")
        .order_by("issued_at")
    )
    return _rows(qs[:500])


def q_payments_in_flight(_params: dict):
    qs = (
        Payment.objects.exclude(status__in=[Payment.Status.PAID, Payment.Status.FAILED, Payment.Status.CANCELLED])
        .values("id", "status", "provider", "amount", "currency", "created_at")
        .order_by("-created_at")
    )
    return _rows(qs[:500])


def q_duplicate_emails(_params: dict):
    member_dupes = (
        Member.objects.exclude(email="")
        .values("email")
        .annotate(count=Count("id"))
        .filter(count__gt=1)
        .order_by("-count")
    )
    user_dupes = (
        User.objects.exclude(email="")
        .values("email")
        .annotate(count=Count("id"))
        .filter(count__gt=1)
        .order_by("-count")
    )
    rows = [{"source": "member", **row} for row in member_dupes]
    rows.extend({"source": "user", **row} for row in user_dupes)
    columns = ["source", "email", "count"]
    return columns, rows[:500]


def q_orphan_order_items(_params: dict):
    qs = (
        OrderItem.objects.filter(
            Q(license__isnull=True, fee_type__isnull=True)
            | Q(license__isnull=False, fee_type__isnull=False)
        )
        .values("id", "order_id", "license_id", "fee_type_id", "description", "quantity")
        .order_by("-id")
    )
    return _rows(qs[:500])


def q_club_tourists(_params: dict):
    threshold = 3
    profile = FederationProfile.objects.first()
    if profile is not None:
        threshold = int(profile.club_tourist_transfer_threshold or 3)
    qs = (
        Member.objects.annotate(
            completed_transfers=Count(
                "transfers",
                filter=Q(transfers__status=MemberTransfer.Status.COMPLETED),
            )
        )
        .filter(completed_transfers__gte=threshold)
        .values("id", "first_name", "last_name", "club_id", "completed_transfers")
        .order_by("-completed_transfers")
    )
    return _rows(qs[:500])


def q_stuck_print_jobs(params: dict):
    minutes = _int_param(params, "minutes", 30)
    cutoff = timezone.now() - timedelta(minutes=minutes)
    qs = (
        PrintJob.objects.filter(
            status__in=[PrintJob.Status.QUEUED, PrintJob.Status.RUNNING],
            updated_at__lt=cutoff,
        )
        .values("id", "job_number", "club_id", "status", "queued_at", "started_at", "updated_at", "error_detail")
        .order_by("updated_at")
    )
    return _rows(qs[:500])


def q_translation_gaps(_params: dict):
    from .i18n import translation_rows

    rows = [
        {"key": row["key"], "en": row["en"], "lb": row["lb"]}
        for row in translation_rows(missing_only=True)
    ]
    columns = ["key", "en", "lb"]
    return columns, rows[:500]


def q_audit_counts(_params: dict):
    since = timezone.now() - timedelta(days=7)
    rows = [
        {
            "log": "ops",
            "count": OpsAuditLog.objects.filter(created_at__gte=since).count(),
        },
        {
            "log": "finance",
            "count": FinanceAuditLog.objects.filter(created_at__gte=since).count(),
        },
        {
            "log": "auth_events",
            "count": AuthEvent.objects.filter(created_at__gte=since).count(),
        },
        {
            "log": "active_billing_schedules",
            "count": ClubFeeBillingSchedule.objects.filter(is_active=True).count(),
        },
    ]
    columns = ["log", "count"]
    return columns, rows


QUERY_CATALOG = [
    {
        "id": "active_sessions",
        "title": "Active sessions",
        "description": "Tokens used within the last N minutes.",
        "params": [{"name": "minutes", "type": "integer", "default": 15}],
        "run": q_active_sessions,
    },
    {
        "id": "failed_logins",
        "title": "Failed logins",
        "description": "Failed login counts grouped by username and IP.",
        "params": [{"name": "hours", "type": "integer", "default": 24}],
        "run": q_failed_logins,
    },
    {
        "id": "accounts_hygiene",
        "title": "Unverified, inactive, and superuser accounts",
        "description": "Accounts that need ops attention.",
        "params": [],
        "run": q_accounts_hygiene,
    },
    {
        "id": "clubs_without_admin",
        "title": "Clubs without a club admin",
        "description": "Clubs with zero assigned admins.",
        "params": [],
        "run": q_clubs_without_admin,
    },
    {
        "id": "inactive_clubs_with_schedules",
        "title": "Inactive clubs still on a billing schedule",
        "description": "Inactive clubs linked to an active club-fee schedule.",
        "params": [],
        "run": q_inactive_clubs_with_schedules,
    },
    {
        "id": "members_without_active_license",
        "title": "Members without an active license",
        "description": "Active members missing an active license for the given year.",
        "params": [{"name": "year", "type": "integer", "default": timezone.localdate().year}],
        "run": q_members_without_active_license,
    },
    {
        "id": "overdue_invoices",
        "title": "Overdue issued invoices",
        "description": "Issued invoices older than N days that are still unpaid.",
        "params": [{"name": "days", "type": "integer", "default": 30}],
        "run": q_overdue_invoices,
    },
    {
        "id": "payments_in_flight",
        "title": "Payments in flight",
        "description": "Payments that are not paid, failed, or refunded.",
        "params": [],
        "run": q_payments_in_flight,
    },
    {
        "id": "duplicate_emails",
        "title": "Duplicate emails",
        "description": "Member and user emails that appear more than once.",
        "params": [],
        "run": q_duplicate_emails,
    },
    {
        "id": "orphan_order_items",
        "title": "Inconsistent order items",
        "description": "Order items with neither or both of license and fee type set.",
        "params": [],
        "run": q_orphan_order_items,
    },
    {
        "id": "club_tourists",
        "title": "Club-tourist members",
        "description": "Members at or above the federation club-tourist transfer threshold.",
        "params": [],
        "run": q_club_tourists,
    },
    {
        "id": "stuck_print_jobs",
        "title": "Stuck print jobs",
        "description": "Queued or running print jobs not updated for N minutes.",
        "params": [{"name": "minutes", "type": "integer", "default": 30}],
        "run": q_stuck_print_jobs,
    },
    {
        "id": "translation_gaps",
        "title": "Translation keys missing in Luxembourgish",
        "description": "Keys that are empty in lb after overlays.",
        "params": [],
        "run": q_translation_gaps,
    },
    {
        "id": "audit_counts",
        "title": "Recent audit counts",
        "description": "Ops, finance, and auth event counts for the last 7 days.",
        "params": [],
        "run": q_audit_counts,
    },
]

QUERY_BY_ID = {item["id"]: item for item in QUERY_CATALOG}


def catalog_public():
    return [
        {
            "id": item["id"],
            "title": item["title"],
            "description": item["description"],
            "params": item["params"],
        }
        for item in QUERY_CATALOG
    ]


def run_query(query_id: str, params: dict | None = None):
    spec = QUERY_BY_ID.get(query_id)
    if spec is None:
        raise QueryError("Unknown query.", status_code=404)
    timeout_ms = int(getattr(settings, "OPS_QUERY_TIMEOUT_MS", 5000))
    max_rows = int(getattr(settings, "OPS_QUERY_MAX_ROWS", 500))
    with transaction.atomic():
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"SET LOCAL statement_timeout = {int(timeout_ms)}")
        except Exception:
            pass
        columns, rows = spec["run"](params or {})
    rows = rows[:max_rows]
    serialized = []
    for row in rows:
        serialized.append({key: _jsonable(row.get(key)) for key in columns})
    return {"id": query_id, "columns": columns, "rows": serialized, "row_count": len(serialized)}


def _jsonable(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
