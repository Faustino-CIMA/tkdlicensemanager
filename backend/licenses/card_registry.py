from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Any

from django.core.exceptions import ValidationError


MERGE_FIELD_REGISTRY = [
    {
        "key": "member.first_name",
        "label": "Member first name",
        "description": "Given name of the member.",
    },
    {
        "key": "member.last_name",
        "label": "Member last name",
        "description": "Family name of the member.",
    },
    {
        "key": "member.full_name",
        "label": "Member full name",
        "description": "Combined first and last name.",
    },
    {
        "key": "member.ltf_licenseid",
        "label": "Member license id",
        "description": "Official LTF license identifier.",
    },
    {
        "key": "member.sex",
        "label": "Member sex",
        "description": "Member sex value (M/F).",
    },
    {
        "key": "member.date_of_birth",
        "label": "Member date of birth",
        "description": "Date of birth in ISO format.",
    },
    {
        "key": "member.age",
        "label": "Member age",
        "description": "Computed age in years based on date of birth.",
    },
    {
        "key": "member.profile_picture_processed",
        "label": "Member processed profile picture",
        "description": "Resolved URL or source for the processed profile picture.",
    },
    {
        "key": "club.name",
        "label": "Club name",
        "description": "Name of the member's club.",
    },
    {
        "key": "club.logo_print_url",
        "label": "Club print logo URL",
        "description": "Selected club print logo URL when available.",
    },
    {
        "key": "license.type_name",
        "label": "License type",
        "description": "Display name of the license type.",
    },
    {
        "key": "license.year",
        "label": "License year",
        "description": "License validity year.",
    },
    {
        "key": "license.start_date",
        "label": "License start date",
        "description": "License start date.",
    },
    {
        "key": "license.end_date",
        "label": "License end date",
        "description": "License end date.",
    },
    {
        "key": "license.status",
        "label": "License status",
        "description": "Current license status.",
    },
    {
        "key": "license.validity_badge",
        "label": "License validity badge",
        "description": "Computed validity badge (valid/expiring/expired).",
    },
    {
        "key": "qr.validation_url",
        "label": "Validation QR URL",
        "description": "Backend URL for scanning and validating the card.",
    },
]

ALLOWED_MERGE_FIELDS = {field["key"] for field in MERGE_FIELD_REGISTRY}
MERGE_FIELD_PATTERN = re.compile(r"\{\{\s*([^{}\s]+)\s*\}\}")
ALLOWED_ELEMENT_TYPES = {"text", "image", "shape", "qr", "barcode"}
SCHEMA_VERSION_V1 = 1
SCHEMA_VERSION_V2 = 2

BASE_TOP_LEVEL_KEYS = {"schema_version", "elements", "metadata", "background"}
V2_TOP_LEVEL_KEYS = BASE_TOP_LEVEL_KEYS | {
    "layers",
    "canvas",
    "assets",
    "variables",
    "editor",
    "guides",
}

ALLOWED_COMMON_STYLE_KEYS = {
    "opacity",
    "visible",
    "locked",
    "background_color",
    "border_color",
    "border_width_mm",
    "border_radius_mm",
    "corner_radius_mm",
}
ALLOWED_TEXT_STYLE_KEYS = {
    "color",
    "font_family",
    "font_asset_id",
    "font_weight",
    "font_style",
    "font_size_mm",
    "font_size_pt",
    "line_height",
    "letter_spacing_mm",
    "text_align",
    "text_transform",
    "text_decoration",
    "vertical_align",
    "auto_fit",
    "max_lines",
}
ALLOWED_IMAGE_STYLE_KEYS = {
    "object_fit",
    "image_asset_id",
    "clip_radius_mm",
    "grayscale",
    "brightness_pct",
    "contrast_pct",
}
ALLOWED_SHAPE_STYLE_KEYS = {
    "fill_color",
    "stroke_color",
    "stroke_width_mm",
}
ALLOWED_QR_STYLE_KEYS = {
    "foreground_color",
    "background_color",
    "quiet_zone_modules",
    "error_correction_level",
    "logo_image_asset_id",
}
ALLOWED_BARCODE_STYLE_KEYS = {
    "foreground_color",
    "background_color",
    "show_value",
}

