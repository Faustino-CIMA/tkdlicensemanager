from __future__ import annotations

import base64
from decimal import Decimal, InvalidOperation
from html import escape
from io import BytesIO
import json
import mimetypes
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.http import HttpRequest

from clubs.models import Club
from members.models import Member

from .card_registry import (
    ALLOWED_MERGE_FIELDS,
    MERGE_FIELD_PATTERN,
    validate_design_payload_schema,
)
from .models import CardTemplateVersion, License, PaperProfile

try:
    from weasyprint import HTML
except Exception:  # pragma: no cover - handled at runtime
    HTML = None

try:
    import qrcode
except Exception:  # pragma: no cover - handled at runtime
    qrcode = None


class CardRenderError(Exception):
    def __init__(self, detail: str, *, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _error_from_validation(exc: ValidationError) -> CardRenderError:
    if hasattr(exc, "message_dict"):
        parts: list[str] = []
        for key, values in exc.message_dict.items():
            if isinstance(values, list):
                parts.append(f"{key}: {', '.join(str(value) for value in values)}")
            else:
                parts.append(f"{key}: {values}")
        return CardRenderError("; ".join(parts) or "Invalid design payload.")
    if hasattr(exc, "messages") and exc.messages:
        return CardRenderError("; ".join(str(message) for message in exc.messages))
    return CardRenderError("Invalid design payload.")


def _coerce_mm(value: Any, *, field_name: str, allow_zero: bool = False) -> Decimal:
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise CardRenderError(f"{field_name} must be a decimal number in mm.") from exc
    minimum = Decimal("0.00") if allow_zero else Decimal("0.01")
    if decimal_value < minimum:
        operator = ">=" if allow_zero else ">"
        raise CardRenderError(f"{field_name} must be {operator} {minimum} mm.")
    return decimal_value.quantize(Decimal("0.01"))


def _coerce_int(value: Any, *, field_name: str, minimum: int | None = None) -> int:
    try:
        int_value = int(str(value))
    except (TypeError, ValueError) as exc:
        raise CardRenderError(f"{field_name} must be an integer.") from exc
    if minimum is not None and int_value < minimum:
        raise CardRenderError(f"{field_name} must be >= {minimum}.")
    return int_value


def _coerce_opacity(value: Any) -> Decimal:
    try:
        opacity = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise CardRenderError("opacity must be a decimal number.") from exc
    if opacity < Decimal("0.00") or opacity > Decimal("1.00"):
        raise CardRenderError("opacity must be between 0 and 1.")
    return opacity.quantize(Decimal("0.01"))


def _format_mm(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _resolve_tokenized_text(template: str, context: dict[str, str]) -> str:
    raw_value = str(template or "")

    def _replace(match) -> str:
        key = str(match.group(1)).strip()
        if key not in ALLOWED_MERGE_FIELDS:
            raise CardRenderError(f"Unknown merge field '{key}'.")
        return str(context.get(key, ""))

    return MERGE_FIELD_PATTERN.sub(_replace, raw_value)


def _flatten_sample_data(sample_data: dict[str, Any]) -> dict[str, Any]:
    flattened: dict[str, Any] = {}
    for key, value in sample_data.items():
        key_name = str(key).strip()
        if not key_name:
            raise CardRenderError("sample_data contains an empty key.")
        if isinstance(value, dict):
            for nested_key, nested_value in value.items():
                nested_name = str(nested_key).strip()
                if not nested_name:
                    raise CardRenderError(f"sample_data.{key_name} contains an empty nested key.")
                flattened[f"{key_name}.{nested_name}"] = nested_value
        else:
            flattened[key_name] = value
    unknown_keys = sorted(set(flattened.keys()) - ALLOWED_MERGE_FIELDS)
    if unknown_keys:
        raise CardRenderError(
            "sample_data contains unknown merge key(s): " + ", ".join(unknown_keys)
        )
    return flattened


def _stringify_context_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, Decimal)):
        return str(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if hasattr(value, "isoformat"):
        try:
            return str(value.isoformat())
        except Exception:  # pragma: no cover - defensive
            pass
    return json.dumps(value, sort_keys=True, default=str)


def _default_validation_url(license_record: License | None) -> str:
    base = str(settings.FRONTEND_BASE_URL).rstrip("/")
    if license_record is not None:
        return f"{base}/verify-license/{license_record.id}"
    return f"{base}/verify-license/sample"


def _resolve_entities(
    *,
    member_id: int | None,
    license_id: int | None,
    club_id: int | None,
) -> tuple[Member | None, License | None, Club | None]:
    member = None
    license_record = None
    club = None

    if member_id is not None:
        member = Member.objects.select_related("club").filter(id=member_id).first()
        if member is None:
            raise CardRenderError(f"Member with id {member_id} was not found.")
    if license_id is not None:
        license_record = (
            License.objects.select_related("member", "club", "license_type")
            .filter(id=license_id)
            .first()
        )
        if license_record is None:
            raise CardRenderError(f"License with id {license_id} was not found.")
    if club_id is not None:
        club = Club.objects.filter(id=club_id).first()
        if club is None:
            raise CardRenderError(f"Club with id {club_id} was not found.")

    if license_record is not None:
        if member is not None and member.id != license_record.member_id:
            raise CardRenderError("member_id does not match license_id.")
        member = license_record.member
        if club is not None and club.id != license_record.club_id:
            raise CardRenderError("club_id does not match license_id.")
        club = license_record.club

    if member is not None:
        if club is not None and member.club_id != club.id:
            raise CardRenderError("member_id does not belong to club_id.")
        if club is None:
            club = member.club

    return member, license_record, club


def _build_context(
    *,
    member: Member | None,
    license_record: License | None,
    club: Club | None,
    sample_data: dict[str, Any] | None,
) -> dict[str, str]:
    context: dict[str, str] = {
        "member.first_name": member.first_name if member else "",
        "member.last_name": member.last_name if member else "",
        "member.full_name": (
            f"{member.first_name} {member.last_name}".strip() if member else ""
        ),
        "member.ltf_licenseid": member.ltf_licenseid if member else "",
        "member.sex": member.sex if member else "",
        "member.profile_picture_processed": (
            member.profile_picture_processed.url
            if member and getattr(member, "profile_picture_processed", None)
            else ""
        ),
        "club.name": club.name if club else "",
        "license.type_name": (
            license_record.license_type.name
            if license_record and license_record.license_type_id
            else ""
        ),
        "license.year": str(license_record.year) if license_record else "",
        "license.start_date": (
            license_record.start_date.isoformat() if license_record and license_record.start_date else ""
        ),
        "license.end_date": (
            license_record.end_date.isoformat() if license_record and license_record.end_date else ""
        ),
        "qr.validation_url": _default_validation_url(license_record),
    }

    flattened_sample_data = _flatten_sample_data(sample_data or {})
    for key, value in flattened_sample_data.items():
        context[key] = _stringify_context_value(value)

    return {key: context.get(key, "") for key in sorted(ALLOWED_MERGE_FIELDS)}


def _resolve_merge_value(key: str, context: dict[str, str]) -> str:
    merge_key = str(key or "").strip()
    if not merge_key:
        return ""
    if merge_key not in ALLOWED_MERGE_FIELDS:
        raise CardRenderError(f"Unknown merge field '{merge_key}'.")
    return str(context.get(merge_key, ""))


def _member_photo_data_uri(member: Member | None) -> str:
    if member is None or not getattr(member, "profile_picture_processed", None):
        return ""
    image_field = member.profile_picture_processed
    if not image_field or not getattr(image_field, "name", ""):
        return ""
    try:
        with image_field.open("rb") as image_stream:
            image_bytes = image_stream.read()
    except Exception:  # pragma: no cover - filesystem dependent
        return ""
    if not image_bytes:
        return ""
    mime_type = mimetypes.guess_type(str(image_field.name))[0] or "image/png"
    return f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"


def _normalize_source_url(source: str, request: HttpRequest | None) -> str:
    normalized_source = str(source or "").strip()
    if not normalized_source:
        return ""
    if normalized_source.startswith("data:"):
        return normalized_source
    if normalized_source.startswith("http://") or normalized_source.startswith("https://"):
        return normalized_source
    if normalized_source.startswith("/") and request is not None:
        return request.build_absolute_uri(normalized_source)
    return normalized_source


def _resolve_image_source(
    *,
    element: dict[str, Any],
    context: dict[str, str],
    member: Member | None,
    request: HttpRequest | None,
) -> str:
    merge_field = str(element.get("merge_field") or "").strip()
    if merge_field == "member.profile_picture_processed":
        return _member_photo_data_uri(member) or _resolve_merge_value(merge_field, context)
    if merge_field:
        return _normalize_source_url(_resolve_merge_value(merge_field, context), request)

    source = str(element.get("source") or "").strip()
    if source in {"member.profile_picture_processed", "{{member.profile_picture_processed}}"}:
        return _member_photo_data_uri(member) or context.get("member.profile_picture_processed", "")
    if not source:
        return _member_photo_data_uri(member)

    token_matches = MERGE_FIELD_PATTERN.findall(source)
    if token_matches:
        for token in token_matches:
            merge_key = str(token).strip()
            if merge_key not in ALLOWED_MERGE_FIELDS:
                raise CardRenderError(f"Unknown merge field '{merge_key}'.")
        if "member.profile_picture_processed" in token_matches:
            return _member_photo_data_uri(member) or _resolve_tokenized_text(source, context)
        return _normalize_source_url(_resolve_tokenized_text(source, context), request)

    if source in ALLOWED_MERGE_FIELDS:
        if source == "member.profile_picture_processed":
            return _member_photo_data_uri(member) or context.get(source, "")
        return _normalize_source_url(_resolve_merge_value(source, context), request)

    return _normalize_source_url(source, request)


def _build_qr_data_uri(value: str) -> str:
    payload = str(value or "").strip()
    if not payload or qrcode is None:
        return ""
    qr_code = qrcode.QRCode(box_size=6, border=1)
    qr_code.add_data(payload)
    qr_code.make(fit=True)
    image = qr_code.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}"


