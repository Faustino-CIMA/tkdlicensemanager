from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from decimal import ROUND_HALF_UP
from json import JSONDecodeError
import json
import socket
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen
from uuid import uuid4

from django.conf import settings


@dataclass
class PayconiqPaymentResult:
    payment_id: str
    payment_url: str
    status: str


class PayconiqServiceError(Exception):
    status_code = 503


class PayconiqConfigurationError(PayconiqServiceError):
    status_code = 503


class PayconiqProviderError(PayconiqServiceError):
    status_code = 502


_PAYCONIQ_STATUS_MAP = {
    "paid": "PAID",
    "succeeded": "PAID",
    "successful": "PAID",
    "success": "PAID",
    "completed": "PAID",
    "settled": "PAID",
    "authorized": "PAID",
    "authorised": "PAID",
    "pending": "PENDING",
    "created": "PENDING",
    "new": "PENDING",
    "open": "PENDING",
    "processing": "PENDING",
    "in_progress": "PENDING",
    "awaiting_payment": "PENDING",
    "failed": "FAILED",
    "error": "FAILED",
    "declined": "FAILED",
    "rejected": "FAILED",
    "denied": "FAILED",
    "cancelled": "CANCELLED",
    "canceled": "CANCELLED",
    "aborted": "CANCELLED",
    "void": "CANCELLED",
    "expired": "EXPIRED",
    "timed_out": "EXPIRED",
    "timeout": "EXPIRED",
}


def _normalize_status(raw_status: Any) -> str:
    value = str(raw_status or "").strip().lower()
    if not value:
        return "PENDING"
    return _PAYCONIQ_STATUS_MAP.get(value, value.upper())


