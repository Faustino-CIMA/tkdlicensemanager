from __future__ import annotations

import base64
from decimal import Decimal, InvalidOperation
from html import escape
from io import BytesIO
import json
import math
import mimetypes
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.http import HttpRequest
from django.utils import timezone

from clubs.models import BrandingAsset, Club
from members.models import Member

from .card_registry import (
    ALLOWED_CARD_SIDES,
    CARD_SIDE_BACK,
    CARD_SIDE_FRONT,
    ALLOWED_MERGE_FIELDS,
    MERGE_FIELD_PATTERN,
    normalize_design_payload,
    validate_design_payload_schema,
)
from .models import (
    CardFontAsset,
    CardImageAsset,
    CardTemplateVersion,
    License,
    PaperProfile,
)

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


RENDER_ENGINE_VERSION = "card-render-v2.0"


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


def _format_plain_decimal(value: Decimal, quant: str = "0.01") -> str:
    return f"{value.quantize(Decimal(quant))}"


def _coerce_percent(value: Any, *, field_name: str) -> Decimal:
    try:
        percent_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise CardRenderError(f"{field_name} must be a decimal percentage.") from exc
    if percent_value < Decimal("0.00") or percent_value > Decimal("100.00"):
        raise CardRenderError(f"{field_name} must be between 0 and 100.")
    return percent_value.quantize(Decimal("0.01"))


def _normalize_css_color(value: Any, *, fallback: str = "transparent") -> str:
    color_value = str(value or "").strip()
    if not color_value:
        return fallback
    return color_value


def _safe_border_style(value: Any, *, fallback: str = "solid") -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"solid", "dashed", "dotted"}:
        return normalized
    return fallback