def _resolve_element_value(element: dict[str, Any], context: dict[str, str]) -> str:
    merge_field = str(element.get("merge_field") or "").strip()
    if merge_field:
        return _resolve_merge_value(merge_field, context)
    text_value = element.get("text")
    if isinstance(text_value, str) and text_value.strip():
        return _resolve_tokenized_text(text_value, context)
    source_value = str(element.get("source") or "").strip()
    if source_value in ALLOWED_MERGE_FIELDS:
        return _resolve_merge_value(source_value, context)
    if MERGE_FIELD_PATTERN.search(source_value):
        return _resolve_tokenized_text(source_value, context)
    return source_value


def _sorted_design_elements(design_payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_elements = design_payload.get("elements") or []
    indexed_elements = list(enumerate(raw_elements))

    def _sort_key(item: tuple[int, dict[str, Any]]) -> tuple[int, str, int]:
        index, element = item
        z_value = element.get("z_index", 0)
        try:
            z_index = int(Decimal(str(z_value)))
        except (InvalidOperation, TypeError, ValueError):
            z_index = 0
        return z_index, str(element.get("id", "")), index

    ordered = sorted(indexed_elements, key=_sort_key)
    return [element for _, element in ordered]


def _resolve_elements(
    *,
    design_payload: dict[str, Any],
    context: dict[str, str],
    member: Member | None,
    request: HttpRequest | None,
) -> list[dict[str, Any]]:
    resolved_elements: list[dict[str, Any]] = []
    for render_order, element in enumerate(_sorted_design_elements(design_payload)):
        element_type = str(element.get("type") or "").strip().lower()
        x_mm = _coerce_mm(element.get("x_mm"), field_name="x_mm", allow_zero=True)
        y_mm = _coerce_mm(element.get("y_mm"), field_name="y_mm", allow_zero=True)
        width_mm = _coerce_mm(element.get("width_mm"), field_name="width_mm", allow_zero=False)
        height_mm = _coerce_mm(element.get("height_mm"), field_name="height_mm", allow_zero=False)

        rotation_raw = element.get("rotation_deg", 0)
        try:
            rotation_deg = Decimal(str(rotation_raw)).quantize(Decimal("0.01"))
        except (InvalidOperation, TypeError, ValueError):
            raise CardRenderError("rotation_deg must be a decimal number.")
        opacity = _coerce_opacity(element.get("opacity", 1))
        z_index = _coerce_int(element.get("z_index", 0), field_name="z_index")
        style = element.get("style", {})
        if style is None:
            style = {}
        if not isinstance(style, dict):
            raise CardRenderError("style must be an object when provided.")

        resolved: dict[str, Any] = {
            "id": str(element.get("id") or ""),
            "type": element_type,
            "x_mm": _format_mm(x_mm),
            "y_mm": _format_mm(y_mm),
            "width_mm": _format_mm(width_mm),
            "height_mm": _format_mm(height_mm),
            "rotation_deg": f"{rotation_deg}",
            "opacity": f"{opacity}",
            "z_index": z_index,
            "render_order": render_order,
            "style": style,
            "metadata": element.get("metadata", {}),
            "merge_field": str(element.get("merge_field") or ""),
        }

        if element_type == "text":
            resolved["resolved_text"] = _resolve_element_value(element, context)
        elif element_type == "image":
            resolved_source = _resolve_image_source(
                element=element,
                context=context,
                member=member,
                request=request,
            )
            resolved["resolved_source"] = resolved_source
        elif element_type == "shape":
            resolved["resolved_text"] = ""
        elif element_type == "qr":
            qr_value = _resolve_element_value(element, context) or context.get("qr.validation_url", "")
            resolved["resolved_value"] = qr_value
            resolved["qr_data_uri"] = _build_qr_data_uri(qr_value)
        elif element_type == "barcode":
            resolved["resolved_value"] = _resolve_element_value(element, context)
            resolved["barcode_placeholder"] = "BARCODE"
        else:
            # The design payload validator already prevents unknown types.
            raise CardRenderError(f"Unsupported element type '{element_type}'.")

        resolved_elements.append(resolved)
    return resolved_elements


def _resolve_paper_profile(
    *,
    template_version: CardTemplateVersion,
    paper_profile_id: int | None,
) -> PaperProfile | None:
    if paper_profile_id is not None:
        paper_profile = PaperProfile.objects.select_related("card_format").filter(id=paper_profile_id).first()
        if paper_profile is None:
            raise CardRenderError(f"Paper profile with id {paper_profile_id} was not found.")
    else:
        paper_profile = template_version.paper_profile

    if paper_profile is not None and paper_profile.card_format_id != template_version.card_format_id:
        raise CardRenderError("Paper profile card format does not match template version card format.")
    return paper_profile


def _build_slot_layout(
    *,
    paper_profile: PaperProfile,
    selected_slots: list[int] | None,
) -> tuple[list[dict[str, Any]], list[int]]:
    slot_count = int(paper_profile.slot_count)
    if selected_slots is None:
        normalized_slots = list(range(slot_count))
    else:
        normalized_slots = [int(slot) for slot in selected_slots]
        if len(set(normalized_slots)) != len(normalized_slots):
            raise CardRenderError("selected_slots must not contain duplicates.")
        normalized_slots = sorted(normalized_slots)
    invalid_slots = [slot for slot in normalized_slots if slot < 0 or slot >= slot_count]
    if invalid_slots:
        raise CardRenderError(
            "selected_slots contains out-of-range index(es): "
            + ", ".join(str(slot) for slot in invalid_slots)
        )

    selected_set = set(normalized_slots)
    columns = int(paper_profile.columns)
    rows = int(paper_profile.rows)
    if columns <= 0 or rows <= 0:
        raise CardRenderError("Paper profile rows and columns must be positive.")

    slots: list[dict[str, Any]] = []
    margin_left = Decimal(str(paper_profile.margin_left_mm))
    margin_top = Decimal(str(paper_profile.margin_top_mm))
    card_width = Decimal(str(paper_profile.card_width_mm))
    card_height = Decimal(str(paper_profile.card_height_mm))
    h_gap = Decimal(str(paper_profile.horizontal_gap_mm))
    v_gap = Decimal(str(paper_profile.vertical_gap_mm))

    for slot_index in range(slot_count):
        row = slot_index // columns
        col = slot_index % columns
        if row >= rows:
            break
        x_mm = margin_left + Decimal(col) * (card_width + h_gap)
        y_mm = margin_top + Decimal(row) * (card_height + v_gap)
        slots.append(
            {
                "slot_index": slot_index,
                "row": row,
                "column": col,
                "x_mm": _format_mm(x_mm),
                "y_mm": _format_mm(y_mm),
                "width_mm": _format_mm(card_width),
                "height_mm": _format_mm(card_height),
                "selected": slot_index in selected_set,
            }
        )
    return slots, normalized_slots


def build_preview_data(
    *,
    template_version: CardTemplateVersion,
    member_id: int | None = None,
    license_id: int | None = None,
    club_id: int | None = None,
    sample_data: dict[str, Any] | None = None,
    include_bleed_guide: bool = False,
    include_safe_area_guide: bool = False,
    bleed_mm: Decimal = Decimal("2.00"),
    safe_area_mm: Decimal = Decimal("3.00"),
    paper_profile_id: int | None = None,
    selected_slots: list[int] | None = None,
    request: HttpRequest | None = None,
) -> dict[str, Any]:
    if template_version.card_format_id is None:
        raise CardRenderError("Template version must have a card format.")

    try:
        validate_design_payload_schema(
            template_version.design_payload,
            canvas_width_mm=Decimal(str(template_version.card_format.width_mm)),
            canvas_height_mm=Decimal(str(template_version.card_format.height_mm)),
        )
    except ValidationError as exc:
        raise _error_from_validation(exc) from exc

    member, license_record, club = _resolve_entities(
        member_id=member_id,
        license_id=license_id,
        club_id=club_id,
    )
    paper_profile = _resolve_paper_profile(
        template_version=template_version,
        paper_profile_id=paper_profile_id,
    )
    context = _build_context(
        member=member,
        license_record=license_record,
        club=club,
        sample_data=sample_data,
    )
    resolved_elements = _resolve_elements(
        design_payload=template_version.design_payload,
        context=context,
        member=member,
        request=request,
    )

    bleed_value = _coerce_mm(bleed_mm, field_name="bleed_mm", allow_zero=True)
    safe_area_value = _coerce_mm(safe_area_mm, field_name="safe_area_mm", allow_zero=True)
    payload: dict[str, Any] = {
        "template_version_id": template_version.id,
        "template_id": template_version.template_id,
        "card_format": {
            "id": template_version.card_format_id,
            "code": template_version.card_format.code,
            "name": template_version.card_format.name,
            "width_mm": _format_mm(Decimal(str(template_version.card_format.width_mm))),
            "height_mm": _format_mm(Decimal(str(template_version.card_format.height_mm))),
        },
        "guides": {
            "include_bleed_guide": bool(include_bleed_guide),
            "include_safe_area_guide": bool(include_safe_area_guide),
            "bleed_mm": _format_mm(bleed_value),
            "safe_area_mm": _format_mm(safe_area_value),
        },
        "context": context,
        "elements": resolved_elements,
    }

    if paper_profile is not None:
        slots, normalized_selected_slots = _build_slot_layout(
            paper_profile=paper_profile,
            selected_slots=selected_slots,
        )
        payload["paper_profile"] = {
            "id": paper_profile.id,
            "code": paper_profile.code,
            "name": paper_profile.name,
            "sheet_width_mm": _format_mm(Decimal(str(paper_profile.sheet_width_mm))),
            "sheet_height_mm": _format_mm(Decimal(str(paper_profile.sheet_height_mm))),
            "card_width_mm": _format_mm(Decimal(str(paper_profile.card_width_mm))),
            "card_height_mm": _format_mm(Decimal(str(paper_profile.card_height_mm))),
            "rows": int(paper_profile.rows),
            "columns": int(paper_profile.columns),
            "slot_count": int(paper_profile.slot_count),
        }
        payload["selected_slots"] = normalized_selected_slots
        payload["slots"] = slots
    else:
        if selected_slots:
            raise CardRenderError(
                "selected_slots requires a paper profile on the request or template version."
            )
        payload["paper_profile"] = None
        payload["selected_slots"] = []
        payload["slots"] = []

    return payload


def _style_value_from_dict(style: dict[str, Any], key: str, default: str) -> str:
    value = style.get(key, default)
    return str(value if value is not None else default)


def _style_mm_value(style: dict[str, Any], key: str, default: Decimal) -> Decimal:
    value = style.get(key, default)
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        decimal_value = default
    if decimal_value < Decimal("0.00"):
        return default
    return decimal_value.quantize(Decimal("0.01"))


def _font_size_mm(style: dict[str, Any]) -> Decimal:
    if "font_size_mm" in style:
        return _style_mm_value(style, "font_size_mm", Decimal("3.20"))
    if "font_size_pt" in style:
        try:
            font_pt = Decimal(str(style.get("font_size_pt")))
        except (InvalidOperation, TypeError, ValueError):
            return Decimal("3.20")
        if font_pt <= Decimal("0.00"):
            return Decimal("3.20")
        # 1 pt = 0.352778 mm
        return (font_pt * Decimal("0.352778")).quantize(Decimal("0.01"))
    return Decimal("3.20")


def _render_element_html(element: dict[str, Any]) -> str:
    style = element.get("style") or {}
    if not isinstance(style, dict):
        style = {}
    base_style = (
        "position:absolute;"
        f"left:{element['x_mm']}mm;"
        f"top:{element['y_mm']}mm;"
        f"width:{element['width_mm']}mm;"
        f"height:{element['height_mm']}mm;"
        "box-sizing:border-box;"
        "overflow:hidden;"
        f"opacity:{element['opacity']};"
        f"transform:rotate({element['rotation_deg']}deg);"
        f"z-index:{element['z_index']};"
    )

    element_type = element["type"]
    if element_type == "text":
        font_size = _font_size_mm(style)
        color = escape(_style_value_from_dict(style, "color", "#111827"))
        font_weight = escape(_style_value_from_dict(style, "font_weight", "500"))
        text_align = escape(_style_value_from_dict(style, "text_align", "left"))
        line_height = escape(_style_value_from_dict(style, "line_height", "1.2"))
        text_value = escape(str(element.get("resolved_text", ""))).replace("\n", "<br/>")
        return (
            f'<div style="{base_style}'
            f"font-size:{_format_mm(font_size)}mm;"
            f"color:{color};font-weight:{font_weight};text-align:{text_align};"
            f"line-height:{line_height};white-space:normal;word-break:break-word;"
            'font-family:Inter,Arial,sans-serif;">'
            f"{text_value}</div>"
        )
    if element_type == "image":
        source = str(element.get("resolved_source", "")).strip()
        if source:
            return (
                f'<div style="{base_style}">'
                f'<img src="{escape(source)}" alt="" '
                'style="width:100%;height:100%;object-fit:contain;display:block;"/>'
                "</div>"
            )
        return (
            f'<div style="{base_style}'
            "border:0.20mm dashed #9ca3af;background:#f9fafb;"
            'display:flex;align-items:center;justify-content:center;'
            'font-size:2.6mm;color:#6b7280;">No image</div>'
        )
    if element_type == "shape":
        background = escape(_style_value_from_dict(style, "background_color", "#d1d5db"))
        border_color = escape(_style_value_from_dict(style, "border_color", "#6b7280"))
        border_width = _style_mm_value(style, "border_width_mm", Decimal("0.20"))
        border_radius = _style_mm_value(style, "border_radius_mm", Decimal("0.00"))
        return (
            f'<div style="{base_style}'
            f"background:{background};"
            f"border:{_format_mm(border_width)}mm solid {border_color};"
            f"border-radius:{_format_mm(border_radius)}mm;"
            '"></div>'
        )
    if element_type == "qr":
        qr_data_uri = str(element.get("qr_data_uri", "")).strip()
        if qr_data_uri:
            return (
                f'<div style="{base_style}">'
                f'<img src="{escape(qr_data_uri)}" alt="QR" '
                'style="width:100%;height:100%;object-fit:contain;display:block;"/>'
                "</div>"
            )
        return (
            f'<div style="{base_style}'
            "border:0.20mm dashed #6b7280;background:#f3f4f6;"
            'display:flex;align-items:center;justify-content:center;'
            'font-size:2.4mm;color:#6b7280;">QR</div>'
        )
    if element_type == "barcode":
        barcode_value = escape(str(element.get("resolved_value", "")))
        return (
            f'<div style="{base_style}display:flex;flex-direction:column;justify-content:center;">'
            '<div style="font-family:monospace;font-size:3.00mm;letter-spacing:0.40mm;'
            'line-height:1;text-align:center;">||||||||||||||||||||||||</div>'
            f'<div style="font-size:2.40mm;line-height:1.1;text-align:center;'
            f'font-family:Inter,Arial,sans-serif;">{barcode_value}</div>'
            "</div>"
        )
    return ""


def _render_card_fragment(preview_data: dict[str, Any]) -> str:
    card_format = preview_data["card_format"]
    width_mm = str(card_format["width_mm"])
    height_mm = str(card_format["height_mm"])
    guides = preview_data["guides"]

    background_style = "background:#ffffff;"
    elements_html = "".join(_render_element_html(element) for element in preview_data["elements"])
    guide_html = ""
    if guides.get("include_bleed_guide"):
        guide_html += (
            '<div style="position:absolute;pointer-events:none;box-sizing:border-box;'
            f'inset:{guides["bleed_mm"]}mm;border:0.20mm dashed #ef4444;z-index:9998;"></div>'
        )
    if guides.get("include_safe_area_guide"):
        guide_html += (
            '<div style="position:absolute;pointer-events:none;box-sizing:border-box;'
            f'inset:{guides["safe_area_mm"]}mm;border:0.20mm dashed #10b981;z-index:9999;"></div>'
        )

    return (
        f'<div class="card-canvas" style="position:relative;width:{width_mm}mm;'
        f'height:{height_mm}mm;overflow:hidden;box-sizing:border-box;{background_style}">'
        f"{elements_html}{guide_html}</div>"
    )


def _render_card_document_html(preview_data: dict[str, Any]) -> str:
    card_format = preview_data["card_format"]
    width_mm = str(card_format["width_mm"])
    height_mm = str(card_format["height_mm"])
    card_fragment = _render_card_fragment(preview_data)
    return (
        "<!doctype html>"
        "<html><head><meta charset='utf-8'>"
        "<style>"
        f"@page {{ size: {width_mm}mm {height_mm}mm; margin: 0; }}"
        "html,body{margin:0;padding:0;}"
        "body{font-family:Inter,Arial,sans-serif;}"
        "</style>"
        "</head><body>"
        f"{card_fragment}"
        "</body></html>"
    )


def _render_sheet_document_html(preview_data: dict[str, Any]) -> str:
    paper_profile = preview_data.get("paper_profile")
    if not paper_profile:
        raise CardRenderError("Sheet preview requires a paper profile.")
    slots = preview_data.get("slots") or []
    card_fragment = _render_card_fragment(preview_data)
    slot_markup: list[str] = []
    for slot in slots:
        selected = bool(slot.get("selected"))
        slot_border = "#1d4ed8" if selected else "#d1d5db"
        content = card_fragment if selected else ""
        slot_markup.append(
            "<div "
            "style=\"position:absolute;box-sizing:border-box;"
            f"left:{slot['x_mm']}mm;top:{slot['y_mm']}mm;"
            f"width:{slot['width_mm']}mm;height:{slot['height_mm']}mm;"
            f"border:0.15mm dashed {slot_border};\">"
            f"{content}</div>"
        )
    return (
        "<!doctype html>"
        "<html><head><meta charset='utf-8'>"
        "<style>"
        f"@page {{ size: {paper_profile['sheet_width_mm']}mm {paper_profile['sheet_height_mm']}mm; margin: 0; }}"
        "html,body{margin:0;padding:0;}"
        "body{font-family:Inter,Arial,sans-serif;}"
        "</style>"
        "</head><body>"
        f"<div style=\"position:relative;width:{paper_profile['sheet_width_mm']}mm;"
        f"height:{paper_profile['sheet_height_mm']}mm;overflow:hidden;box-sizing:border-box;\">"
        f"{''.join(slot_markup)}"
        "</div>"
        "</body></html>"
    )


def _render_pdf(html: str, *, base_url: str | None = None) -> bytes:
    if HTML is None:
        raise CardRenderError("PDF rendering backend is unavailable.", status_code=503)
    return HTML(string=html, base_url=base_url).write_pdf()


def build_sheet_slots(
    *,
    paper_profile: PaperProfile,
    selected_slots: list[int] | None = None,
) -> tuple[list[dict[str, Any]], list[int]]:
    return _build_slot_layout(paper_profile=paper_profile, selected_slots=selected_slots)


def render_card_fragment_html(preview_data: dict[str, Any]) -> str:
    return _render_card_fragment(preview_data)


def render_pdf_bytes_from_html(html: str, *, base_url: str | None = None) -> bytes:
    return _render_pdf(html, base_url=base_url)


def render_card_pdf_bytes(preview_data: dict[str, Any], *, base_url: str | None = None) -> bytes:
    html = _render_card_document_html(preview_data)
    return _render_pdf(html, base_url=base_url)


def render_sheet_pdf_bytes(preview_data: dict[str, Any], *, base_url: str | None = None) -> bytes:
    html = _render_sheet_document_html(preview_data)
    return _render_pdf(html, base_url=base_url)
