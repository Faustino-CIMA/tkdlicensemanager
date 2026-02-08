from __future__ import annotations

from django.template.loader import render_to_string

from .models import Invoice

try:
    from weasyprint import HTML
except Exception:  # pragma: no cover - handled at runtime
    HTML = None


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
    return {
        "invoice": invoice,
        "order": order,
        "club": invoice.club,
        "member": invoice.member,
        "items": item_rows,
    }


def render_invoice_pdf(invoice: Invoice, *, base_url: str) -> bytes | None:
    if HTML is None:
        return None
    context = build_invoice_context(invoice)
    html = render_to_string("finance/invoice_pdf.html", context)
    return HTML(string=html, base_url=base_url).write_pdf()
