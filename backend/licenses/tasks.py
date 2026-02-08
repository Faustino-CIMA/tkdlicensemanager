from __future__ import annotations

import base64

from celery import shared_task
from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

from accounts.email_utils import send_resend_email

from .models import FinanceAuditLog, Invoice, Order
from .pdf_utils import build_invoice_context, render_invoice_pdf
from .services import apply_payment_and_activate

@shared_task
def activate_order_from_stripe(order_id: int, stripe_data: dict | None = None) -> None:
    try:
        order = Order.objects.select_related("club", "member", "member__user").get(
            id=order_id
        )
    except Order.DoesNotExist:
        return

    if order.member and order.member.user and not order.member.user.consent_given:
        FinanceAuditLog.objects.create(
            action="order.payment_blocked",
            message="Stripe task skipped because consent is missing.",
            actor=None,
            club=order.club,
            member=order.member,
            order=order,
            invoice=None,
            metadata={"reason": "consent_missing"},
        )
        return

    apply_payment_and_activate(order, actor=None, stripe_data=stripe_data or {})


@shared_task
def process_stripe_webhook_event(event_payload: dict) -> None:
    event_type = event_payload.get("event_type")
    if event_type not in {"checkout.session.completed", "payment_intent.succeeded"}:
        return
    metadata = event_payload.get("metadata", {}) or {}
    order_id = metadata.get("order_id")
    stripe_data = {}

    if event_type == "checkout.session.completed":
        stripe_data = {
            "stripe_checkout_session_id": event_payload.get("id"),
            "stripe_payment_intent_id": event_payload.get("payment_intent"),
            "stripe_customer_id": event_payload.get("customer"),
        }
    elif event_type == "payment_intent.succeeded":
        stripe_data = {
            "stripe_payment_intent_id": event_payload.get("id"),
            "stripe_customer_id": event_payload.get("customer"),
        }

    try:
        order_id_int = int(order_id)
    except (TypeError, ValueError):
        order_id_int = None
    if not order_id_int:
        return

    order = Order.objects.filter(id=order_id_int).select_related("member__user").first()
    if not order:
        return
    if order.member and order.member.user and not order.member.user.consent_given:
        invoice = Invoice.objects.filter(order=order).first()
        FinanceAuditLog.objects.create(
            action="order.payment_blocked",
            message="Payment webhook received but consent missing.",
            actor=None,
            club=order.club,
            member=order.member,
            order=order,
            invoice=invoice,
            metadata={"reason": "consent_missing"},
        )
        return

    activate_order_from_stripe.delay(order_id_int, stripe_data)


@shared_task
def send_invoice_email(invoice_id: int, recipients: list[str] | None = None) -> None:
    invoice = (
        Invoice.objects.select_related("order", "club", "member")
        .prefetch_related("order__items__license")
        .filter(id=invoice_id)
        .first()
    )
    if not invoice:
        return

    recipient_list = recipients or []
    if invoice.member and invoice.member.email:
        recipient_list.append(invoice.member.email)
    recipient_list.extend(
        [email for email in invoice.club.admins.values_list("email", flat=True) if email]
    )
    recipient_list = list(dict.fromkeys(recipient_list))
    if not recipient_list:
        FinanceAuditLog.objects.create(
            action="invoice.email_skipped",
            message="Invoice email skipped because no recipients were found.",
            actor=None,
            club=invoice.club,
            member=invoice.member,
            order=invoice.order,
            invoice=invoice,
            metadata={"reason": "no_recipients"},
        )
        return

    pdf_bytes = render_invoice_pdf(invoice, base_url=settings.FRONTEND_BASE_URL)
    if not pdf_bytes:
        FinanceAuditLog.objects.create(
            action="invoice.email_skipped",
            message="Invoice email skipped because PDF generation failed.",
            actor=None,
            club=invoice.club,
            member=invoice.member,
            order=invoice.order,
            invoice=invoice,
            metadata={"reason": "pdf_generation_failed"},
        )
        return

    context = build_invoice_context(invoice)
    html = render_to_string("finance/invoice_email.html", context)
    text = render_to_string("finance/invoice_email.txt", context)
    attachment = {
        "filename": f"invoice_{invoice.invoice_number}.pdf",
        "content": base64.b64encode(pdf_bytes).decode("ascii"),
    }
    for recipient in recipient_list:
        success, error = send_resend_email(
            recipient,
            f"Invoice {invoice.invoice_number}",
            html,
            text,
            attachments=[attachment],
        )
        FinanceAuditLog.objects.create(
            action="invoice.email_sent" if success else "invoice.email_failed",
            message="Invoice email dispatched." if success else f"Invoice email failed: {error}",
            actor=None,
            club=invoice.club,
            member=invoice.member,
            order=invoice.order,
            invoice=invoice,
            metadata={
                "recipient": recipient,
                "sent_at": timezone.now().isoformat(),
                "error": error if not success else "",
            },
        )