def _safe_transform_origin(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    allowed = {
        "center center",
        "top left",
        "top center",
        "top right",
        "center left",
        "center right",
        "bottom left",
        "bottom center",
        "bottom right",
    }
    return normalized if normalized in allowed else "center center"


def _guess_mime_type_from_name(filename: str, *, fallback: str) -> str:
    guessed_mime_type = mimetypes.guess_type(filename)[0]
    return guessed_mime_type or fallback


def _file_to_data_uri(file_field, *, fallback_mime: str) -> str:
    if not file_field or not getattr(file_field, "name", ""):
        return ""
    try:
        with file_field.open("rb") as file_stream:
            file_bytes = file_stream.read()
    except Exception:  # pragma: no cover - storage backend dependent
        return ""
    if not file_bytes:
        return ""
    mime_type = _guess_mime_type_from_name(str(file_field.name), fallback=fallback_mime)
    return f"data:{mime_type};base64,{base64.b64encode(file_bytes).decode('ascii')}"


def _extract_asset_ids_from_design_payload(
    design_payload: dict[str, Any],
) -> tuple[set[int], set[int]]:
    font_ids: set[int] = set()
    image_ids: set[int] = set()
    for element in design_payload.get("elements") or []:
        if not isinstance(element, dict):
            continue
        style = element.get("style") or {}
        if not isinstance(style, dict):
            continue
        font_asset_id = style.get("font_asset_id")
        image_asset_id = style.get("image_asset_id")
        if font_asset_id is not None:
            try:
                parsed_font_id = int(str(font_asset_id))
                if parsed_font_id > 0:
                    font_ids.add(parsed_font_id)
            except (TypeError, ValueError):
                pass
        if image_asset_id is not None:
            try:
                parsed_image_id = int(str(image_asset_id))
                if parsed_image_id > 0:
                    image_ids.add(parsed_image_id)
            except (TypeError, ValueError):
                pass
    return font_ids, image_ids


def _resolve_active_font_assets(font_ids: set[int]) -> dict[int, dict[str, Any]]:
    if not font_ids:
        return {}
    queryset = CardFontAsset.objects.filter(id__in=font_ids, is_active=True).order_by("id")
    resolved: dict[int, dict[str, Any]] = {}
    for font_asset in queryset:
        css_family = f"CardFontAsset{font_asset.id}"
        source_data_uri = _file_to_data_uri(font_asset.file, fallback_mime="font/ttf")
        resolved[int(font_asset.id)] = {
            "id": int(font_asset.id),
            "name": str(font_asset.name),
            "css_family": css_family,
            "source_data_uri": source_data_uri,
            "usable": bool(source_data_uri),
        }
    return resolved


def _resolve_active_image_assets(image_ids: set[int], *, request: HttpRequest | None) -> dict[int, dict[str, Any]]:
    if not image_ids:
        return {}
    queryset = CardImageAsset.objects.filter(id__in=image_ids, is_active=True).order_by("id")
    resolved: dict[int, dict[str, Any]] = {}
    for image_asset in queryset:
        data_uri = _file_to_data_uri(image_asset.image, fallback_mime="image/png")
        url_value = ""
        if image_asset.image:
            try:
                url_value = str(image_asset.image.url)
            except Exception:  # pragma: no cover - storage backend dependent
                url_value = ""
        normalized_url = _normalize_source_url(url_value, request)
        resolved[int(image_asset.id)] = {
            "id": int(image_asset.id),
            "name": str(image_asset.name),
            "data_uri": data_uri,
            "url": normalized_url,
            "usable": bool(data_uri or normalized_url),
        }
    return resolved


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


def _calculate_member_age(member: Member | None) -> str:
    if member is None or member.date_of_birth is None:
        return ""
    today = timezone.localdate()
    years = today.year - member.date_of_birth.year
    has_had_birthday = (today.month, today.day) >= (
        member.date_of_birth.month,
        member.date_of_birth.day,
    )
    if not has_had_birthday:
        years -= 1
    return str(max(0, years))


def _compute_validity_badge(license_record: License | None) -> str:
    if license_record is None:
        return ""
    today = timezone.localdate()
    if license_record.end_date and license_record.end_date < today:
        return "expired"
    if license_record.end_date:
        remaining_days = (license_record.end_date - today).days
        if remaining_days <= 30:
            return "expiring"
    if license_record.status == License.Status.ACTIVE:
        return "valid"
    return str(license_record.status or "")


def _resolve_club_logo_print_url(club: Club | None) -> str:
    if club is None:
        return ""
    logo_asset = (
        BrandingAsset.objects.filter(
            scope_type=BrandingAsset.ScopeType.CLUB,
            asset_type=BrandingAsset.AssetType.LOGO,
            usage_type=BrandingAsset.UsageType.PRINT,
            club_id=club.id,
            is_selected=True,
        )
        .order_by("-updated_at", "-id")
        .first()
    )
    if logo_asset is None:
        logo_asset = (
            BrandingAsset.objects.filter(
                scope_type=BrandingAsset.ScopeType.CLUB,
                asset_type=BrandingAsset.AssetType.LOGO,
                usage_type=BrandingAsset.UsageType.GENERAL,
                club_id=club.id,
                is_selected=True,
            )
            .order_by("-updated_at", "-id")
            .first()
        )
    if logo_asset is None or not logo_asset.file:
        return ""
    try:
        return str(logo_asset.file.url)
    except Exception:  # pragma: no cover - storage backend dependent
        return ""


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
        "member.date_of_birth": (
            member.date_of_birth.isoformat() if member and member.date_of_birth else ""
        ),
        "member.age": _calculate_member_age(member),
        "member.profile_picture_processed": (
            member.profile_picture_processed.url
            if member and getattr(member, "profile_picture_processed", None)
            else ""
        ),
        "club.name": club.name if club else "",
        "club.logo_print_url": _resolve_club_logo_print_url(club),
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
        "license.status": str(license_record.status) if license_record else "",
        "license.validity_badge": _compute_validity_badge(license_record),
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
    return _file_to_data_uri(image_field, fallback_mime="image/png")


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
    image_assets: dict[int, dict[str, Any]],
    request: HttpRequest | None,
) -> tuple[str, dict[str, Any]]:
    asset_resolution_meta: dict[str, Any] = {}
    style = element.get("style", {})
    if style is None:
        style = {}
    if not isinstance(style, dict):
        style = {}
    image_asset_id = style.get("image_asset_id")
    if image_asset_id is not None:
        try:
            parsed_image_asset_id = int(str(image_asset_id))
        except (TypeError, ValueError):
            parsed_image_asset_id = -1
        asset_resolution_meta = {
            "image_asset_id": parsed_image_asset_id if parsed_image_asset_id > 0 else None,
            "asset_status": "missing",
        }
        resolved_image_asset = image_assets.get(parsed_image_asset_id)
        if resolved_image_asset and resolved_image_asset.get("usable"):
            preferred_source = (
                str(resolved_image_asset.get("data_uri") or "").strip()
                or str(resolved_image_asset.get("url") or "").strip()
            )
            if preferred_source:
                return preferred_source, {
                    "image_asset_id": parsed_image_asset_id,
                    "resolved_via": "style.image_asset_id",
                    "status": "resolved",
                }

    merge_field = str(element.get("merge_field") or "").strip()
    if merge_field == "member.profile_picture_processed":
        member_source = _member_photo_data_uri(member) or _resolve_merge_value(
            merge_field, context
        )
        return member_source, {
            **asset_resolution_meta,
            "resolved_via": "member.profile_picture_processed",
            "status": "resolved",
        }
    if merge_field:
        return _normalize_source_url(_resolve_merge_value(merge_field, context), request), {
            **asset_resolution_meta,
            "resolved_via": "merge_field",
            "status": "resolved",
        }

    source = str(element.get("source") or "").strip()
    if source in {"member.profile_picture_processed", "{{member.profile_picture_processed}}"}:
        member_source = _member_photo_data_uri(member) or context.get(
            "member.profile_picture_processed", ""
        )
        return member_source, {
            **asset_resolution_meta,
            "resolved_via": "member.profile_picture_processed",
            "status": "resolved",
        }
    if not source:
        member_source = _member_photo_data_uri(member)
        return member_source, {
            **asset_resolution_meta,
            "resolved_via": "member.profile_picture_processed",
            "status": "resolved" if member_source else "empty",
        }

    token_matches = MERGE_FIELD_PATTERN.findall(source)
    if token_matches:
        for token in token_matches:
            merge_key = str(token).strip()
            if merge_key not in ALLOWED_MERGE_FIELDS:
                raise CardRenderError(f"Unknown merge field '{merge_key}'.")
        if "member.profile_picture_processed" in token_matches:
            resolved_token_source = _member_photo_data_uri(member) or _resolve_tokenized_text(
                source, context
            )
            return resolved_token_source, {
                **asset_resolution_meta,
                "resolved_via": "tokenized_source",
                "status": "resolved",
            }
        return _normalize_source_url(_resolve_tokenized_text(source, context), request), {
            **asset_resolution_meta,
            "resolved_via": "tokenized_source",
            "status": "resolved",
        }

    if source in ALLOWED_MERGE_FIELDS:
        if source == "member.profile_picture_processed":
            resolved_source = _member_photo_data_uri(member) or context.get(source, "")
            return resolved_source, {
                **asset_resolution_meta,
                "resolved_via": "merge_source",
                "status": "resolved",
            }
        return _normalize_source_url(_resolve_merge_value(source, context), request), {
            **asset_resolution_meta,
            "resolved_via": "merge_source",
            "status": "resolved",
        }

    return _normalize_source_url(source, request), {
        **asset_resolution_meta,
        "resolved_via": "source",
        "status": "resolved",
    }


def _build_qr_data_uri(
    value: str,
    *,
    foreground_color: str = "black",
    background_color: str = "white",
    quiet_zone_modules: int = 1,
) -> str:
    payload = str(value or "").strip()
    if not payload or qrcode is None:
        return ""
    border = max(0, int(quiet_zone_modules))
    qr_code = qrcode.QRCode(box_size=6, border=border)
    qr_code.add_data(payload)
    qr_code.make(fit=True)
    image = qr_code.make_image(fill_color=foreground_color, back_color=background_color)
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