def _extract_field(payload: dict[str, Any], candidates: tuple[str, ...]) -> str | None:
    for key in candidates:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    nested = payload.get("data")
    if isinstance(nested, dict):
        for key in candidates:
            value = nested.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _extract_error_message(raw_body: str) -> str:
    if not raw_body.strip():
        return "No additional details were returned."
    try:
        payload = json.loads(raw_body)
    except JSONDecodeError:
        return "Provider returned a non-JSON error response."
    if not isinstance(payload, dict):
        return "Provider returned an error."

    for key in ("detail", "message", "error_description", "error", "title"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    errors = payload.get("errors")
    if isinstance(errors, list) and errors:
        first_error = errors[0]
        if isinstance(first_error, str) and first_error.strip():
            return first_error.strip()
        if isinstance(first_error, dict):
            for key in ("message", "detail", "error"):
                value = first_error.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

    return "Provider returned an error."


def _build_url(path_template: str, *, payment_id: str | None = None) -> str:
    base_url = str(settings.PAYCONIQ_BASE_URL or "").strip()
    if not base_url:
        raise PayconiqConfigurationError("Payconiq base URL is not configured.")
    path_value = path_template
    if payment_id is not None:
        path_value = path_template.format(payment_id=quote(payment_id, safe=""))
    return urljoin(f"{base_url.rstrip('/')}/", path_value.lstrip("/"))


def _build_aggregator_headers() -> dict[str, str]:
    api_key = str(settings.PAYCONIQ_API_KEY or "").strip()
    merchant_id = str(settings.PAYCONIQ_MERCHANT_ID or "").strip()
    if not api_key or not merchant_id:
        raise PayconiqConfigurationError(
            "Payconiq aggregator configuration is incomplete. "
            "Set PAYCONIQ_API_KEY and PAYCONIQ_MERCHANT_ID."
        )
    auth_scheme = str(settings.PAYCONIQ_AUTH_SCHEME or "Bearer").strip()
    auth_value = f"{auth_scheme} {api_key}" if auth_scheme else api_key
    return {
        "Authorization": auth_value,
        "X-Merchant-Id": merchant_id,
    }


def _request_json(
    *,
    method: str,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request_data = None
    if payload is not None:
        request_data = json.dumps(payload).encode("utf-8")
    request = Request(url=url, data=request_data, method=method.upper())
    request.add_header("Accept", "application/json")
    if request_data is not None:
        request.add_header("Content-Type", "application/json")
    for header_name, header_value in headers.items():
        if header_value:
            request.add_header(header_name, str(header_value))

    timeout_seconds = max(1, int(settings.PAYCONIQ_TIMEOUT_SECONDS))
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw_body = response.read().decode("utf-8")
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        error_message = _extract_error_message(raw_body)
        raise PayconiqProviderError(
            f"Payconiq aggregator returned HTTP {exc.code}. {error_message}"
        ) from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, socket.timeout):
            raise PayconiqProviderError(
                "Payconiq aggregator request timed out. Please retry shortly."
            ) from exc
        raise PayconiqProviderError(
            "Payconiq aggregator is currently unavailable. Please retry shortly."
        ) from exc

    if not raw_body.strip():
        return {}
    try:
        parsed_body = json.loads(raw_body)
    except JSONDecodeError as exc:
        raise PayconiqProviderError("Payconiq aggregator returned invalid JSON.") from exc
    if not isinstance(parsed_body, dict):
        raise PayconiqProviderError(
            "Payconiq aggregator returned an unsupported response format."
        )
    return parsed_body


def create_payment(*, amount: Decimal, currency: str, reference: str) -> PayconiqPaymentResult:
    mode = str(settings.PAYCONIQ_MODE or "mock").strip().lower()
    if mode == "mock":
        payment_id = f"pcq_{uuid4().hex[:16]}"
        payment_url = f"{str(settings.PAYCONIQ_BASE_URL).rstrip('/')}/pay/{payment_id}"
        return PayconiqPaymentResult(payment_id=payment_id, payment_url=payment_url, status="PENDING")

    if mode != "aggregator":
        raise PayconiqConfigurationError(
            "Unsupported PAYCONIQ_MODE. Use 'mock' or 'aggregator'."
        )

    normalized_amount = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    normalized_currency = str(currency or "EUR").strip().upper()
    payload = {
        "merchant_id": str(settings.PAYCONIQ_MERCHANT_ID or "").strip(),
        "amount": f"{normalized_amount:.2f}",
        "currency": normalized_currency,
        "reference": reference,
        "description": reference,
    }
    response_payload = _request_json(
        method="POST",
        url=_build_url(str(settings.PAYCONIQ_CREATE_PATH)),
        headers=_build_aggregator_headers(),
        payload=payload,
    )

    payment_id = _extract_field(
        response_payload,
        ("payment_id", "paymentId", "id", "transaction_id", "transactionId"),
    )
    payment_url = _extract_field(
        response_payload,
        (
            "payment_url",
            "paymentUrl",
            "checkout_url",
            "checkoutUrl",
            "redirect_url",
            "redirectUrl",
            "deeplink",
            "deepLink",
            "url",
            "paymentLink",
        ),
    )
    status_value = _extract_field(
        response_payload,
        ("status", "payment_status", "paymentStatus", "state"),
    )

    if not payment_id:
        raise PayconiqProviderError(
            "Payconiq aggregator response is missing a payment identifier."
        )
    if not payment_url:
        raise PayconiqProviderError(
            "Payconiq aggregator response is missing a payment URL."
        )

    return PayconiqPaymentResult(
        payment_id=payment_id,
        payment_url=payment_url,
        status=_normalize_status(status_value),
    )


def get_status(*, payment_id: str) -> str:
    mode = str(settings.PAYCONIQ_MODE or "mock").strip().lower()
    if mode == "mock":
        return "PENDING"
    if mode != "aggregator":
        raise PayconiqConfigurationError(
            "Unsupported PAYCONIQ_MODE. Use 'mock' or 'aggregator'."
        )
    normalized_payment_id = str(payment_id or "").strip()
    if not normalized_payment_id:
        raise PayconiqProviderError("Payconiq payment id is missing.")

    response_payload = _request_json(
        method="GET",
        url=_build_url(
            str(settings.PAYCONIQ_STATUS_PATH),
            payment_id=normalized_payment_id,
        ),
        headers=_build_aggregator_headers(),
    )
    status_value = _extract_field(
        response_payload,
        ("status", "payment_status", "paymentStatus", "state"),
    )
    return _normalize_status(status_value)