ALLOWED_STYLE_KEYS_BY_TYPE = {
    "text": ALLOWED_COMMON_STYLE_KEYS | ALLOWED_TEXT_STYLE_KEYS,
    "image": ALLOWED_COMMON_STYLE_KEYS | ALLOWED_IMAGE_STYLE_KEYS,
    "shape": ALLOWED_COMMON_STYLE_KEYS | ALLOWED_SHAPE_STYLE_KEYS,
    "qr": ALLOWED_COMMON_STYLE_KEYS | ALLOWED_QR_STYLE_KEYS,
    "barcode": ALLOWED_COMMON_STYLE_KEYS | ALLOWED_BARCODE_STYLE_KEYS,
}

STYLE_MM_KEYS = {
    "font_size_mm",
    "letter_spacing_mm",
    "border_width_mm",
    "border_radius_mm",
    "corner_radius_mm",
    "clip_radius_mm",
    "stroke_width_mm",
}
STYLE_BOOL_KEYS = {"visible", "locked", "auto_fit", "grayscale", "show_value"}
STYLE_INT_KEYS = {
    "max_lines",
    "quiet_zone_modules",
    "font_asset_id",
    "image_asset_id",
    "logo_image_asset_id",
}
STYLE_PERCENT_KEYS = {"brightness_pct", "contrast_pct"}
STYLE_ENUMS: dict[str, set[str]] = {
    "text_align": {"left", "center", "right", "justify"},
    "text_transform": {"none", "uppercase", "lowercase", "capitalize"},
    "text_decoration": {"none", "underline", "line-through"},
    "vertical_align": {"top", "middle", "bottom"},
    "object_fit": {"contain", "cover", "fill", "scale-down", "none"},
    "error_correction_level": {"l", "m", "q", "h"},
}


def _to_decimal(
    value: Any,
    *,
    field_name: str,
    allow_zero: bool = False,
    minimum: Decimal | None = None,
) -> Decimal:
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError({field_name: "Must be a decimal number in mm."}) from exc

    threshold = Decimal("0.00") if allow_zero else Decimal("0.01")
    if minimum is not None:
        threshold = minimum
    if decimal_value < threshold:
        comparator = ">=" if allow_zero or threshold == Decimal("0.00") else ">"
        raise ValidationError(
            {field_name: f"Must be {comparator} {threshold} mm."}
        )
    return decimal_value


def _coerce_schema_version(raw_value: Any) -> int:
    if raw_value is None or raw_value == "":
        return SCHEMA_VERSION_V1
    if isinstance(raw_value, int):
        if raw_value in {SCHEMA_VERSION_V1, SCHEMA_VERSION_V2}:
            return raw_value
        raise ValidationError({"design_payload.schema_version": "Unsupported schema version."})

    normalized = str(raw_value).strip().lower()
    if normalized in {"1", "v1"}:
        return SCHEMA_VERSION_V1
    if normalized in {"2", "v2"}:
        return SCHEMA_VERSION_V2
    raise ValidationError({"design_payload.schema_version": "Unsupported schema version."})


def _coerce_non_negative_int(value: Any, *, field_name: str) -> int:
    try:
        int_value = int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError({field_name: "Must be an integer."}) from exc
    if int_value < 0:
        raise ValidationError({field_name: "Must be >= 0."})
    return int_value


def _validate_style_scaffolding(
    style: Any,
    *,
    element_type: str,
    element_path: str,
) -> None:
    if style is None or style == "":
        return
    if not isinstance(style, dict):
        raise ValidationError({f"{element_path}.style": "style must be an object."})

    allowed_keys = ALLOWED_STYLE_KEYS_BY_TYPE.get(element_type, set())
    unknown_style_keys = set(style.keys()) - allowed_keys
    if unknown_style_keys:
        raise ValidationError(
            {
                f"{element_path}.style": (
                    "Unknown style key(s): " + ", ".join(sorted(unknown_style_keys))
                )
            }
        )

    for key in STYLE_MM_KEYS:
        if key in style:
            _to_decimal(
                style.get(key),
                field_name=f"{element_path}.style.{key}",
                allow_zero=True,
                minimum=Decimal("0.00"),
            )
    for key in STYLE_BOOL_KEYS:
        if key in style and not isinstance(style.get(key), bool):
            raise ValidationError({f"{element_path}.style.{key}": "Must be a boolean."})
    for key in STYLE_INT_KEYS:
        if key in style:
            _coerce_non_negative_int(
                style.get(key),
                field_name=f"{element_path}.style.{key}",
            )
    for key in STYLE_PERCENT_KEYS:
        if key in style:
            value = _to_decimal(
                style.get(key),
                field_name=f"{element_path}.style.{key}",
                allow_zero=True,
                minimum=Decimal("0.00"),
            )
            if value > Decimal("100.00"):
                raise ValidationError(
                    {f"{element_path}.style.{key}": "Must be <= 100."}
                )
    for key, allowed_values in STYLE_ENUMS.items():
        if key in style:
            normalized_value = str(style.get(key)).strip().lower()
            if normalized_value not in allowed_values:
                raise ValidationError(
                    {
                        f"{element_path}.style.{key}": (
                            "Invalid value. Allowed: "
                            + ", ".join(sorted(allowed_values))
                        )
                    }
                )


