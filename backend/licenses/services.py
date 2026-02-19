from __future__ import annotations

from typing import Any, Mapping

from django.db import IntegrityError, transaction
from django.utils import timezone

from .history import create_license_history_event, log_license_status_change
from .models import FinanceAuditLog, Invoice, License, LicenseHistoryEvent, Order, Payment


def apply_payment_and_activate(
    order: Order,
    *,
    actor=None,
    stripe_data: Mapping[str, Any] | None = None,
    payment_details: Mapping[str, Any] | None = None,
    message: str = "Payment confirmed and licenses activated.",
) -> bool:
    stripe_data = stripe_data or {}
    payment_details = payment_details or {}
    now = timezone.now()
    today = timezone.localdate()
    updated_order = False
    updated_invoice = False
    activated_any = False
    order_status_before = order.status
    try:
        invoice_snapshot = order.invoice
    except Invoice.DoesNotExist:
        invoice_snapshot = None
    invoice_status_before = invoice_snapshot.status if invoice_snapshot else None
    license_status_before = {}
    activated_licenses = []
    deferred_license_ids = []
    conflict_license_ids = []
    outside_validity_license_ids = []

    with transaction.atomic():
        order_update_fields = []
        stripe_payment_intent_id = stripe_data.get("stripe_payment_intent_id")
        stripe_checkout_session_id = stripe_data.get("stripe_checkout_session_id")

        if stripe_payment_intent_id and order.stripe_payment_intent_id != stripe_payment_intent_id:
            order.stripe_payment_intent_id = stripe_payment_intent_id
            order_update_fields.append("stripe_payment_intent_id")
        if stripe_checkout_session_id and order.stripe_checkout_session_id != stripe_checkout_session_id:
            order.stripe_checkout_session_id = stripe_checkout_session_id
            order_update_fields.append("stripe_checkout_session_id")

        if order.status != Order.Status.PAID:
            if order.status not in [Order.Status.DRAFT, Order.Status.PENDING]:
                return False
            order.status = Order.Status.PAID
            order_update_fields.append("status")

        if order_update_fields:
            order_update_fields.append("updated_at")
            order.save(update_fields=order_update_fields)
            updated_order = True

        invoice = invoice_snapshot
        if invoice:
            invoice_update_fields = []
            stripe_invoice_id = stripe_data.get("stripe_invoice_id")
            stripe_customer_id = stripe_data.get("stripe_customer_id")
            if stripe_invoice_id and invoice.stripe_invoice_id != stripe_invoice_id:
                invoice.stripe_invoice_id = stripe_invoice_id
                invoice_update_fields.append("stripe_invoice_id")
            if stripe_customer_id and invoice.stripe_customer_id != stripe_customer_id:
                invoice.stripe_customer_id = stripe_customer_id
                invoice_update_fields.append("stripe_customer_id")

            if invoice.status != Invoice.Status.PAID:
                invoice.status = Invoice.Status.PAID
                invoice.issued_at = invoice.issued_at or now
                invoice.paid_at = now
                invoice_update_fields.extend(["status", "issued_at", "paid_at"])

            if invoice_update_fields:
                invoice_update_fields.append("updated_at")
                invoice.save(update_fields=invoice_update_fields)
                updated_invoice = True

        activated_license_ids = []
        prefetched_cache = getattr(order, "_prefetched_objects_cache", {})
        order_items_queryset = order.items.all()
        if "items" not in prefetched_cache:
            order_items_queryset = order_items_queryset.select_related("license")
        order_items = list(order_items_queryset)
        candidate_licenses = [
            item.license
            for item in order_items
            if item.license.status != License.Status.ACTIVE
        ]
        candidate_license_ids = [license.id for license in candidate_licenses]
        candidate_member_ids = {license.member_id for license in candidate_licenses}
        member_ids_with_other_active_license = (
            set(
                License.objects.filter(
                    member_id__in=candidate_member_ids,
                    status=License.Status.ACTIVE,
                )
                .exclude(id__in=candidate_license_ids)
                .values_list("member_id", flat=True)
            )
            if candidate_member_ids
            else set()
        )

        for item in order_items:
            license_record = item.license
            license_status_before[license_record.id] = license_record.status
            if license_record.status != License.Status.ACTIVE:
                if license_record.start_date > today:
                    deferred_license_ids.append(license_record.id)
                    continue
                if license_record.end_date < today:
                    outside_validity_license_ids.append(license_record.id)
                    continue
                if license_record.member_id in member_ids_with_other_active_license:
                    conflict_license_ids.append(license_record.id)
                    continue
                license_record.status = License.Status.ACTIVE
                license_record.issued_at = now
                try:
                    license_record.save(update_fields=["status", "issued_at", "updated_at"])
                except IntegrityError:
                    conflict_license_ids.append(license_record.id)
                    member_ids_with_other_active_license.add(license_record.member_id)
                    continue
                activated_any = True
                activated_license_ids.append(license_record.id)
                activated_licenses.append((license_record, license_status_before[license_record.id]))
                member_ids_with_other_active_license.add(license_record.member_id)

        created_payment = None

        if updated_invoice and invoice and invoice.status == Invoice.Status.PAID:
            from .tasks import send_invoice_email

            transaction.on_commit(lambda: send_invoice_email.delay(invoice.id))

        if invoice and invoice.status == Invoice.Status.PAID:
            payment_reference = (
                payment_details.get("payment_reference")
                or stripe_payment_intent_id
                or stripe_checkout_session_id
                or stripe_data.get("stripe_invoice_id")
            )
            payment_method = payment_details.get("payment_method")
            payment_provider = payment_details.get("payment_provider")
            card_brand = payment_details.get("card_brand") or ""
            card_last4 = payment_details.get("card_last4") or ""
            card_exp_month = payment_details.get("card_exp_month")
            card_exp_year = payment_details.get("card_exp_year")
            if not payment_method:
                if stripe_payment_intent_id or stripe_checkout_session_id or stripe_data.get("stripe_invoice_id"):
                    payment_method = Payment.Method.CARD
                    payment_provider = payment_provider or Payment.Provider.STRIPE
                else:
                    payment_method = Payment.Method.OFFLINE
                    payment_provider = payment_provider or Payment.Provider.MANUAL
            if not payment_provider:
                payment_provider = Payment.Provider.MANUAL
            payment_paid_at = payment_details.get("paid_at") or invoice.paid_at or now
            payment_amount = payment_details.get("amount") or invoice.total
            payment_currency = payment_details.get("currency") or invoice.currency
            payment_notes = payment_details.get("payment_notes") or ""
            existing_payment = None
            if payment_reference:
                existing_payment = (
                    Payment.objects.filter(invoice=invoice, reference=payment_reference)
                    .order_by("-created_at")
                    .first()
                )
            else:
                existing_payment = (
                    Payment.objects.filter(
                        invoice=invoice,
                        method=payment_method,
                        amount=payment_amount,
                        currency=payment_currency,
                        paid_at=payment_paid_at,
                    )
                    .order_by("-created_at")
                    .first()
                )

            if existing_payment:
                payment_update_fields = []
                if existing_payment.status != Payment.Status.PAID:
                    existing_payment.status = Payment.Status.PAID
                    payment_update_fields.append("status")
                if existing_payment.method != payment_method:
                    existing_payment.method = payment_method
                    payment_update_fields.append("method")
                if existing_payment.provider != payment_provider:
                    existing_payment.provider = payment_provider
                    payment_update_fields.append("provider")
                if payment_reference and existing_payment.reference != payment_reference:
                    existing_payment.reference = payment_reference
                    payment_update_fields.append("reference")
                if existing_payment.notes != payment_notes:
                    existing_payment.notes = payment_notes
                    payment_update_fields.append("notes")
                if existing_payment.card_brand != card_brand:
                    existing_payment.card_brand = card_brand
                    payment_update_fields.append("card_brand")
                if existing_payment.card_last4 != card_last4:
                    existing_payment.card_last4 = card_last4
                    payment_update_fields.append("card_last4")
                if existing_payment.card_exp_month != card_exp_month:
                    existing_payment.card_exp_month = card_exp_month
                    payment_update_fields.append("card_exp_month")
                if existing_payment.card_exp_year != card_exp_year:
                    existing_payment.card_exp_year = card_exp_year
                    payment_update_fields.append("card_exp_year")
                if existing_payment.paid_at != payment_paid_at:
                    existing_payment.paid_at = payment_paid_at
                    payment_update_fields.append("paid_at")
                if payment_update_fields:
                    existing_payment.save(update_fields=payment_update_fields)
                created_payment = existing_payment
            else:
                created_payment = Payment.objects.create(
                    invoice=invoice,
                    order=order,
                    amount=payment_amount,
                    currency=payment_currency,
                    method=payment_method,
                    provider=payment_provider,
                    status=Payment.Status.PAID,
                    reference=payment_reference or "",
                    notes=payment_notes,
                    card_brand=card_brand,
                    card_last4=card_last4,
                    card_exp_month=card_exp_month,
                    card_exp_year=card_exp_year,
                    paid_at=payment_paid_at,
                    created_by=actor,
                )

        for activated_license, previous_status in activated_licenses:
            log_license_status_change(
                activated_license,
                status_before=previous_status,
                actor=actor,
                reason="Payment confirmed and license activated.",
                order=order,
                payment=created_payment,
                metadata={"source": "apply_payment_and_activate"},
            )
            if created_payment:
                create_license_history_event(
                    activated_license,
                    event_type=LicenseHistoryEvent.EventType.PAYMENT_LINKED,
                    actor=actor,
                    reason="Payment linked to license.",
                    status_before=activated_license.status,
                    status_after=activated_license.status,
                    order=order,
                    payment=created_payment,
                    metadata={"source": "apply_payment_and_activate"},
                )

        if updated_order or updated_invoice or activated_any:
            FinanceAuditLog.objects.create(
                action="order.paid",
                message=message,
                actor=actor,
                club=order.club,
                member=order.member,
                order=order,
                invoice=invoice if invoice else None,
                metadata={
                    "order_status_before": order_status_before,
                    "order_status_after": order.status,
                    "invoice_status_before": invoice_status_before,
                    "invoice_status_after": invoice.status if invoice else None,
                    "activated_license_ids": activated_license_ids,
                    "deferred_license_ids": deferred_license_ids,
                    "outside_validity_license_ids": outside_validity_license_ids,
                    "conflict_license_ids": conflict_license_ids,
                    "license_status_before": license_status_before,
                },
            )

    return updated_order or updated_invoice or activated_any
