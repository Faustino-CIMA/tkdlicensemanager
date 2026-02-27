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
        "key": "club.name",
        "label": "Club name",
        "description": "Name of the member's club.",
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
        "key": "qr.validation_url",
        "label": "Validation QR URL",
        "description": "Backend URL for scanning and validating the card.",
    },
]

ALLOWED_MERGE_FIELDS = {field["key"] for field in MERGE_FIELD_REGISTRY}
MERGE_FIELD_PATTERN = re.compile(r"\{\{\s*([^{}\s]+)\s*\}\}")
ALLOWED_ELEMENT_TYPES = {"text", "image", "shape", "qr", "barcode"}


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


def validate_design_payload_schema(
    payload: Any,
    *,
    canvas_width_mm: Decimal,
    canvas_height_mm: Decimal,
) -> None:
    if not isinstance(payload, dict):
        raise ValidationError({"design_payload": "Design payload must be a JSON object."})

    allowed_top_level_keys = {"elements", "metadata", "background"}
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
    if not isinstance(elements, list):
        raise ValidationError({"design_payload.elements": "Must be a list."})

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
