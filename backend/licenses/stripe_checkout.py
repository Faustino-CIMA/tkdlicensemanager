from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.conf import settings
import stripe

from accounts.models import User
from .models import Invoice, Order
from .services import apply_payment_and_activate


def checkout_success_url() -> str:
    url = (getattr(settings, "STRIPE_CHECKOUT_SUCCESS_URL", "") or "").strip()
    if not url:
        frontend = (getattr(settings, "FRONTEND_BASE_URL", "") or "").rstrip("/")
        url = f"{frontend}/checkout/success"
    if "{CHECKOUT_SESSION_ID}" not in url:
        joiner = "&" if "?" in url else "?"
        url = f"{url}{joiner}session_id={{CHECKOUT_SESSION_ID}}"
    return url


def _stripe_field(obj: Any, key: str, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def user_can_confirm_order(user: User | None, order: Order) -> bool:
    if not user or not user.is_authenticated:
        return False
    role = getattr(user, "role", "")
    if role in {User.Roles.LTF_ADMIN, User.Roles.LTF_FINANCE}:
        return True
    if role == User.Roles.CLUB_ADMIN and order.club.admins.filter(id=user.id).exists():
        return True
    member = getattr(order, "member", None)
    if member is not None and getattr(member, "user_id", None) == user.id:
        return True
    return False


def _order_queryset():
    return Order.objects.select_related("club", "member", "member__user", "invoice").prefetch_related(
        "items__license"
    )


@dataclass
class CheckoutFulfillment:
    status: str
    order: Order | None = None

    @property
    def invoice(self) -> Invoice | None:
        if self.order is None:
            return None
        try:
            return self.order.invoice
        except Invoice.DoesNotExist:
            return None


def _payment_details_from_intent(payment_intent: Any) -> dict[str, Any]:
    charges_obj = _stripe_field(payment_intent, "charges", {}) or {}
    charges = _stripe_field(charges_obj, "data", []) or []
    if not charges:
        return {}
    pm_details = _stripe_field(charges[0], "payment_method_details")
    card = _stripe_field(pm_details, "card") or {}
    return {
        "payment_method": "card",
        "payment_provider": "stripe",
        "card_brand": _stripe_field(card, "brand", "") or "",
        "card_last4": _stripe_field(card, "last4", "") or "",
        "card_exp_month": _stripe_field(card, "exp_month"),
        "card_exp_year": _stripe_field(card, "exp_year"),
    }


def _metadata_order_id(metadata: Any) -> int | None:
    if isinstance(metadata, dict):
        raw_order_id = metadata.get("order_id")
    else:
        raw_order_id = _stripe_field(metadata, "order_id")
    try:
        return int(raw_order_id)
    except (TypeError, ValueError):
        return None


def _retrieve_checkout_session(session_id: str):
    if not settings.STRIPE_SECRET_KEY:
        raise RuntimeError("Stripe is not configured.")
    stripe.api_key = settings.STRIPE_SECRET_KEY
    stripe.api_version = settings.STRIPE_API_VERSION
    return stripe.checkout.Session.retrieve(session_id)


def fulfill_checkout_session(session_id: str, *, actor: User) -> CheckoutFulfillment:
    session_id = (session_id or "").strip()
    if not session_id:
        raise ValueError("session_id is required.")

    session = None
    order = _order_queryset().filter(stripe_checkout_session_id=session_id).first()
    if order is None:
        session = _retrieve_checkout_session(session_id)
        order_id = _metadata_order_id(_stripe_field(session, "metadata"))
        if order_id:
            order = _order_queryset().filter(id=order_id).first()

    if order is None:
        return CheckoutFulfillment(status="unpaid", order=None)
    if not user_can_confirm_order(actor, order):
        raise PermissionError

    if order.status == Order.Status.PAID:
        return CheckoutFulfillment(status="paid", order=order)

    if session is None:
        session = _retrieve_checkout_session(session_id)

    payment_status = str(_stripe_field(session, "payment_status") or "").lower()
    payment_intent_id = _stripe_field(session, "payment_intent")
    if not isinstance(payment_intent_id, str):
        payment_intent_id = _stripe_field(payment_intent_id, "id") or ""

    if payment_status != "paid":
        return CheckoutFulfillment(status="pending", order=order)

    stripe_data = {
        "stripe_checkout_session_id": _stripe_field(session, "id") or session_id,
        "stripe_customer_id": _stripe_field(session, "customer"),
    }
    if isinstance(payment_intent_id, str) and payment_intent_id:
        stripe_data["stripe_payment_intent_id"] = payment_intent_id

    payment_details: dict[str, Any] = {
        "payment_method": "card",
        "payment_provider": "stripe",
    }
    if isinstance(payment_intent_id, str) and payment_intent_id:
        try:
            payment_intent = stripe.PaymentIntent.retrieve(
                payment_intent_id,
                expand=["charges.data.payment_method_details"],
            )
            payment_details.update(_payment_details_from_intent(payment_intent))
        except Exception:
            pass

    apply_payment_and_activate(
        order,
        actor=actor,
        stripe_data=stripe_data,
        payment_details=payment_details,
        message="Payment confirmed from Stripe Checkout return and licenses activated.",
    )
    order = _order_queryset().get(id=order.id)
    return CheckoutFulfillment(status="paid", order=order)