def _resolve_qr_value(element: dict[str, Any], context: dict[str, str]) -> str:
    style = element.get("style", {})
    if style is None:
        style = {}
    if not isinstance(style, dict):
        style = {}

    qr_mode = str(
        style.get("data_mode")
        or element.get("qr_mode")
        or ("multi_merge" if element.get("merge_fields") else "single_merge")
    ).strip().lower()
    separator = str(
        style.get("separator")
        or element.get("qr_separator")
        or " | "
    )
    if qr_mode == "custom":
        custom_data = str(
            style.get("custom_data")
            or element.get("qr_data")
            or ""
        ).strip()
        if not custom_data:
            return ""
        return _resolve_tokenized_text(custom_data, context)

    merge_fields_source = style.get("merge_fields")
    if merge_fields_source is None:
        merge_fields_source = element.get("merge_fields")
    merge_fields: list[str] = []
    if isinstance(merge_fields_source, list):
        for merge_field in merge_fields_source:
            normalized_merge_field = str(merge_field).strip()
            if not normalized_merge_field:
                continue
            merge_fields.append(normalized_merge_field)

    if merge_fields:
        resolved_values: list[str] = []
        for merge_field in merge_fields:
            resolved_value = _resolve_merge_value(merge_field, context)
            if resolved_value != "":
                resolved_values.append(resolved_value)
        return separator.join(resolved_values).strip()

    return _resolve_element_value(element, context) or context.get("qr.validation_url", "")


def _normalize_preview_side(side: str | None) -> str:
    normalized_side = str(side or CARD_SIDE_FRONT).strip().lower()
    if normalized_side not in ALLOWED_CARD_SIDES:
        raise CardRenderError("side must be one of: front, back.")
    return normalized_side


def _extract_side_payload(
    normalized_design_payload: dict[str, Any],
    *,
    side: str,
) -> dict[str, Any]:
    sides_payload = normalized_design_payload.get("sides") or {}
    if not isinstance(sides_payload, dict):
        sides_payload = {}
    selected_side_payload = sides_payload.get(side) or {}
    if not isinstance(selected_side_payload, dict):
        selected_side_payload = {}
    selected_elements = selected_side_payload.get("elements") or []
    if not isinstance(selected_elements, list):
        selected_elements = []
    selected_background = selected_side_payload.get("background", {})
    if not isinstance(selected_background, (dict, str)):
        selected_background = {}
    return {
        "elements": selected_elements,
        "background": selected_background,
    }


def _build_side_summary(
    *,
    normalized_design_payload: dict[str, Any],
    active_side: str,
    has_explicit_sides: bool,
) -> tuple[list[str], dict[str, Any]]:
    sides_payload = normalized_design_payload.get("sides") or {}
    if not isinstance(sides_payload, dict):
        sides_payload = {}

    side_summary: dict[str, Any] = {}
    available_sides: list[str] = []
    for side_name in (CARD_SIDE_FRONT, CARD_SIDE_BACK):
        side_payload = sides_payload.get(side_name) or {}
        if not isinstance(side_payload, dict):
            side_payload = {}
        side_elements = side_payload.get("elements") or []
        if not isinstance(side_elements, list):
            side_elements = []
        side_background = side_payload.get("background", {})
        has_background = bool(side_background)
        element_count = len(side_elements)
        has_content = bool(element_count > 0 or has_background)
        side_summary[side_name] = {
            "element_count": element_count,
            "has_background": has_background,
            "has_content": has_content,
            "is_active": side_name == active_side,
        }
        if side_name == CARD_SIDE_FRONT or has_explicit_sides or has_content:
            available_sides.append(side_name)
    if active_side not in available_sides:
        available_sides.append(active_side)
    return available_sides, side_summary


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
    font_assets: dict[int, dict[str, Any]],
    image_assets: dict[int, dict[str, Any]],
    request: HttpRequest | None,
) -> list[dict[str, Any]]:
    def _parse_optional_asset_id(value: Any) -> int | None:
        if value is None or value == "":
            return None
        try:
            parsed = int(str(value))
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

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
        style_payload = dict(style)
        transform_origin = _safe_transform_origin(style_payload.get("transform_origin"))
        visible = bool(style_payload.get("visible", True))
        locked = bool(style_payload.get("locked", False))

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
            "transform_origin": transform_origin,
            "style": style_payload,
            "metadata": element.get("metadata", {}),
            "merge_field": str(element.get("merge_field") or ""),
            "visible": visible,
            "locked": locked,
            "bounds_mm": {
                "left": _format_mm(x_mm),
                "top": _format_mm(y_mm),
                "right": _format_mm(x_mm + width_mm),
                "bottom": _format_mm(y_mm + height_mm),
            },
        }

        if element_type == "text":
            resolved["resolved_text"] = _resolve_element_value(element, context)
            requested_font_asset_id = _parse_optional_asset_id(style_payload.get("font_asset_id"))
            resolved_font_asset = (
                font_assets.get(requested_font_asset_id)
                if requested_font_asset_id is not None
                else None
            )
            resolved_font_family = str(style_payload.get("font_family") or "Inter").strip() or "Inter"
            font_status = "fallback"
            if resolved_font_asset is not None and resolved_font_asset.get("usable"):
                resolved_font_family = str(resolved_font_asset.get("css_family") or resolved_font_family)
                font_status = "embedded"
            elif requested_font_asset_id is not None:
                font_status = "missing"
            resolved["resolved_font"] = {
                "requested_font_asset_id": requested_font_asset_id,
                "status": font_status,
                "font_family": resolved_font_family,
            }
        elif element_type == "image":
            resolved_source, source_meta = _resolve_image_source(
                element=element,
                context=context,
                member=member,
                image_assets=image_assets,
                request=request,
            )
            resolved["resolved_source"] = resolved_source
            resolved["resolved_source_meta"] = source_meta
        elif element_type == "shape":
            resolved["resolved_text"] = ""
            shape_kind = str(style_payload.get("shape_kind") or "rectangle").strip().lower()
            resolved["shape_kind"] = shape_kind or "rectangle"
        elif element_type == "qr":
            qr_value = _resolve_qr_value(element, context)
            resolved["resolved_value"] = qr_value
            qr_style = element.get("style", {})
            if not isinstance(qr_style, dict):
                qr_style = {}
            quiet_zone_modules = 1
            try:
                quiet_zone_modules = int(str(qr_style.get("quiet_zone_modules", 1)))
            except (TypeError, ValueError):
                quiet_zone_modules = 1
            quiet_zone_modules = max(0, quiet_zone_modules)
            foreground_color = _normalize_css_color(qr_style.get("foreground_color"), fallback="black")
            background_color = _normalize_css_color(qr_style.get("background_color"), fallback="white")
            resolved["qr_data_uri"] = _build_qr_data_uri(
                qr_value,
                foreground_color=foreground_color,
                background_color=background_color,
                quiet_zone_modules=quiet_zone_modules,
            )
            merge_fields = []
            if isinstance(qr_style.get("merge_fields"), list):
                merge_fields = [str(value).strip() for value in qr_style["merge_fields"] if str(value).strip()]
            elif isinstance(element.get("merge_fields"), list):
                merge_fields = [str(value).strip() for value in element["merge_fields"] if str(value).strip()]
            resolved["qr_mode"] = str(
                (qr_style or {}).get("data_mode")
                or element.get("qr_mode")
                or ("multi_merge" if merge_fields else "single_merge")
            ).strip().lower()
            resolved["qr_merge_fields"] = merge_fields
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
    corner_radius = (
        Decimal(str(paper_profile.card_corner_radius_mm))
        if paper_profile.card_corner_radius_mm is not None
        else Decimal("0.00")
    )

    for slot_index in range(slot_count):
        row = slot_index // columns
        col = slot_index % columns
        if row >= rows:
            break
        x_mm = margin_left + Decimal(col) * (card_width + h_gap)
        y_mm = margin_top + Decimal(row) * (card_height + v_gap)
        x_end_mm = x_mm + card_width
        y_end_mm = y_mm + card_height
        slots.append(
            {
                "slot_index": slot_index,
                "row": row,
                "column": col,
                "x_mm": _format_mm(x_mm),
                "y_mm": _format_mm(y_mm),
                "width_mm": _format_mm(card_width),
                "height_mm": _format_mm(card_height),
                "x_end_mm": _format_mm(x_end_mm),
                "y_end_mm": _format_mm(y_end_mm),
                "card_corner_radius_mm": _format_mm(corner_radius),
                "selected": slot_index in selected_set,
            }
        )
    return slots, normalized_slots