def _validate_merge_fields(element: dict[str, Any], *, element_path: str) -> None:
    merge_field = element.get("merge_field")
    if merge_field:
        merge_key = str(merge_field).strip()
        if merge_key not in ALLOWED_MERGE_FIELDS:
            raise ValidationError(
                {f"{element_path}.merge_field": f"Unknown merge field '{merge_key}'."}
            )

    text_value = element.get("text")
    if isinstance(text_value, str):
        for match in MERGE_FIELD_PATTERN.findall(text_value):
            if match not in ALLOWED_MERGE_FIELDS:
                raise ValidationError(
                    {f"{element_path}.text": f"Unknown merge field '{match}'."}
                )

    source_value = element.get("source")
    if isinstance(source_value, str):
        for match in MERGE_FIELD_PATTERN.findall(source_value):
            if match not in ALLOWED_MERGE_FIELDS:
                raise ValidationError(
                    {f"{element_path}.source": f"Unknown merge field '{match}'."}
                )


def _normalize_element(raw_element: dict[str, Any], *, index: int) -> dict[str, Any]:
    element: dict[str, Any] = dict(raw_element)
    if "type" not in element and "kind" in element:
        element["type"] = element.get("kind")
    if "x_mm" not in element and "x" in element:
        element["x_mm"] = element.get("x")
    if "y_mm" not in element and "y" in element:
        element["y_mm"] = element.get("y")
    if "width_mm" not in element and "width" in element:
        element["width_mm"] = element.get("width")
    if "height_mm" not in element and "height" in element:
        element["height_mm"] = element.get("height")
    if "text" not in element and "content" in element:
        element["text"] = element.get("content")
    if "style" not in element and "styles" in element:
        element["style"] = element.get("styles")
    if element.get("style") is None:
        element["style"] = {}
    if element.get("metadata") is None:
        element["metadata"] = {}

    normalized_element: dict[str, Any] = {
        "id": str(element.get("id") or f"element-{index + 1}"),
        "type": str(element.get("type") or "").strip().lower(),
        "x_mm": element.get("x_mm"),
        "y_mm": element.get("y_mm"),
        "width_mm": element.get("width_mm"),
        "height_mm": element.get("height_mm"),
    }
    optional_keys = {
        "text",
        "merge_field",
        "rotation_deg",
        "opacity",
        "z_index",
        "style",
        "metadata",
        "source",
        "locked",
        "visible",
        "anchor",
        "fit_mode",
    }
    for key in optional_keys:
        if key in element:
            normalized_element[key] = element.get(key)
    return normalized_element


