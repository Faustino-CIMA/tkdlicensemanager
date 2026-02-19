from __future__ import annotations

from datetime import date

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