def build_preview_data(
    *,
    template_version: CardTemplateVersion,
    side: str = CARD_SIDE_FRONT,
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
        normalized_design_payload = normalize_design_payload(
            template_version.design_payload
        )
        validate_design_payload_schema(
            normalized_design_payload,
            canvas_width_mm=Decimal(str(template_version.card_format.width_mm)),
            canvas_height_mm=Decimal(str(template_version.card_format.height_mm)),
        )
    except ValidationError as exc:
        raise _error_from_validation(exc) from exc

    has_explicit_sides = bool(
        isinstance(template_version.design_payload, dict)
        and "sides" in template_version.design_payload
    )
    active_side = _normalize_preview_side(side)
    active_side_payload = _extract_side_payload(
        normalized_design_payload,
        side=active_side,
    )
    active_design_payload = {
        "elements": list(active_side_payload["elements"]),
        "background": active_side_payload["background"],
    }
    available_sides, side_summary = _build_side_summary(
        normalized_design_payload=normalized_design_payload,
        active_side=active_side,
        has_explicit_sides=has_explicit_sides,
    )

    requested_font_ids, requested_image_ids = _extract_asset_ids_from_design_payload(
        active_design_payload
    )
    resolved_font_assets = _resolve_active_font_assets(requested_font_ids)
    resolved_image_assets = _resolve_active_image_assets(
        requested_image_ids,
        request=request,
    )

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
        design_payload=active_design_payload,
        context=context,
        member=member,
        font_assets=resolved_font_assets,
        image_assets=resolved_image_assets,
        request=request,
    )

    bleed_value = _coerce_mm(bleed_mm, field_name="bleed_mm", allow_zero=True)
    safe_area_value = _coerce_mm(safe_area_mm, field_name="safe_area_mm", allow_zero=True)
    missing_font_ids = sorted(font_id for font_id in requested_font_ids if font_id not in resolved_font_assets)
    unavailable_font_ids = sorted(
        font_id
        for font_id, font_payload in resolved_font_assets.items()
        if not bool(font_payload.get("usable"))
    )
    missing_image_ids = sorted(image_id for image_id in requested_image_ids if image_id not in resolved_image_assets)
    unavailable_image_ids = sorted(
        image_id
        for image_id, image_payload in resolved_image_assets.items()
        if not bool(image_payload.get("usable"))
    )
    payload: dict[str, Any] = {
        "template_version_id": template_version.id,
        "template_id": template_version.template_id,
        "schema_version": int(normalized_design_payload.get("schema_version", 1)),
        "active_side": active_side,
        "available_sides": available_sides,
        "side_summary": side_summary,
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
        "background": active_side_payload.get("background", {}),
        "elements": resolved_elements,
        "render_metadata": {
            "engine_version": RENDER_ENGINE_VERSION,
            "unit": "mm",
            "precision_mm": "0.01",
            "geometry_rounding": "quantize_0.01",
            "active_side": active_side,
            "available_sides": available_sides,
            "font_assets": {
                "requested_ids": sorted(requested_font_ids),
                "resolved_ids": sorted(resolved_font_assets.keys()),
                "missing_ids": missing_font_ids,
                "unavailable_ids": unavailable_font_ids,
                "embedded_faces": [
                    {
                        "id": int(font_payload["id"]),
                        "css_family": str(font_payload["css_family"]),
                        "source_data_uri": str(font_payload["source_data_uri"]),
                    }
                    for font_payload in sorted(
                        resolved_font_assets.values(),
                        key=lambda payload: int(payload["id"]),
                    )
                    if bool(font_payload.get("usable"))
                ],
            },
            "image_assets": {
                "requested_ids": sorted(requested_image_ids),
                "resolved_ids": sorted(resolved_image_assets.keys()),
                "missing_ids": missing_image_ids,
                "unavailable_ids": unavailable_image_ids,
            },
        },
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
            "card_corner_radius_mm": (
                _format_mm(Decimal(str(paper_profile.card_corner_radius_mm)))
                if paper_profile.card_corner_radius_mm is not None
                else None
            ),
            "rows": int(paper_profile.rows),
            "columns": int(paper_profile.columns),
            "slot_count": int(paper_profile.slot_count),
        }
        payload["selected_slots"] = normalized_selected_slots
        payload["slots"] = slots
        if slots:
            max_x = max(Decimal(str(slot["x_end_mm"])) for slot in slots)
            max_y = max(Decimal(str(slot["y_end_mm"])) for slot in slots)
        else:
            max_x = Decimal("0.00")
            max_y = Decimal("0.00")
        payload["layout_metadata"] = {
            "max_x_mm": _format_mm(max_x),
            "max_y_mm": _format_mm(max_y),
            "sheet_width_mm": _format_mm(Decimal(str(paper_profile.sheet_width_mm))),
            "sheet_height_mm": _format_mm(Decimal(str(paper_profile.sheet_height_mm))),
            "within_sheet_bounds": (
                max_x <= Decimal(str(paper_profile.sheet_width_mm))
                and max_y <= Decimal(str(paper_profile.sheet_height_mm))
            ),
        }
    else:
        if selected_slots:
            raise CardRenderError(
                "selected_slots requires a paper profile on the request or template version."
            )
        payload["paper_profile"] = None
        payload["selected_slots"] = []
        payload["slots"] = []
        payload["layout_metadata"] = None

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


