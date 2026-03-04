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
CARD_SIDE_FRONT = "front"
CARD_SIDE_BACK = "back"
ALLOWED_CARD_SIDES = {CARD_SIDE_FRONT, CARD_SIDE_BACK}

BASE_TOP_LEVEL_KEYS = {"schema_version", "elements", "metadata", "background", "sides"}
V2_TOP_LEVEL_KEYS = BASE_TOP_LEVEL_KEYS | {
    "layers",
    "canvas",
    "assets",
    "variables",
    "editor",
    "guides",
}
SIDE_LEVEL_KEYS = {
    "elements",
    "layers",
    "background",
    "metadata",
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
    "transform_origin",
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
    "italic",
    "shadow_color",
    "shadow_offset_x_mm",
    "shadow_offset_y_mm",
    "shadow_blur_mm",
    "stroke_color",
    "stroke_width_mm",
}
ALLOWED_IMAGE_STYLE_KEYS = {
    "object_fit",
    "image_asset_id",
    "clip_radius_mm",
    "grayscale",
    "brightness_pct",
    "contrast_pct",
    "border_color",
    "border_width_mm",
    "radius_top_left_mm",
    "radius_top_right_mm",
    "radius_bottom_right_mm",
    "radius_bottom_left_mm",
    "object_position_x_pct",
    "object_position_y_pct",
}
ALLOWED_SHAPE_STYLE_KEYS = {
    "fill_color",
    "stroke_color",
    "stroke_width_mm",
    "shape_kind",
    "radius_top_left_mm",
    "radius_top_right_mm",
    "radius_bottom_right_mm",
    "radius_bottom_left_mm",
    "shape_points",
    "polygon_sides",
    "inner_radius_pct",
    "arrow_head_pct",
    "arrow_shaft_pct",
    "fill_gradient",
    "fill_gradient_start",
    "fill_gradient_end",
    "fill_gradient_angle_deg",
    "border_style",
}
ALLOWED_QR_STYLE_KEYS = {
    "foreground_color",
    "background_color",
    "quiet_zone_modules",
    "error_correction_level",
    "logo_image_asset_id",
    "data_mode",
    "custom_data",
    "merge_fields",
    "separator",
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
    "shadow_offset_x_mm",
    "shadow_offset_y_mm",
    "shadow_blur_mm",
    "radius_top_left_mm",
    "radius_top_right_mm",
    "radius_bottom_right_mm",
    "radius_bottom_left_mm",
}
STYLE_BOOL_KEYS = {
    "visible",
    "locked",
    "auto_fit",
    "grayscale",
    "show_value",
    "italic",
}
STYLE_INT_KEYS = {
    "max_lines",
    "quiet_zone_modules",
    "font_asset_id",
    "image_asset_id",
    "logo_image_asset_id",
    "polygon_sides",
}
STYLE_PERCENT_KEYS = {
    "brightness_pct",
    "contrast_pct",
    "inner_radius_pct",
    "arrow_head_pct",
    "arrow_shaft_pct",
    "object_position_x_pct",
    "object_position_y_pct",
}
STYLE_ENUMS: dict[str, set[str]] = {
    "text_align": {"left", "center", "right", "justify"},
    "text_transform": {"none", "uppercase", "lowercase", "capitalize"},
    "text_decoration": {"none", "underline", "line-through"},
    "vertical_align": {"top", "middle", "bottom"},
    "object_fit": {"contain", "cover", "fill", "scale-down", "none"},
    "error_correction_level": {"l", "m", "q", "h"},
    "shape_kind": {"rectangle", "circle", "ellipse", "line", "star", "arrow", "polygon"},
    "border_style": {"solid", "dashed", "dotted"},
    "data_mode": {"single_merge", "multi_merge", "custom"},
    "transform_origin": {
        "center center",
        "top left",
        "top center",
        "top right",
        "center left",
        "center right",
        "bottom left",
        "bottom center",
        "bottom right",
    },
}

DEFAULT_SHAPE_GRADIENT_START_COLOR = "#ef4444"
DEFAULT_SHAPE_GRADIENT_END_COLOR = "#3b82f6"
DEFAULT_SHAPE_GRADIENT_ANGLE_DEG = Decimal("90.00")


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


def _normalize_decimal_string(
    value: Any,
    *,
    fallback: Decimal,
    quant: str = "0.01",
) -> str:
    try:
        normalized_value = Decimal(str(value)).quantize(Decimal(quant))
    except (InvalidOperation, TypeError, ValueError):
        normalized_value = fallback.quantize(Decimal(quant))
    return f"{normalized_value}"


