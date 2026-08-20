from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.utils import timezone
from rest_framework import serializers

from members.models import Member

from .models import License, LicenseType, LicenseTypePolicy


def _window_includes(order_date: date, *, start_month: int, start_day: int, end_month: int, end_day: int) -> bool:
    try:
        start_date = date(order_date.year, start_month, start_day)
        end_date = date(order_date.year, end_month, end_day)
    except ValueError as exc:
        raise serializers.ValidationError(f"Invalid policy date configuration: {exc}") from exc

    if start_date > end_date:
        raise serializers.ValidationError(
            "Invalid policy window configuration. Start date must be before end date."
        )
    return start_date <= order_date <= end_date


def get_or_create_license_type_policy(license_type: LicenseType) -> LicenseTypePolicy:
    policy, _ = LicenseTypePolicy.objects.get_or_create(license_type=license_type)
    return policy


def _safe_window_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError:
        if month == 12:
            return date(year, 12, 31)
        return date(year, month + 1, 1) - timedelta(days=1)


def _local_start_datetime(day: date) -> datetime:
    naive = datetime.combine(day, time.min)
    current_tz = timezone.get_current_timezone()
    if timezone.is_naive(naive):
        return timezone.make_aware(naive, current_tz)
    return naive


def describe_license_order_availability(
    *,
    policy: LicenseTypePolicy,
    target_year: int,
    order_date: date,
    reason_codes: set[str] | None = None,
    next_price_effective_from: date | None = None,
) -> dict[str, str | bool | None]:
    """Return the configured window and the next time this type can be ordered."""
    reasons = set(reason_codes or [])
    current_year = order_date.year
    enabled = False
    window_start: date | None = None
    window_end: date | None = None

    if target_year == current_year:
        enabled = bool(policy.allow_current_year_order)
        window_start = _safe_window_date(
            current_year, policy.current_start_month, policy.current_start_day
        )
        window_end = _safe_window_date(
            current_year, policy.current_end_month, policy.current_end_day
        )
    elif target_year == current_year + 1:
        enabled = bool(policy.allow_next_year_preorder)
        window_start = _safe_window_date(
            current_year, policy.next_start_month, policy.next_start_day
        )
        window_end = _safe_window_date(
            current_year, policy.next_end_month, policy.next_end_day
        )

    is_open = bool(
        enabled and window_start and window_end and window_start <= order_date <= window_end
    )
    opens_at: datetime | None = None
    if enabled and window_start and window_end and not is_open:
        if order_date < window_start:
            opens_at = _local_start_datetime(window_start)
        elif order_date > window_end:
            next_cycle_start = _safe_window_date(
                window_start.year + 1, window_start.month, window_start.day
            )
            opens_at = _local_start_datetime(next_cycle_start)

    if "no_active_price" in reasons and next_price_effective_from:
        if next_price_effective_from > order_date:
            price_opens_at = _local_start_datetime(next_price_effective_from)
            if opens_at is None or price_opens_at > opens_at:
                opens_at = price_opens_at

    if reasons and reasons <= {"duplicate_pending_or_active"}:
        opens_at = None
    if reasons & {"current_year_disabled", "next_year_disabled"}:
        opens_at = None

    return {
        "enabled": enabled,
        "is_open": is_open,
        "window_start": window_start.isoformat() if window_start else None,
        "window_end": window_end.isoformat() if window_end else None,
        "opens_at": opens_at.isoformat() if opens_at else None,
    }


def validate_member_license_order(
    *,
    member: Member,
    license_type: LicenseType,
    target_year: int,
    order_date: date | None = None,
    policy: LicenseTypePolicy | None = None,
    duplicate_exists: bool | None = None,
) -> LicenseTypePolicy:
    order_date = order_date or timezone.localdate()
    current_year = order_date.year
    policy = policy or get_or_create_license_type_policy(license_type)

    if target_year not in [current_year, current_year + 1]:
        raise serializers.ValidationError(
            "Only current-year and next-year license orders are allowed."
        )

    if target_year == current_year:
        if not policy.allow_current_year_order:
            raise serializers.ValidationError(
                f"Ordering current-year licenses is disabled for '{license_type.name}'."
            )
        if not _window_includes(
            order_date,
            start_month=policy.current_start_month,
            start_day=policy.current_start_day,
            end_month=policy.current_end_month,
            end_day=policy.current_end_day,
        ):
            raise serializers.ValidationError(
                f"Ordering window is closed for current-year '{license_type.name}' licenses."
            )
    else:
        if not policy.allow_next_year_preorder:
            raise serializers.ValidationError(
                f"Pre-ordering next-year licenses is disabled for '{license_type.name}'."
            )
        if not _window_includes(
            order_date,
            start_month=policy.next_start_month,
            start_day=policy.next_start_day,
            end_month=policy.next_end_month,
            end_day=policy.next_end_day,
        ):
            raise serializers.ValidationError(
                f"Pre-order window is closed for next-year '{license_type.name}' licenses."
            )

    if duplicate_exists is None:
        duplicate_exists = License.objects.filter(
            member=member,
            license_type=license_type,
            year=target_year,
            status__in=[License.Status.PENDING, License.Status.ACTIVE],
        ).exists()
    if duplicate_exists:
        raise serializers.ValidationError(
            f"{member.first_name} {member.last_name} already has a pending or active "
            f"'{license_type.name}' license for {target_year}."
        )

    return policy