def _style_percent_value(style: dict[str, Any], key: str, default: Decimal) -> Decimal:
    value = style.get(key, default)
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        decimal_value = default
    if decimal_value < Decimal("0.00"):
        decimal_value = Decimal("0.00")
    if decimal_value > Decimal("100.00"):
        decimal_value = Decimal("100.00")
    return decimal_value.quantize(Decimal("0.01"))


def _style_bool_value(style: dict[str, Any], key: str, default: bool) -> bool:
    value = style.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return bool(value)


def _element_border_radius_css(style: dict[str, Any]) -> str:
    if any(
        key in style
        for key in (
            "radius_top_left_mm",
            "radius_top_right_mm",
            "radius_bottom_right_mm",
            "radius_bottom_left_mm",
        )
    ):
        top_left = _style_mm_value(style, "radius_top_left_mm", Decimal("0.00"))
        top_right = _style_mm_value(style, "radius_top_right_mm", Decimal("0.00"))
        bottom_right = _style_mm_value(style, "radius_bottom_right_mm", Decimal("0.00"))
        bottom_left = _style_mm_value(style, "radius_bottom_left_mm", Decimal("0.00"))
        return (
            f"{_format_mm(top_left)}mm {_format_mm(top_right)}mm "
            f"{_format_mm(bottom_right)}mm {_format_mm(bottom_left)}mm"
        )
    border_radius = _style_mm_value(
        style,
        "border_radius_mm",
        _style_mm_value(style, "corner_radius_mm", Decimal("0.00")),
    )
    return f"{_format_mm(border_radius)}mm"


