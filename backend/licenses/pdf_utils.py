from __future__ import annotations

import base64
from io import BytesIO

from django.conf import settings
from django.template.loader import render_to_string

from .models import Invoice

try:
    from weasyprint import HTML
except Exception:  # pragma: no cover - handled at runtime
    HTML = None

try:
    import qrcode
except Exception:  # pragma: no cover - handled at runtime
    qrcode = None


def build_invoice_context(invoice: Invoice) -> dict:
    order = invoice.order
    items = order.items.select_related("license", "license__license_type").all()
    item_rows = []
    for item in items:
        license_type = (
            item.license.license_type.name
            if item.license and item.license.license_type
            else "License"
        )
        item_rows.append(
            {
                "license_type": license_type,
                "year": item.license.year if item.license else "",
                "quantity": item.quantity,
                "unit_price": item.price_snapshot,
                "line_total": item.price_snapshot * item.quantity,
            }
        )
    payconiq_url = ""
    latest_payconiq = (
        invoice.payments.filter(provider="payconiq")
        .exclude(payconiq_payment_url="")
        .order_by("-created_at")
        .first()
    )
    if latest_payconiq:
        payconiq_url = latest_payconiq.payconiq_payment_url

    sepa_payload = build_sepa_payload(
        beneficiary=settings.INVOICE_SEPA_BENEFICIARY,
        iban=settings.INVOICE_SEPA_IBAN,
        bic=settings.INVOICE_SEPA_BIC,
        remittance=f"{settings.INVOICE_SEPA_REMITTANCE_PREFIX} {invoice.invoice_number}",
        amount=invoice.total,
        currency=invoice.currency,
    )

    payconiq_qr = build_qr_base64(payconiq_url) if payconiq_url else ""
    sepa_qr = build_qr_base64(sepa_payload) if sepa_payload else ""
    return {
        "invoice": invoice,
        "order": order,
        "club": invoice.club,
        "member": invoice.member,
        "items": item_rows,
        "payconiq_url": payconiq_url,
        "payconiq_qr": payconiq_qr,
        "sepa_payload": sepa_payload,
        "sepa_qr": sepa_qr,
    }


def render_invoice_pdf(invoice: Invoice, *, base_url: str) -> bytes | None:
    if HTML is None:
        return None
    context = build_invoice_context(invoice)
    html = render_to_string("finance/invoice_pdf.html", context)
    return HTML(string=html, base_url=base_url).write_pdf()


def build_qr_base64(payload: str) -> str:
    if not payload or qrcode is None:
        return ""
    qr = qrcode.QRCode(box_size=4, border=2)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def build_sepa_payload(
    *,
    beneficiary: str,
    iban: str,
    bic: str,
    remittance: str,
    amount,
    currency: str,
) -> str:
    if not beneficiary or not iban or not currency:
        return ""
    normalized_amount = f"{amount:.2f}" if amount is not None else ""
    lines = [
        "BCD",
        "001",
        "1",
        "SCT",
        bic or "",
        beneficiary,
        iban,
        f"{currency}{normalized_amount}" if normalized_amount else "",
        "",
        "",
        remittance,
    ]
    return "\n".join(lines).strip()