def _normalize_shape_gradient_style(style: dict[str, Any]) -> dict[str, Any]:
    normalized_style = dict(style)
    fill_gradient = normalized_style.get("fill_gradient")
    legacy_start = str(normalized_style.get("fill_gradient_start") or "").strip()
    legacy_end = str(normalized_style.get("fill_gradient_end") or "").strip()
    legacy_angle_raw = normalized_style.get("fill_gradient_angle_deg")

    if isinstance(fill_gradient, dict):
        gradient_payload = dict(fill_gradient)
        gradient_start = str(
            gradient_payload.get("start_color")
            or legacy_start
            or DEFAULT_SHAPE_GRADIENT_START_COLOR
        ).strip() or DEFAULT_SHAPE_GRADIENT_START_COLOR
        gradient_end = str(
            gradient_payload.get("end_color")
            or legacy_end
            or DEFAULT_SHAPE_GRADIENT_END_COLOR
        ).strip() or DEFAULT_SHAPE_GRADIENT_END_COLOR
        gradient_angle = _normalize_decimal_string(
            gradient_payload.get("angle_deg", legacy_angle_raw),
            fallback=DEFAULT_SHAPE_GRADIENT_ANGLE_DEG,
        )
        gradient_payload["start_color"] = gradient_start
        gradient_payload["end_color"] = gradient_end
        gradient_payload["angle_deg"] = gradient_angle
        normalized_style["fill_gradient"] = gradient_payload
        normalized_style["fill_gradient_start"] = gradient_start
        normalized_style["fill_gradient_end"] = gradient_end
        normalized_style["fill_gradient_angle_deg"] = gradient_angle
        return normalized_style

    if isinstance(fill_gradient, bool):
        if fill_gradient:
            gradient_start = legacy_start or DEFAULT_SHAPE_GRADIENT_START_COLOR
            gradient_end = legacy_end or DEFAULT_SHAPE_GRADIENT_END_COLOR
            gradient_angle = _normalize_decimal_string(
                legacy_angle_raw,
                fallback=DEFAULT_SHAPE_GRADIENT_ANGLE_DEG,
            )
            normalized_style["fill_gradient"] = {
                "start_color": gradient_start,
                "end_color": gradient_end,
                "angle_deg": gradient_angle,
            }
            normalized_style["fill_gradient_start"] = gradient_start
            normalized_style["fill_gradient_end"] = gradient_end
            normalized_style["fill_gradient_angle_deg"] = gradient_angle
        else:
            normalized_style["fill_gradient"] = False
        return normalized_style

    return normalized_style


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
    if "shape_points" in style:
        points = style.get("shape_points")
        if not isinstance(points, list) or not points:
            raise ValidationError(
                {f"{element_path}.style.shape_points": "Must be a non-empty list of points."}
            )
        for point_index, point in enumerate(points):
            point_path = f"{element_path}.style.shape_points[{point_index}]"
            if not isinstance(point, dict):
                raise ValidationError({point_path: "Each point must be an object."})
            if "x_pct" not in point or "y_pct" not in point:
                raise ValidationError({point_path: "Each point must include x_pct and y_pct."})
            x_pct = _to_decimal(
                point.get("x_pct"),
                field_name=f"{point_path}.x_pct",
                allow_zero=True,
                minimum=Decimal("0.00"),
            )
            y_pct = _to_decimal(
                point.get("y_pct"),
                field_name=f"{point_path}.y_pct",
                allow_zero=True,
                minimum=Decimal("0.00"),
            )
            if x_pct > Decimal("100.00") or y_pct > Decimal("100.00"):
                raise ValidationError({point_path: "x_pct and y_pct must be <= 100."})
    if "fill_gradient" in style:
        fill_gradient = style.get("fill_gradient")
        if isinstance(fill_gradient, bool):
            if fill_gradient:
                fill_gradient = {
                    "start_color": str(
                        style.get("fill_gradient_start") or DEFAULT_SHAPE_GRADIENT_START_COLOR
                    ).strip()
                    or DEFAULT_SHAPE_GRADIENT_START_COLOR,
                    "end_color": str(
                        style.get("fill_gradient_end") or DEFAULT_SHAPE_GRADIENT_END_COLOR
                    ).strip()
                    or DEFAULT_SHAPE_GRADIENT_END_COLOR,
                    "angle_deg": style.get(
                        "fill_gradient_angle_deg",
                        f"{DEFAULT_SHAPE_GRADIENT_ANGLE_DEG}",
                    ),
                }
            else:
                fill_gradient = None
        elif not isinstance(fill_gradient, dict):
            raise ValidationError(
                {
                    f"{element_path}.style.fill_gradient": (
                        "Must be an object with gradient configuration or a boolean."
                    )
                }
            )
        if isinstance(fill_gradient, dict):
            for required_gradient_key in {"start_color", "end_color"}:
                if required_gradient_key not in fill_gradient:
                    raise ValidationError(
                        {
                            f"{element_path}.style.fill_gradient": (
                                f"Missing '{required_gradient_key}'."
                            )
                        }
                    )
            if "angle_deg" in fill_gradient:
                _to_decimal(
                    fill_gradient.get("angle_deg"),
                    field_name=f"{element_path}.style.fill_gradient.angle_deg",
                    allow_zero=True,
                    minimum=Decimal("-360.00"),
                )
    if "merge_fields" in style:
        merge_fields = style.get("merge_fields")
        if not isinstance(merge_fields, list) or not merge_fields:
            raise ValidationError(
                {f"{element_path}.style.merge_fields": "Must be a non-empty list."}
            )
        for merge_index, merge_key in enumerate(merge_fields):
            normalized_merge_key = str(merge_key).strip()
            if normalized_merge_key not in ALLOWED_MERGE_FIELDS:
                raise ValidationError(
                    {
                        f"{element_path}.style.merge_fields[{merge_index}]": (
                            f"Unknown merge field '{normalized_merge_key}'."
                        )
                    }
                )
    if "fill_gradient_angle_deg" in style:
        _to_decimal(
            style.get("fill_gradient_angle_deg"),
            field_name=f"{element_path}.style.fill_gradient_angle_deg",
            allow_zero=True,
            minimum=Decimal("-360.00"),
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
    merge_fields = element.get("merge_fields")
    if merge_fields is not None:
        if not isinstance(merge_fields, list) or not merge_fields:
            raise ValidationError({f"{element_path}.merge_fields": "Must be a non-empty list."})
        for merge_index, merge_key in enumerate(merge_fields):
            normalized_merge_key = str(merge_key).strip()
            if normalized_merge_key not in ALLOWED_MERGE_FIELDS:
                raise ValidationError(
                    {
                        f"{element_path}.merge_fields[{merge_index}]": (
                            f"Unknown merge field '{normalized_merge_key}'."
                        )
                    }
                )
    qr_data = element.get("qr_data")
    if isinstance(qr_data, str):
        for match in MERGE_FIELD_PATTERN.findall(qr_data):
            if match not in ALLOWED_MERGE_FIELDS:
                raise ValidationError(
                    {f"{element_path}.qr_data": f"Unknown merge field '{match}'."}
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
    if "merge_fields" not in element and "mergeKeys" in element:
        element["merge_fields"] = element.get("mergeKeys")
    if "qr_data" not in element and "custom_data" in element:
        element["qr_data"] = element.get("custom_data")
    if "qr_data" not in element and "data" in element and str(element.get("type", "")).lower() == "qr":
        element["qr_data"] = element.get("data")
    normalized_type = str(element.get("type") or "").strip().lower()
    if element.get("style") is None:
        element["style"] = {}
    if normalized_type == "shape" and isinstance(element.get("style"), dict):
        element["style"] = _normalize_shape_gradient_style(element["style"])
    if element.get("metadata") is None:
        element["metadata"] = {}

    normalized_element: dict[str, Any] = {
        "id": str(element.get("id") or f"element-{index + 1}"),
        "type": normalized_type,
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
        "merge_fields",
        "qr_data",
        "qr_separator",
        "qr_mode",
    }
    for key in optional_keys:
        if key in element:
            normalized_element[key] = element.get(key)
    return normalized_element


def _normalize_elements_list(
    raw_elements: Any,
    *,
    element_path_prefix: str,
) -> list[dict[str, Any]]:
    if raw_elements is None:
        return []
    if not isinstance(raw_elements, list):
        raise ValidationError({element_path_prefix: "Must be a list."})
    normalized_elements: list[dict[str, Any]] = []
    for index, raw_element in enumerate(raw_elements):
        element_path = f"{element_path_prefix}[{index}]"
        if not isinstance(raw_element, dict):
            raise ValidationError({element_path: "Each element must be an object."})
        normalized_elements.append(_normalize_element(raw_element, index=index))
    return normalized_elements


def _normalize_side_payload(
    raw_side_payload: Any,
    *,
    side_name: str,
    schema_version: int,
    fallback_elements: list[dict[str, Any]] | None = None,
    fallback_background: Any = None,
) -> dict[str, Any]:
    side_path = f"design_payload.sides.{side_name}"
    if raw_side_payload is None:
        raw_side_payload = {}
    if not isinstance(raw_side_payload, dict):
        raise ValidationError({side_path: "Must be an object."})

    unknown_side_keys = set(raw_side_payload.keys()) - SIDE_LEVEL_KEYS
    if unknown_side_keys:
        raise ValidationError(
            {
                side_path: (
                    "Unknown key(s): " + ", ".join(sorted(unknown_side_keys))
                )
            }
        )

    side_elements_input = raw_side_payload.get("elements")
    if side_elements_input is None and schema_version == SCHEMA_VERSION_V2:
        side_elements_input = raw_side_payload.get("layers")
    if side_elements_input is None and fallback_elements is not None:
        side_elements = list(fallback_elements)
    else:
        side_elements = _normalize_elements_list(
            side_elements_input,
            element_path_prefix=f"{side_path}.elements",
        )

    side_background = raw_side_payload.get("background", fallback_background)
    if side_background is None:
        side_background = {}
    if not isinstance(side_background, (dict, str)):
        raise ValidationError({f"{side_path}.background": "Must be an object or string."})

    side_metadata = raw_side_payload.get("metadata")
    if side_metadata is None or side_metadata == "":
        side_metadata = {}
    if not isinstance(side_metadata, dict):
        raise ValidationError({f"{side_path}.metadata": "Must be an object."})

    normalized_side: dict[str, Any] = {
        "elements": side_elements,
        "background": side_background,
        "metadata": side_metadata,
    }
    side_canvas = raw_side_payload.get("canvas")
    if side_canvas is not None:
        if not isinstance(side_canvas, dict):
            raise ValidationError({f"{side_path}.canvas": "Must be an object."})
        normalized_side["canvas"] = side_canvas
    return normalized_side


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

    legacy_elements_input = payload.get("elements")
    if legacy_elements_input is None and schema_version == SCHEMA_VERSION_V2:
        legacy_elements_input = payload.get("layers")
    legacy_elements = _normalize_elements_list(
        legacy_elements_input,
        element_path_prefix="design_payload.elements",
    )

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
        "elements": legacy_elements,
        "metadata": metadata,
        "background": background,
    }
    canvas = payload.get("canvas")
    if canvas is not None:
        if not isinstance(canvas, dict):
            raise ValidationError({"design_payload.canvas": "Must be an object."})
        normalized_payload["canvas"] = canvas

    raw_sides = payload.get("sides")
    if raw_sides is None:
        raw_sides = {}
    if not isinstance(raw_sides, dict):
        raise ValidationError({"design_payload.sides": "Must be an object."})
    unknown_side_names = set(raw_sides.keys()) - ALLOWED_CARD_SIDES
    if unknown_side_names:
        raise ValidationError(
            {
                "design_payload.sides": (
                    "Unknown side key(s): " + ", ".join(sorted(unknown_side_names))
                )
            }
        )

    front_side = _normalize_side_payload(
        raw_sides.get(CARD_SIDE_FRONT),
        side_name=CARD_SIDE_FRONT,
        schema_version=schema_version,
        fallback_elements=(legacy_elements if CARD_SIDE_FRONT not in raw_sides else None),
        fallback_background=(background if CARD_SIDE_FRONT not in raw_sides else {}),
    )
    back_side = _normalize_side_payload(
        raw_sides.get(CARD_SIDE_BACK),
        side_name=CARD_SIDE_BACK,
        schema_version=schema_version,
        fallback_elements=[],
        fallback_background={},
    )
    normalized_payload["sides"] = {
        CARD_SIDE_FRONT: front_side,
        CARD_SIDE_BACK: back_side,
    }
    # Keep top-level keys for compatibility with existing payload consumers.
    normalized_payload["elements"] = list(front_side["elements"])
    normalized_payload["background"] = front_side["background"]
    return normalized_payload


def _validate_normalized_elements(
    elements: Any,
    *,
    element_path_prefix: str,
    canvas_width: Decimal,
    canvas_height: Decimal,
    required_keys: set[str],
    allowed_element_keys: set[str],
) -> None:
    if not isinstance(elements, list):
        raise ValidationError({element_path_prefix: "Must be a list."})
    for index, element in enumerate(elements):
        element_path = f"{element_path_prefix}[{index}]"
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
        "merge_fields",
        "qr_data",
        "qr_separator",
        "qr_mode",
    }
    _validate_normalized_elements(
        elements,
        element_path_prefix="design_payload.elements",
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        required_keys=required_keys,
        allowed_element_keys=allowed_element_keys,
    )

    sides = normalized_payload.get("sides") or {}
    if isinstance(sides, dict):
        back_side = sides.get(CARD_SIDE_BACK) or {}
        if isinstance(back_side, dict):
            _validate_normalized_elements(
                back_side.get("elements") or [],
                element_path_prefix=f"design_payload.sides.{CARD_SIDE_BACK}.elements",
                canvas_width=canvas_width,
                canvas_height=canvas_height,
                required_keys=required_keys,
                allowed_element_keys=allowed_element_keys,
            )