def _build_shape_svg_markup(
    *,
    shape_kind: str,
    style: dict[str, Any],
) -> str:
    stroke_color = escape(_normalize_css_color(style.get("stroke_color"), fallback="transparent"))
    stroke_width = _style_mm_value(
        style,
        "stroke_width_mm",
        _style_mm_value(style, "border_width_mm", Decimal("0.20")),
    )
    border_style = _safe_border_style(style.get("border_style"), fallback="solid")
    stroke_dasharray = ""
    if border_style == "dashed":
        stroke_dasharray = ' stroke-dasharray="6 4"'
    elif border_style == "dotted":
        stroke_dasharray = ' stroke-dasharray="2 3"'
    fill_color = escape(
        _normalize_css_color(
            style.get("fill_color"),
            fallback=_normalize_css_color(style.get("background_color"), fallback="#d1d5db"),
        )
    )
    gradient_start = escape(
        _normalize_css_color(
            style.get("fill_gradient_start"),
            fallback=fill_color,
        )
    )
    gradient_end = escape(
        _normalize_css_color(
            style.get("fill_gradient_end"),
            fallback=fill_color,
        )
    )
    try:
        gradient_angle = Decimal(str(style.get("fill_gradient_angle_deg", "90"))).quantize(
            Decimal("0.01")
        )
    except (InvalidOperation, TypeError, ValueError):
        gradient_angle = Decimal("90.00")
    has_gradient = bool(style.get("fill_gradient") or style.get("fill_gradient_start") or style.get("fill_gradient_end"))
    fill_value = "url(#shapeGradient)" if has_gradient else fill_color

    defs = ""
    if has_gradient:
        defs = (
            "<defs>"
            f'<linearGradient id="shapeGradient" gradientTransform="rotate({escape(str(gradient_angle))})">'
            f'<stop offset="0%" stop-color="{gradient_start}" />'
            f'<stop offset="100%" stop-color="{gradient_end}" />'
            "</linearGradient>"
            "</defs>"
        )

    if shape_kind in {"rectangle", ""}:
        border_radius = _style_mm_value(
            style,
            "border_radius_mm",
            _style_mm_value(style, "corner_radius_mm", Decimal("0.00")),
        )
        rx_value = max(Decimal("0.00"), border_radius * Decimal("3.0"))
        return (
            "<svg viewBox='0 0 100 100' preserveAspectRatio='none' style='width:100%;height:100%;display:block;'>"
            f"{defs}"
            f"<rect x='0' y='0' width='100' height='100' rx='{_format_plain_decimal(rx_value)}' "
            f"fill='{fill_value}' stroke='{stroke_color}' stroke-width='{_format_plain_decimal(stroke_width)}'"
            f"{stroke_dasharray}/>"
            "</svg>"
        )
    if shape_kind in {"circle", "ellipse"}:
        return (
            "<svg viewBox='0 0 100 100' preserveAspectRatio='none' style='width:100%;height:100%;display:block;'>"
            f"{defs}"
            f"<ellipse cx='50' cy='50' rx='50' ry='50' fill='{fill_value}' stroke='{stroke_color}' "
            f"stroke-width='{_format_plain_decimal(stroke_width)}'{stroke_dasharray}/>"
            "</svg>"
        )
    if shape_kind == "line":
        line_color = escape(
            _normalize_css_color(style.get("line_color"), fallback=_normalize_css_color(style.get("stroke_color"), fallback="#111827"))
        )
        return (
            "<svg viewBox='0 0 100 100' preserveAspectRatio='none' style='width:100%;height:100%;display:block;'>"
            "<defs></defs>"
            f"<line x1='0' y1='50' x2='100' y2='50' stroke='{line_color}' "
            f"stroke-width='{_format_plain_decimal(max(stroke_width, Decimal('0.20')))}'{stroke_dasharray}/>"
            "</svg>"
        )

    if shape_kind == "star":
        points = "50,2 61,36 98,36 68,57 79,92 50,71 21,92 32,57 2,36 39,36"
    elif shape_kind == "arrow":
        head_pct = _style_percent_value(style, "arrow_head_pct", Decimal("30.00"))
        shaft_pct = _style_percent_value(style, "arrow_shaft_pct", Decimal("40.00"))
        head_start = Decimal("100.00") - head_pct
        top_y = (Decimal("100.00") - shaft_pct) / Decimal("2.00")
        bottom_y = Decimal("100.00") - top_y
        points = (
            f"0,{_format_plain_decimal(top_y)} "
            f"{_format_plain_decimal(head_start)},{_format_plain_decimal(top_y)} "
            f"{_format_plain_decimal(head_start)},0 "
            "100,50 "
            f"{_format_plain_decimal(head_start)},100 "
            f"{_format_plain_decimal(head_start)},{_format_plain_decimal(bottom_y)} "
            f"0,{_format_plain_decimal(bottom_y)}"
        )
    else:
        points_payload = style.get("shape_points")
        if isinstance(points_payload, list) and points_payload:
            normalized_points: list[str] = []
            for point in points_payload:
                if not isinstance(point, dict):
                    continue
                x_pct = _style_percent_value({"x_pct": point.get("x_pct", 0)}, "x_pct", Decimal("0.00"))
                y_pct = _style_percent_value({"y_pct": point.get("y_pct", 0)}, "y_pct", Decimal("0.00"))
                normalized_points.append(
                    f"{_format_plain_decimal(x_pct)},{_format_plain_decimal(y_pct)}"
                )
            points = " ".join(normalized_points) or "50,2 98,98 2,98"
        else:
            sides = max(3, int(style.get("polygon_sides", 6)))
            points_list: list[str] = []
            center = Decimal("50.00")
            radius = Decimal("48.00")
            for index in range(sides):
                angle = Decimal(index) * Decimal("360.00") / Decimal(sides)
                radians = float(angle) * math.pi / 180.0
                x = center + radius * Decimal(str(math.cos(radians)))
                y = center + radius * Decimal(str(math.sin(radians)))
                points_list.append(
                    f"{_format_plain_decimal(x)},{_format_plain_decimal(y)}"
                )
            points = " ".join(points_list)

    return (
        "<svg viewBox='0 0 100 100' preserveAspectRatio='none' style='width:100%;height:100%;display:block;'>"
        f"{defs}"
        f"<polygon points='{points}' fill='{fill_value}' stroke='{stroke_color}' "
        f"stroke-width='{_format_plain_decimal(stroke_width)}'{stroke_dasharray}/>"
        "</svg>"
    )


def _extract_embedded_font_faces(preview_data: dict[str, Any]) -> list[dict[str, str]]:
    render_metadata = preview_data.get("render_metadata") or {}
    if not isinstance(render_metadata, dict):
        return []
    font_assets = render_metadata.get("font_assets") or {}
    if not isinstance(font_assets, dict):
        return []
    embedded_faces = font_assets.get("embedded_faces")
    if not isinstance(embedded_faces, list):
        return []
    normalized_faces: list[dict[str, str]] = []
    for font_face in embedded_faces:
        if not isinstance(font_face, dict):
            continue
        css_family = str(font_face.get("css_family") or "").strip()
        source_data_uri = str(font_face.get("source_data_uri") or "").strip()
        if not css_family or not source_data_uri:
            continue
        normalized_faces.append(
            {"css_family": css_family, "source_data_uri": source_data_uri}
        )
    return normalized_faces


def _build_embedded_font_face_css(preview_data: dict[str, Any]) -> str:
    return build_embedded_font_face_css_from_payloads([preview_data])


