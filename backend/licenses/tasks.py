from __future__ import annotations

import base64

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
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


STRIPE_RECONCILE_BACKOFF_SECONDS = 120
STRIPE_RECONCILE_ERROR_BACKOFF_SECONDS = 300


def _reconcile_not_before_key(order_id: int) -> str:
    return f"stripe:reconcile:not_before:{order_id}"


def _set_reconcile_backoff(order_id: int, seconds: int) -> None:
    if seconds <= 0:
        cache.delete(_reconcile_not_before_key(order_id))
        return
    cache.set(
        _reconcile_not_before_key(order_id),
        timezone.now().timestamp() + seconds,
        timeout=seconds,
    )


def _can_reconcile_now(order_id: int) -> bool:
    not_before = cache.get(_reconcile_not_before_key(order_id))
    if not_before is None:
        return True
    return timezone.now().timestamp() >= float(not_before)


@shared_task
def activate_order_from_stripe(order_id: int, stripe_data: dict | None = None) -> None:
    try:
        order = (
            Order.objects.select_related("club", "member", "member__user", "invoice")
            .prefetch_related("items__license")
            .get(id=order_id)
        )
    except Order.DoesNotExist:
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
    # Process immediately inside this worker task to avoid a second queue hop.
    activate_order_from_stripe(order_id_int, stripe_data)


@shared_task
def reconcile_pending_stripe_orders(limit: int | None = None) -> int:
    if not settings.STRIPE_SECRET_KEY:
        return 0

    stripe.api_key = settings.STRIPE_SECRET_KEY
    stripe.api_version = settings.STRIPE_API_VERSION
    reconcile_limit = int(
        limit if limit is not None else getattr(settings, "STRIPE_RECONCILE_BATCH_LIMIT", 100)
    )

    pending_orders = list(
        Order.objects.filter(status__in=[Order.Status.DRAFT, Order.Status.PENDING])
        .filter(
            Q(stripe_payment_intent_id__isnull=False)
            | Q(stripe_checkout_session_id__isnull=False)
        )
        .exclude(stripe_payment_intent_id="", stripe_checkout_session_id="")
        .select_related("member__user", "invoice")
        .prefetch_related("items__license")
        .order_by("-updated_at")[:reconcile_limit]
    )

    checkout_session_cache: dict[str, dict] = {}
    payment_intent_cache: dict[str, dict] = {}

    processed_count = 0
    reconciled_order_ids: list[int] = []
    for order in pending_orders:
        if not _can_reconcile_now(order.id):
            continue

        stripe_data = {}
        payment_details = {}
        payment_intent_id = order.stripe_payment_intent_id or ""
        checkout_session_id = order.stripe_checkout_session_id or ""

        try:
            if checkout_session_id:
                session = checkout_session_cache.get(checkout_session_id)
                if session is None:
                    session = stripe.checkout.Session.retrieve(checkout_session_id)
                    checkout_session_cache[checkout_session_id] = session
                if session.get("payment_status") != "paid":
                    _set_reconcile_backoff(order.id, STRIPE_RECONCILE_BACKOFF_SECONDS)
                    continue
                stripe_data["stripe_checkout_session_id"] = session.get("id")
                stripe_data["stripe_customer_id"] = session.get("customer")
                session_pi = session.get("payment_intent")
                if isinstance(session_pi, str) and session_pi:
                    payment_intent_id = session_pi
                    stripe_data["stripe_payment_intent_id"] = session_pi

            if payment_intent_id:
                payment_intent = payment_intent_cache.get(payment_intent_id)
                if payment_intent is None:
                    payment_intent = stripe.PaymentIntent.retrieve(
                        payment_intent_id,
                        expand=["charges.data.payment_method_details"],
                    )
                    payment_intent_cache[payment_intent_id] = payment_intent
                if payment_intent.get("status") != "succeeded":
                    _set_reconcile_backoff(order.id, STRIPE_RECONCILE_BACKOFF_SECONDS)
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
                _set_reconcile_backoff(order.id, STRIPE_RECONCILE_BACKOFF_SECONDS)
                continue
        except stripe.error.StripeError:  # type: ignore[attr-defined]
            _set_reconcile_backoff(order.id, STRIPE_RECONCILE_ERROR_BACKOFF_SECONDS)
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
            reconciled_order_ids.append(order.id)
            _set_reconcile_backoff(order.id, 0)
        else:
            _set_reconcile_backoff(order.id, STRIPE_RECONCILE_BACKOFF_SECONDS)

    if processed_count:
        FinanceAuditLog.objects.create(
            action="stripe.reconciled",
            message=f"Reconciled {processed_count} pending Stripe orders.",
            metadata={
                "processed_count": processed_count,
                "order_ids": reconciled_order_ids,
            },
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
