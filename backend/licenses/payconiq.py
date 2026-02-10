from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

from django.conf import settings


@dataclass
class PayconiqPaymentResult:
    payment_id: str
    payment_url: str
    status: str


def create_payment(*, amount: Decimal, currency: str, reference: str) -> PayconiqPaymentResult:
    mode = settings.PAYCONIQ_MODE
    if mode != "mock":
        raise NotImplementedError("Only PAYCONIQ_MODE=mock is supported for now.")

    payment_id = f"pcq_{uuid4().hex[:16]}"
    payment_url = f"{settings.PAYCONIQ_BASE_URL}/pay/{payment_id}"
    return PayconiqPaymentResult(payment_id=payment_id, payment_url=payment_url, status="PENDING")


def get_status(*, payment_id: str) -> str:
    mode = settings.PAYCONIQ_MODE
    if mode != "mock":
        raise NotImplementedError("Only PAYCONIQ_MODE=mock is supported for now.")
    return "PENDING"