def build_embedded_font_face_css_from_payloads(
    preview_payloads: list[dict[str, Any]],
) -> str:
    faces_by_family: dict[str, str] = {}
    for preview_payload in preview_payloads:
        for face in _extract_embedded_font_faces(preview_payload):
            css_family = str(face.get("css_family") or "").strip()
            source_data_uri = str(face.get("source_data_uri") or "").strip()
            if not css_family or not source_data_uri:
                continue
            faces_by_family[css_family] = source_data_uri
    if not faces_by_family:
        return ""
    sorted_faces = sorted(faces_by_family.items(), key=lambda item: item[0])
    return "".join(
        (
            "@font-face{"
            f"font-family:'{escape(css_family)}';"
            f"src:url('{escape(source_data_uri)}') format('truetype');"
            "font-display:swap;"
            "}"
        )
        for css_family, source_data_uri in sorted_faces
    )


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
    transform_origin = str(element.get("transform_origin") or "center center")
    visibility = "visible" if bool(element.get("visible", True)) else "hidden"
    base_style = (
        "position:absolute;"
        f"left:{element['x_mm']}mm;"
        f"top:{element['y_mm']}mm;"
        f"width:{element['width_mm']}mm;"
        f"height:{element['height_mm']}mm;"
        "box-sizing:border-box;"
        "overflow:hidden;"
        f"visibility:{visibility};"
        f"opacity:{element['opacity']};"
        f"transform:rotate({element['rotation_deg']}deg);"
        f"transform-origin:{escape(transform_origin)};"
        f"z-index:{element['z_index']};"
    )

    element_type = element["type"]
    if element_type == "text":
        font_size = _font_size_mm(style)
        color = escape(_style_value_from_dict(style, "color", "#111827"))
        font_weight = escape(_style_value_from_dict(style, "font_weight", "500"))
        font_style_value = "italic" if _style_bool_value(style, "italic", False) else "normal"
        if str(style.get("font_style", "")).strip().lower() == "italic":
            font_style_value = "italic"
        text_align = escape(_style_value_from_dict(style, "text_align", "left"))
        line_height = escape(_style_value_from_dict(style, "line_height", "1.2"))
        letter_spacing = _style_mm_value(style, "letter_spacing_mm", Decimal("0.00"))
        text_transform = escape(_style_value_from_dict(style, "text_transform", "none"))
        text_decoration = escape(_style_value_from_dict(style, "text_decoration", "none"))
        shadow_color = _normalize_css_color(style.get("shadow_color"), fallback="")
        shadow_offset_x = _style_mm_value(style, "shadow_offset_x_mm", Decimal("0.00"))
        shadow_offset_y = _style_mm_value(style, "shadow_offset_y_mm", Decimal("0.00"))
        shadow_blur = _style_mm_value(style, "shadow_blur_mm", Decimal("0.00"))
        text_shadow = ""
        if shadow_color:
            text_shadow = (
                f"text-shadow:{_format_mm(shadow_offset_x)}mm {_format_mm(shadow_offset_y)}mm "
                f"{_format_mm(shadow_blur)}mm {escape(shadow_color)};"
            )
        stroke_color = _normalize_css_color(style.get("stroke_color"), fallback="")
        stroke_width = _style_mm_value(style, "stroke_width_mm", Decimal("0.00"))
        text_stroke = ""
        if stroke_color and stroke_width > Decimal("0.00"):
            text_stroke = (
                f"-webkit-text-stroke:{_format_mm(stroke_width)}mm {escape(stroke_color)};"
            )
        resolved_font = element.get("resolved_font") or {}
        resolved_font_family = ""
        if isinstance(resolved_font, dict):
            resolved_font_family = str(resolved_font.get("font_family") or "")
        font_family = resolved_font_family or str(style.get("font_family") or "Inter")
        font_family = font_family.strip() or "Inter"
        font_family_css = escape(font_family).replace("'", "\\'")
        text_value = escape(str(element.get("resolved_text", ""))).replace("\n", "<br/>")
        return (
            f'<div style="{base_style}'
            f"font-size:{_format_mm(font_size)}mm;"
            f"color:{color};font-weight:{font_weight};text-align:{text_align};"
            f"font-style:{font_style_value};line-height:{line_height};"
            f"letter-spacing:{_format_mm(letter_spacing)}mm;"
            f"text-transform:{text_transform};text-decoration:{text_decoration};"
            f"{text_shadow}{text_stroke}"
            f"white-space:normal;word-break:break-word;"
            f"font-family:'{font_family_css}',Inter,Arial,sans-serif;"
            '">'
            f"{text_value}</div>"
        )
    if element_type == "image":
        source = str(element.get("resolved_source", "")).strip()
        object_fit = str(style.get("object_fit") or "contain").strip().lower()
        if object_fit not in {"contain", "cover", "fill", "scale-down", "none"}:
            object_fit = "contain"
        object_pos_x = _style_percent_value(style, "object_position_x_pct", Decimal("50.00"))
        object_pos_y = _style_percent_value(style, "object_position_y_pct", Decimal("50.00"))
        border_width = _style_mm_value(style, "border_width_mm", Decimal("0.00"))
        border_color = escape(_normalize_css_color(style.get("border_color"), fallback="transparent"))
        border_style = _safe_border_style(style.get("border_style"), fallback="solid")
        border_radius_css = _element_border_radius_css(style)
        grayscale_enabled = _style_bool_value(style, "grayscale", False)
        brightness = _style_percent_value(style, "brightness_pct", Decimal("100.00"))
        contrast = _style_percent_value(style, "contrast_pct", Decimal("100.00"))
        filter_parts = []
        if grayscale_enabled:
            filter_parts.append("grayscale(100%)")
        if brightness != Decimal("100.00"):
            filter_parts.append(f"brightness({_format_plain_decimal(brightness)}%)")
        if contrast != Decimal("100.00"):
            filter_parts.append(f"contrast({_format_plain_decimal(contrast)}%)")
        image_filter_css = f"filter:{' '.join(filter_parts)};" if filter_parts else ""
        if source:
            return (
                f'<div style="{base_style}'
                f"border:{_format_mm(border_width)}mm {border_style} {border_color};"
                f"border-radius:{border_radius_css};"
                '">'
                f'<img src="{escape(source)}" alt="" '
                f'style="width:100%;height:100%;object-fit:{object_fit};'
                f"object-position:{_format_plain_decimal(object_pos_x)}% {_format_plain_decimal(object_pos_y)}%;"
                f"border-radius:{border_radius_css};display:block;{image_filter_css}\"/>"
                "</div>"
            )
        return (
            f'<div style="{base_style}'
            "border:0.20mm dashed #9ca3af;background:#f9fafb;"
            'display:flex;align-items:center;justify-content:center;'
            'font-size:2.6mm;color:#6b7280;">No image</div>'
        )
    if element_type == "shape":
        shape_kind = str(element.get("shape_kind") or style.get("shape_kind") or "rectangle").strip().lower()
        border_radius_css = _element_border_radius_css(style)
        shape_svg = _build_shape_svg_markup(shape_kind=shape_kind, style=style)
        return (
            f'<div style="{base_style}'
            f"border-radius:{border_radius_css};"
            '">'
            f"{shape_svg}</div>"
        )
    if element_type == "qr":
        qr_data_uri = str(element.get("qr_data_uri", "")).strip()
        foreground_color = escape(_normalize_css_color(style.get("foreground_color"), fallback="#111827"))
        background_color = escape(_normalize_css_color(style.get("background_color"), fallback="#ffffff"))
        border_radius_css = _element_border_radius_css(style)
        if qr_data_uri:
            return (
                f'<div style="{base_style}'
                f"background:{background_color};border-radius:{border_radius_css};"
                '">'
                f'<img src="{escape(qr_data_uri)}" alt="QR" '
                f'style="width:100%;height:100%;object-fit:contain;display:block;border-radius:{border_radius_css};"/>'
                "</div>"
            )
        return (
            f'<div style="{base_style}'
            "border:0.20mm dashed #6b7280;background:#f3f4f6;"
            'display:flex;align-items:center;justify-content:center;'
            f'font-size:2.4mm;color:{foreground_color};">QR</div>'
        )
    if element_type == "barcode":
        foreground_color = escape(_normalize_css_color(style.get("foreground_color"), fallback="#111827"))
        background_color = escape(_normalize_css_color(style.get("background_color"), fallback="transparent"))
        barcode_value = escape(str(element.get("resolved_value", "")))
        return (
            f'<div style="{base_style}display:flex;flex-direction:column;justify-content:center;'
            f'background:{background_color};">'
            f'<div style="font-family:monospace;font-size:3.00mm;letter-spacing:0.40mm;'
            f'line-height:1;text-align:center;color:{foreground_color};">||||||||||||||||||||||||</div>'
            f'<div style="font-size:2.40mm;line-height:1.1;text-align:center;'
            f'font-family:Inter,Arial,sans-serif;color:{foreground_color};">{barcode_value}</div>'
            "</div>"
        )
    return ""


