from __future__ import annotations

from typing import Any, Mapping

from django.db import transaction
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
    updated_order = False
    updated_invoice = False
    activated_any = False
    order_status_before = order.status
    invoice_snapshot = Invoice.objects.filter(order=order).first()
    invoice_status_before = invoice_snapshot.status if invoice_snapshot else None
    license_status_before = {}
    activated_licenses = []

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

        invoice = invoice_snapshot or Invoice.objects.filter(order=order).first()
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
        for item in order.items.select_related("license").all():
            license_record = item.license
            license_status_before[license_record.id] = license_record.status
            if license_record.status != License.Status.ACTIVE:
                license_record.status = License.Status.ACTIVE
                license_record.issued_at = now
                license_record.save(update_fields=["status", "issued_at", "updated_at"])
                activated_any = True
                activated_license_ids.append(license_record.id)
                activated_licenses.append((license_record, license_status_before[license_record.id]))

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

            if payment_reference:
                payment_exists = Payment.objects.filter(
                    invoice=invoice, reference=payment_reference
                ).exists()
            else:
                payment_exists = Payment.objects.filter(
                    invoice=invoice,
                    method=payment_method,
                    amount=payment_amount,
                    currency=payment_currency,
                    paid_at=payment_paid_at,
                ).exists()
            if not payment_exists:
                created_payment = Payment.objects.create(
                    invoice=invoice,
                    order=order,
                    amount=payment_amount,
                    currency=payment_currency,
                    method=payment_method,
                    provider=payment_provider,
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
                    "license_status_before": license_status_before,
                },
            )

    return updated_order or updated_invoice or activated_any
