from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from clubs.models import Club
from members.models import Member

from .models import (
    ClubFeeBillingSchedule,
    ClubFeePrice,
    ClubFeeType,
    FinanceAuditLog,
    Invoice,
    Order,
    OrderItem,
)


class ClubFeeBillingError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def advance_schedule_date(value: date, recurrence: str) -> date:
    if recurrence == ClubFeeBillingSchedule.Recurrence.MONTHLY:
        month = value.month + 1
        year = value.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
    else:
        year = value.year + 1
        month = value.month
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _quantity_for_fee(fee_type: ClubFeeType, club: Club) -> int:
    if fee_type.cadence == ClubFeeType.Cadence.PER_MEMBER:
        return Member.objects.filter(club=club, is_active=True).count()
    return 1


def bill_club_fees(
    *,
    fee_types: list[ClubFeeType],
    clubs: list[Club],
    billed_on: date,
    actor=None,
    schedule: ClubFeeBillingSchedule | None = None,
) -> list[Invoice]:
    if not fee_types:
        raise ClubFeeBillingError("Select at least one club fee.")
    invoices: list[Invoice] = []
    with transaction.atomic():
        for club in clubs:
            if not club.is_active:
                continue
            items: list[tuple[ClubFeeType, ClubFeePrice, int]] = []
            currency = "EUR"
            subtotal = Decimal("0.00")
            for fee_type in fee_types:
                if not fee_type.is_active:
                    continue
                price = ClubFeePrice.get_active_price(fee_type=fee_type, as_of=billed_on)
                if price is None:
                    continue
                quantity = _quantity_for_fee(fee_type, club)
                if quantity <= 0:
                    continue
                items.append((fee_type, price, quantity))
                currency = price.currency
                subtotal += price.amount * quantity
            if not items:
                continue
            order = Order.objects.create(
                club=club,
                member=None,
                status=Order.Status.PENDING,
                currency=currency,
                subtotal=subtotal,
                tax_total=Decimal("0.00"),
                total=subtotal,
            )
            OrderItem.objects.bulk_create(
                [
                    OrderItem(
                        order=order,
                        license=None,
                        fee_type=fee_type,
                        description=fee_type.name,
                        price_snapshot=price.amount,
                        quantity=quantity,
                    )
                    for fee_type, price, quantity in items
                ]
            )
            invoice = Invoice.objects.create(
                order=order,
                club=club,
                member=None,
                status=Invoice.Status.ISSUED,
                currency=currency,
                subtotal=subtotal,
                tax_total=Decimal("0.00"),
                total=subtotal,
                issued_at=timezone.now(),
            )
            FinanceAuditLog.objects.create(
                action="club_fee.billed",
                message="Club fee invoice created.",
                actor=actor,
                club=club,
                order=order,
                invoice=invoice,
                metadata={
                    "billed_on": billed_on.isoformat(),
                    "fee_type_ids": [fee_type.id for fee_type, _price, _qty in items],
                    "schedule_id": schedule.id if schedule else None,
                    "total": str(subtotal),
                },
            )
            invoices.append(invoice)
    return invoices


def create_billing_run(
    *,
    fee_type_ids: list[int],
    club_ids: list[int] | None,
    billed_on: date,
    recurring: bool,
    recurrence: str | None,
    actor=None,
) -> dict:
    fee_types = list(ClubFeeType.objects.filter(id__in=fee_type_ids, is_active=True))
    if not fee_types:
        raise ClubFeeBillingError("Select at least one active club fee.")
    if club_ids:
        clubs = list(Club.objects.filter(id__in=club_ids, is_active=True))
        all_active = False
    else:
        clubs = list(Club.objects.filter(is_active=True))
        all_active = True
    if not clubs:
        raise ClubFeeBillingError("No active clubs to bill.")

    invoices = bill_club_fees(
        fee_types=fee_types,
        clubs=clubs,
        billed_on=billed_on,
        actor=actor,
    )

    schedules: list[ClubFeeBillingSchedule] = []
    if recurring:
        if recurrence not in {
            ClubFeeBillingSchedule.Recurrence.MONTHLY,
            ClubFeeBillingSchedule.Recurrence.ANNUAL,
        }:
            raise ClubFeeBillingError("Choose a monthly or annual recurrence.")
        next_run = advance_schedule_date(billed_on, recurrence)
        for fee_type in fee_types:
            schedule = ClubFeeBillingSchedule.objects.create(
                fee_type=fee_type,
                recurrence=recurrence,
                next_run_on=next_run,
                all_active_clubs=all_active,
                is_active=True,
                created_by=actor if getattr(actor, "is_authenticated", False) else None,
            )
            if not all_active:
                schedule.clubs.set(clubs)
            schedules.append(schedule)

    return {
        "invoice_ids": [invoice.id for invoice in invoices],
        "invoice_count": len(invoices),
        "schedule_ids": [schedule.id for schedule in schedules],
        "billed_on": billed_on.isoformat(),
    }


def run_due_schedules(*, as_of: date | None = None) -> list[int]:
    today = as_of or timezone.localdate()
    due = ClubFeeBillingSchedule.objects.filter(
        is_active=True,
        next_run_on__lte=today,
    ).select_related("fee_type")
    invoice_ids: list[int] = []
    for schedule in due:
        if schedule.end_on and schedule.end_on < today:
            schedule.is_active = False
            schedule.save(update_fields=["is_active", "updated_at"])
            continue
        if not schedule.fee_type.is_active:
            continue
        clubs = (
            list(Club.objects.filter(is_active=True))
            if schedule.all_active_clubs
            else list(schedule.clubs.filter(is_active=True))
        )
        invoices = bill_club_fees(
            fee_types=[schedule.fee_type],
            clubs=clubs,
            billed_on=today,
            actor=schedule.created_by,
            schedule=schedule,
        )
        invoice_ids.extend(invoice.id for invoice in invoices)
        schedule.last_run_on = today
        schedule.next_run_on = advance_schedule_date(schedule.next_run_on, schedule.recurrence)
        schedule.save(update_fields=["last_run_on", "next_run_on", "updated_at"])
    return invoice_ids
