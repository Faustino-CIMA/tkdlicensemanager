from __future__ import annotations

from typing import Any, Mapping

from django.db import transaction
from django.utils import timezone

from .models import FinanceAuditLog, Invoice, License, Order


def apply_payment_and_activate(
    order: Order,
    *,
    actor=None,
    stripe_data: Mapping[str, Any] | None = None,
    message: str = "Payment confirmed and licenses activated.",
) -> bool:
    stripe_data = stripe_data or {}
    now = timezone.now()
    updated_order = False
    updated_invoice = False
    activated_any = False
    order_status_before = order.status
    invoice_snapshot = Invoice.objects.filter(order=order).first()
    invoice_status_before = invoice_snapshot.status if invoice_snapshot else None
    license_status_before = {}

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

        if updated_invoice and invoice and invoice.status == Invoice.Status.PAID:
            from .tasks import send_invoice_email

            transaction.on_commit(lambda: send_invoice_email.delay(invoice.id))

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