def _render_card_fragment(preview_data: dict[str, Any]) -> str:
    card_format = preview_data["card_format"]
    width_mm = str(card_format["width_mm"])
    height_mm = str(card_format["height_mm"])
    guides = preview_data["guides"]
    paper_profile = preview_data.get("paper_profile") or {}
    if not isinstance(paper_profile, dict):
        paper_profile = {}
    corner_radius_mm = str(paper_profile.get("card_corner_radius_mm") or "0.00")
    background_payload = preview_data.get("background")
    background_style = "background:#ffffff;"
    if isinstance(background_payload, str):
        background_value = background_payload.strip()
        if background_value:
            background_style = f"background:{escape(background_value)};"
    elif isinstance(background_payload, dict):
        color_value = str(
            background_payload.get("color")
            or background_payload.get("background_color")
            or ""
        ).strip()
        if color_value:
            background_style = f"background:{escape(color_value)};"

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
        f'height:{height_mm}mm;overflow:hidden;box-sizing:border-box;'
        f'border-radius:{escape(corner_radius_mm)}mm;{background_style}">'
        f"{elements_html}{guide_html}</div>"
    )


def _render_card_document_html(preview_data: dict[str, Any]) -> str:
    card_format = preview_data["card_format"]
    width_mm = str(card_format["width_mm"])
    height_mm = str(card_format["height_mm"])
    card_fragment = _render_card_fragment(preview_data)
    font_face_css = _build_embedded_font_face_css(preview_data)
    return (
        "<!doctype html>"
        "<html><head><meta charset='utf-8'>"
        "<style>"
        f"@page {{ size: {width_mm}mm {height_mm}mm; margin: 0; }}"
        "html,body{margin:0;padding:0;}"
        "body{font-family:Inter,Arial,sans-serif;}"
        f"{font_face_css}"
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
    font_face_css = _build_embedded_font_face_css(preview_data)
    slot_markup: list[str] = []
    for slot in slots:
        selected = bool(slot.get("selected"))
        slot_border = "#1d4ed8" if selected else "#d1d5db"
        corner_radius_mm = str(slot.get("card_corner_radius_mm") or "0.00")
        content = card_fragment if selected else ""
        slot_markup.append(
            "<div "
            "style=\"position:absolute;box-sizing:border-box;"
            f"left:{slot['x_mm']}mm;top:{slot['y_mm']}mm;"
            f"width:{slot['width_mm']}mm;height:{slot['height_mm']}mm;"
            f"border:0.15mm dashed {slot_border};"
            f"border-radius:{escape(corner_radius_mm)}mm;overflow:hidden;\">"
            f"{content}</div>"
        )
    return (
        "<!doctype html>"
        "<html><head><meta charset='utf-8'>"
        "<style>"
        f"@page {{ size: {paper_profile['sheet_width_mm']}mm {paper_profile['sheet_height_mm']}mm; margin: 0; }}"
        "html,body{margin:0;padding:0;}"
        "body{font-family:Inter,Arial,sans-serif;}"
        f"{font_face_css}"
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


def build_card_simulation_payload(preview_data: dict[str, Any]) -> dict[str, str]:
    card_format = preview_data.get("card_format") or {}
    width_mm = str(card_format.get("width_mm") or "85.60")
    height_mm = str(card_format.get("height_mm") or "53.98")
    font_face_css = _build_embedded_font_face_css(preview_data)
    css = (
        f"{font_face_css}"
        "html,body{margin:0;padding:0;}"
        ".card-simulation-root{"
        f"width:{escape(width_mm)}mm;"
        f"height:{escape(height_mm)}mm;"
        "position:relative;"
        "overflow:hidden;"
        "}"
        ".card-canvas{position:relative;}"
    )
    html = f'<div class="card-simulation-root">{_render_card_fragment(preview_data)}</div>'
    return {"html": html, "css": css}


def render_pdf_bytes_from_html(html: str, *, base_url: str | None = None) -> bytes:
    return _render_pdf(html, base_url=base_url)


def render_card_pdf_bytes(preview_data: dict[str, Any], *, base_url: str | None = None) -> bytes:
    html = _render_card_document_html(preview_data)
    return _render_pdf(html, base_url=base_url)


def render_sheet_pdf_bytes(preview_data: dict[str, Any], *, base_url: str | None = None) -> bytes:
    html = _render_sheet_document_html(preview_data)
    return _render_pdf(html, base_url=base_url)
