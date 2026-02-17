from __future__ import annotations

import base64

from celery import shared_task
from django.conf import settings
from django.db import IntegrityError
from django.db.models import Q
from django.template.loader import render_to_string
from django.utils import timezone
import stripe

from accounts.email_utils import send_resend_email

from .history import expire_outdated_licenses, log_license_status_change
from .models import FinanceAuditLog, Invoice, License, Order
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

    stripe_data = stripe_data or {}
    payment_details = stripe_data.pop("payment_details", None)
    apply_payment_and_activate(
        order,
        actor=None,
        stripe_data=stripe_data,
        payment_details=payment_details,
    )


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

    payment_details = {}
    card_brand = event_payload.get("card_brand")
    card_last4 = event_payload.get("card_last4")
    card_exp_month = event_payload.get("card_exp_month")
    card_exp_year = event_payload.get("card_exp_year")
    if card_brand or card_last4 or card_exp_month or card_exp_year:
        payment_details.update(
            {
                "payment_method": "card",
                "payment_provider": "stripe",
                "card_brand": card_brand,
                "card_last4": card_last4,
                "card_exp_month": card_exp_month,
                "card_exp_year": card_exp_year,
            }
        )
    if payment_details:
        stripe_data["payment_details"] = payment_details

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
def reconcile_pending_stripe_orders(limit: int = 100) -> int:
    if not settings.STRIPE_SECRET_KEY:
        return 0

    stripe.api_key = settings.STRIPE_SECRET_KEY
    stripe.api_version = settings.STRIPE_API_VERSION

    pending_orders = (
        Order.objects.filter(status__in=[Order.Status.DRAFT, Order.Status.PENDING])
        .filter(
            Q(stripe_payment_intent_id__isnull=False)
            | Q(stripe_checkout_session_id__isnull=False)
        )
        .exclude(stripe_payment_intent_id="")
        .select_related("member__user")
        .order_by("-updated_at")[:limit]
    )

    # Include orders that only have checkout session IDs (without PI cached on order).
    if len(pending_orders) < limit:
        session_only_orders = (
            Order.objects.filter(status__in=[Order.Status.DRAFT, Order.Status.PENDING])
            .filter(stripe_checkout_session_id__isnull=False)
            .exclude(stripe_checkout_session_id="")
            .exclude(id__in=[order.id for order in pending_orders])
            .select_related("member__user")
            .order_by("-updated_at")[: max(0, limit - len(pending_orders))]
        )
        pending_orders = list(pending_orders) + list(session_only_orders)
    else:
        pending_orders = list(pending_orders)

    processed_count = 0
    for order in pending_orders:
        stripe_data = {}
        payment_details = {}
        payment_intent_id = order.stripe_payment_intent_id or ""
        checkout_session_id = order.stripe_checkout_session_id or ""

        try:
            if checkout_session_id:
                session = stripe.checkout.Session.retrieve(checkout_session_id)
                if session.get("payment_status") != "paid":
                    continue
                stripe_data["stripe_checkout_session_id"] = session.get("id")
                stripe_data["stripe_customer_id"] = session.get("customer")
                session_pi = session.get("payment_intent")
                if isinstance(session_pi, str) and session_pi:
                    payment_intent_id = session_pi
                    stripe_data["stripe_payment_intent_id"] = session_pi

            if payment_intent_id:
                payment_intent = stripe.PaymentIntent.retrieve(
                    payment_intent_id,
                    expand=["charges.data.payment_method_details"],
                )
                if payment_intent.get("status") != "succeeded":
                    continue
                stripe_data["stripe_payment_intent_id"] = payment_intent.get("id")
                stripe_data["stripe_customer_id"] = payment_intent.get("customer")
                charges = payment_intent.get("charges", {}).get("data", [])
                if charges:
                    card = charges[0].get("payment_method_details", {}).get("card", {}) or {}
                    payment_details = {
                        "payment_method": "card",
                        "payment_provider": "stripe",
                        "card_brand": card.get("brand") or "",
                        "card_last4": card.get("last4") or "",
                        "card_exp_month": card.get("exp_month"),
                        "card_exp_year": card.get("exp_year"),
                    }
            else:
                # No payment intent available and no paid checkout session.
                continue
        except stripe.error.StripeError:  # type: ignore[attr-defined]
            continue

        updated = apply_payment_and_activate(
            order,
            actor=None,
            stripe_data=stripe_data,
            payment_details=payment_details,
            message="Payment reconciled from Stripe provider state and licenses activated.",
        )
        if updated:
            processed_count += 1

    if processed_count:
        FinanceAuditLog.objects.create(
            action="stripe.reconciled",
            message=f"Reconciled {processed_count} pending Stripe orders.",
            metadata={"processed_count": processed_count},
        )

    return processed_count


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


@shared_task
def reconcile_expired_licenses() -> int:
    expired_count = expire_outdated_licenses(actor=None)
    if expired_count:
        FinanceAuditLog.objects.create(
            action="licenses.expiry_reconciled",
            message=f"Automatically expired {expired_count} licenses.",
            metadata={"expired_count": expired_count},
        )
    return expired_count


@shared_task
def activate_eligible_paid_licenses() -> int:
    today = timezone.localdate()
    now = timezone.now()
    eligible_licenses = (
        License.objects.filter(
            status=License.Status.PENDING,
            start_date__lte=today,
            end_date__gte=today,
            order_items__order__status=Order.Status.PAID,
        )
        .select_related("member", "club")
        .distinct()
    )

    activated_count = 0
    activated_license_ids = []
    conflict_license_ids = []
    for license_record in eligible_licenses:
        has_conflict = License.objects.filter(
            member=license_record.member,
            status=License.Status.ACTIVE,
        ).exclude(id=license_record.id).exists()
        if has_conflict:
            conflict_license_ids.append(license_record.id)
            continue
        previous_status = license_record.status
        license_record.status = License.Status.ACTIVE
        license_record.issued_at = now
        try:
            license_record.save(update_fields=["status", "issued_at", "updated_at"])
        except IntegrityError:
            conflict_license_ids.append(license_record.id)
            continue
        log_license_status_change(
            license_record,
            status_before=previous_status,
            actor=None,
            reason="Automatic deferred activation reconciliation task.",
            metadata={"source": "activate_eligible_paid_licenses"},
        )
        activated_count += 1
        activated_license_ids.append(license_record.id)

    if activated_count or conflict_license_ids:
        FinanceAuditLog.objects.create(
            action="licenses.activation_reconciled",
            message=f"Automatically activated {activated_count} eligible licenses.",
            metadata={
                "activated_count": activated_count,
                "activated_license_ids": activated_license_ids,
                "conflict_license_ids": conflict_license_ids,
            },
        )

    return activated_count