def normalize_design_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError({"design_payload": "Design payload must be a JSON object."})

    schema_version = _coerce_schema_version(payload.get("schema_version"))
    allowed_top_level_keys = V2_TOP_LEVEL_KEYS if schema_version == SCHEMA_VERSION_V2 else BASE_TOP_LEVEL_KEYS
    unknown_top_level_keys = set(payload.keys()) - allowed_top_level_keys
    if unknown_top_level_keys:
        raise ValidationError(
            {
                "design_payload": (
                    "Unknown top-level key(s): "
                    + ", ".join(sorted(unknown_top_level_keys))
                )
            }
        )

    elements = payload.get("elements")
    if elements is None and schema_version == SCHEMA_VERSION_V2:
        elements = payload.get("layers")
    if elements is None:
        elements = []
    if not isinstance(elements, list):
        raise ValidationError({"design_payload.elements": "Must be a list."})

    metadata = payload.get("metadata")
    if metadata is None or metadata == "":
        metadata = {}
    if not isinstance(metadata, dict):
        raise ValidationError({"design_payload.metadata": "Must be an object."})

    background = payload.get("background")
    if background is None:
        background = {}
    if not isinstance(background, (dict, str)):
        raise ValidationError({"design_payload.background": "Must be an object or string."})

    normalized_payload: dict[str, Any] = {
        "schema_version": schema_version,
        "elements": [],
        "metadata": metadata,
        "background": background,
    }
    canvas = payload.get("canvas")
    if canvas is not None:
        if not isinstance(canvas, dict):
            raise ValidationError({"design_payload.canvas": "Must be an object."})
        normalized_payload["canvas"] = canvas

    for index, raw_element in enumerate(elements):
        element_path = f"design_payload.elements[{index}]"
        if not isinstance(raw_element, dict):
            raise ValidationError({element_path: "Each element must be an object."})
        normalized_payload["elements"].append(_normalize_element(raw_element, index=index))
    return normalized_payload


def validate_design_payload_schema(
    payload: Any,
    *,
    canvas_width_mm: Decimal,
    canvas_height_mm: Decimal,
) -> None:
    normalized_payload = normalize_design_payload(payload)
    elements = normalized_payload["elements"]

    canvas_width = _to_decimal(
        canvas_width_mm, field_name="canvas_width_mm", allow_zero=False
    )
    canvas_height = _to_decimal(
        canvas_height_mm, field_name="canvas_height_mm", allow_zero=False
    )

    required_keys = {"id", "type", "x_mm", "y_mm", "width_mm", "height_mm"}
    allowed_element_keys = {
        "id",
        "type",
        "x_mm",
        "y_mm",
        "width_mm",
        "height_mm",
        "text",
        "merge_field",
        "rotation_deg",
        "opacity",
        "z_index",
        "style",
        "metadata",
        "source",
        "locked",
        "visible",
        "anchor",
        "fit_mode",
    }
    for index, element in enumerate(elements):
        element_path = f"design_payload.elements[{index}]"
        if not isinstance(element, dict):
            raise ValidationError({element_path: "Each element must be an object."})

        missing_keys = required_keys - set(element.keys())
        if missing_keys:
            raise ValidationError(
                {
                    element_path: (
                        "Missing key(s): " + ", ".join(sorted(missing_keys))
                    )
                }
            )

        unknown_element_keys = set(element.keys()) - allowed_element_keys
        if unknown_element_keys:
            raise ValidationError(
                {
                    element_path: (
                        "Unknown key(s): " + ", ".join(sorted(unknown_element_keys))
                    )
                }
            )

        element_type = str(element.get("type", "")).strip().lower()
        if element_type not in ALLOWED_ELEMENT_TYPES:
            raise ValidationError(
                {f"{element_path}.type": f"Unsupported element type '{element_type}'."}
            )

        x_mm = _to_decimal(
            element.get("x_mm"),
            field_name=f"{element_path}.x_mm",
            allow_zero=True,
            minimum=Decimal("0.00"),
        )
        y_mm = _to_decimal(
            element.get("y_mm"),
            field_name=f"{element_path}.y_mm",
            allow_zero=True,
            minimum=Decimal("0.00"),
        )
        width_mm = _to_decimal(
            element.get("width_mm"),
            field_name=f"{element_path}.width_mm",
            allow_zero=False,
        )
        height_mm = _to_decimal(
            element.get("height_mm"),
            field_name=f"{element_path}.height_mm",
            allow_zero=False,
        )

        if x_mm + width_mm > canvas_width:
            raise ValidationError(
                {
                    f"{element_path}.width_mm": (
                        "Element exceeds canvas width bounds."
                    )
                }
            )
        if y_mm + height_mm > canvas_height:
            raise ValidationError(
                {
                    f"{element_path}.height_mm": (
                        "Element exceeds canvas height bounds."
                    )
                }
            )

        _validate_merge_fields(element, element_path=element_path)
        _validate_style_scaffolding(
            element.get("style", {}),
            element_type=element_type,
            element_path=element_path,
        )
