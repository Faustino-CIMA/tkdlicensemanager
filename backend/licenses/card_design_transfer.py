from __future__ import annotations

import base64
import copy
import json
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils.text import slugify
from rest_framework import serializers

from .card_registry import normalize_design_payload, validate_design_payload_schema
from .card_serializers import CardFontAssetSerializer, CardImageAssetSerializer
from .models import (
    CardFormatPreset,
    CardFontAsset,
    CardImageAsset,
    CardTemplate,
    CardTemplateVersion,
    PaperProfile,
)

EXPORT_FORMAT = "ltkdf.card-template"
EXPORT_SCHEMA_VERSION = 1
ASSET_ID_KEYS = ("font_asset_id", "image_asset_id")


class CardDesignTransferError(ValueError):
    pass


def _walk_dicts(node: Any, visitor) -> None:
    if isinstance(node, dict):
        visitor(node)
        for value in node.values():
            _walk_dicts(value, visitor)
    elif isinstance(node, list):
        for item in node:
            _walk_dicts(item, visitor)


def collect_asset_ids(design_payload: dict[str, Any]) -> tuple[set[int], set[int]]:
    font_ids: set[int] = set()
    image_ids: set[int] = set()

    def visitor(item: dict[str, Any]) -> None:
        font_raw = item.get("font_asset_id")
        image_raw = item.get("image_asset_id")
        if font_raw is not None:
            try:
                font_id = int(str(font_raw))
            except (TypeError, ValueError):
                font_id = 0
            if font_id > 0:
                font_ids.add(font_id)
        if image_raw is not None:
            try:
                image_id = int(str(image_raw))
            except (TypeError, ValueError):
                image_id = 0
            if image_id > 0:
                image_ids.add(image_id)

    _walk_dicts(design_payload, visitor)
    return font_ids, image_ids


def remap_asset_ids(
    design_payload: dict[str, Any],
    *,
    font_map: dict[int, int],
    image_map: dict[int, int],
    drop_unmapped: bool = False,
) -> dict[str, Any]:
    remapped = copy.deepcopy(design_payload)

    def visitor(item: dict[str, Any]) -> None:
        for key, mapping in (
            ("font_asset_id", font_map),
            ("image_asset_id", image_map),
        ):
            if key not in item or item[key] is None:
                continue
            try:
                original_id = int(str(item[key]))
            except (TypeError, ValueError):
                continue
            if original_id in mapping:
                item[key] = mapping[original_id]
            elif drop_unmapped:
                item.pop(key, None)

    _walk_dicts(remapped, visitor)
    return remapped


def _decimal_string(value: Any) -> str:
    return f"{Decimal(str(value)):.2f}"


def _unique_code(model, base: str) -> str:
    slug = slugify(base)[:40] or "imported"
    candidate = slug
    index = 2
    while model.objects.filter(code=candidate).exists():
        suffix = f"-{index}"
        candidate = f"{slug[: 50 - len(suffix)]}{suffix}"
        index += 1
    return candidate


def _encode_file_asset(file_field, *, fallback_mime: str) -> dict[str, str] | None:
    if not file_field or not getattr(file_field, "name", ""):
        return None
    try:
        with file_field.open("rb") as stream:
            raw_bytes = stream.read()
    except Exception:
        return None
    if not raw_bytes:
        return None
    filename = Path(str(file_field.name)).name or "asset.bin"
    return {
        "filename": filename,
        "content_type": fallback_mime,
        "data_base64": base64.b64encode(raw_bytes).decode("ascii"),
    }


def _decode_asset_bytes(entry: dict[str, Any]) -> tuple[str, bytes, str]:
    filename = str(entry.get("filename") or "asset.bin")
    content_type = str(entry.get("content_type") or "application/octet-stream")
    encoded = str(entry.get("data_base64") or "")
    if not encoded:
        raise CardDesignTransferError(f"Asset '{filename}' is missing data.")
    try:
        raw_bytes = base64.b64decode(encoded, validate=False)
    except Exception as exc:
        raise CardDesignTransferError(f"Asset '{filename}' is not valid base64.") from exc
    if not raw_bytes:
        raise CardDesignTransferError(f"Asset '{filename}' is empty.")
    return filename, raw_bytes, content_type


def build_export_bundle(
    *,
    template: CardTemplate,
    version: CardTemplateVersion,
) -> dict[str, Any]:
    design_payload = copy.deepcopy(version.design_payload or {"elements": []})
    font_ids, image_ids = collect_asset_ids(design_payload)

    font_assets_payload: list[dict[str, Any]] = []
    keep_font_ids: dict[int, int] = {}
    for font_asset in CardFontAsset.objects.filter(id__in=font_ids).order_by("id"):
        encoded = _encode_file_asset(font_asset.file, fallback_mime="font/ttf")
        if encoded is None:
            continue
        original_id = int(font_asset.id)
        keep_font_ids[original_id] = original_id
        font_assets_payload.append(
            {
                "original_id": original_id,
                "name": str(font_asset.name),
                **encoded,
            }
        )

    image_assets_payload: list[dict[str, Any]] = []
    keep_image_ids: dict[int, int] = {}
    for image_asset in CardImageAsset.objects.filter(id__in=image_ids).order_by("id"):
        encoded = _encode_file_asset(image_asset.image, fallback_mime="image/png")
        if encoded is None:
            continue
        original_id = int(image_asset.id)
        keep_image_ids[original_id] = original_id
        image_assets_payload.append(
            {
                "original_id": original_id,
                "name": str(image_asset.name),
                **encoded,
            }
        )

    design_payload = remap_asset_ids(
        design_payload,
        font_map=keep_font_ids,
        image_map=keep_image_ids,
        drop_unmapped=True,
    )

    card_format = version.card_format
    paper_profile = version.paper_profile
    return {
        "format": EXPORT_FORMAT,
        "schema_version": EXPORT_SCHEMA_VERSION,
        "exported_at": datetime.now(dt_timezone.utc).isoformat(),
        "template": {
            "name": str(template.name),
            "description": str(template.description or ""),
        },
        "version": {
            "label": str(version.label or ""),
            "notes": str(version.notes or ""),
            "design_payload": design_payload,
        },
        "card_format": {
            "code": str(card_format.code),
            "name": str(card_format.name),
            "description": str(card_format.description or ""),
            "width_mm": _decimal_string(card_format.width_mm),
            "height_mm": _decimal_string(card_format.height_mm),
            "is_custom": bool(card_format.is_custom),
        },
        "paper_profile": None
        if paper_profile is None
        else {
            "code": str(paper_profile.code),
            "name": str(paper_profile.name),
            "description": str(paper_profile.description or ""),
            "sheet_width_mm": _decimal_string(paper_profile.sheet_width_mm),
            "sheet_height_mm": _decimal_string(paper_profile.sheet_height_mm),
            "card_width_mm": _decimal_string(paper_profile.card_width_mm),
            "card_height_mm": _decimal_string(paper_profile.card_height_mm),
            "card_corner_radius_mm": (
                None
                if paper_profile.card_corner_radius_mm is None
                else _decimal_string(paper_profile.card_corner_radius_mm)
            ),
            "margin_top_mm": _decimal_string(paper_profile.margin_top_mm),
            "margin_bottom_mm": _decimal_string(paper_profile.margin_bottom_mm),
            "margin_left_mm": _decimal_string(paper_profile.margin_left_mm),
            "margin_right_mm": _decimal_string(paper_profile.margin_right_mm),
            "horizontal_gap_mm": _decimal_string(paper_profile.horizontal_gap_mm),
            "vertical_gap_mm": _decimal_string(paper_profile.vertical_gap_mm),
            "columns": int(paper_profile.columns),
            "rows": int(paper_profile.rows),
            "slot_count": int(paper_profile.slot_count),
        },
        "font_assets": font_assets_payload,
        "image_assets": image_assets_payload,
    }


def _resolve_card_format(spec: dict[str, Any]) -> CardFormatPreset:
    code = str(spec.get("code") or "").strip()
    if code:
        existing = CardFormatPreset.objects.filter(code=code).first()
        if existing is not None:
            return existing
    width = spec.get("width_mm")
    height = spec.get("height_mm")
    if width is not None and height is not None:
        existing = CardFormatPreset.objects.filter(
            width_mm=Decimal(str(width)),
            height_mm=Decimal(str(height)),
            is_active=True,
        ).first()
        if existing is not None:
            return existing
    created = CardFormatPreset.objects.create(
        code=_unique_code(CardFormatPreset, code or spec.get("name") or "imported-format"),
        name=str(spec.get("name") or "Imported format")[:100],
        description=str(spec.get("description") or ""),
        width_mm=Decimal(str(width or "85.60")),
        height_mm=Decimal(str(height or "53.98")),
        is_custom=True,
        is_active=True,
    )
    return created


def _resolve_paper_profile(
    spec: dict[str, Any] | None,
    *,
    card_format: CardFormatPreset,
) -> PaperProfile | None:
    if not spec:
        return None
    code = str(spec.get("code") or "").strip()
    if code:
        existing = PaperProfile.objects.filter(code=code).first()
        if existing is not None and existing.card_format_id == card_format.id:
            return existing
    columns = int(spec.get("columns") or 1)
    rows = int(spec.get("rows") or 1)
    slot_count = int(spec.get("slot_count") or columns * rows)
    if slot_count != columns * rows:
        slot_count = columns * rows
    corner = spec.get("card_corner_radius_mm")
    created = PaperProfile(
        code=_unique_code(PaperProfile, code or spec.get("name") or "imported-paper"),
        name=str(spec.get("name") or "Imported paper")[:120],
        description=str(spec.get("description") or ""),
        card_format=card_format,
        sheet_width_mm=Decimal(str(spec.get("sheet_width_mm") or "210.00")),
        sheet_height_mm=Decimal(str(spec.get("sheet_height_mm") or "297.00")),
        card_width_mm=Decimal(str(spec.get("card_width_mm") or card_format.width_mm)),
        card_height_mm=Decimal(str(spec.get("card_height_mm") or card_format.height_mm)),
        card_corner_radius_mm=None if corner in (None, "") else Decimal(str(corner)),
        margin_top_mm=Decimal(str(spec.get("margin_top_mm") or "0.00")),
        margin_bottom_mm=Decimal(str(spec.get("margin_bottom_mm") or "0.00")),
        margin_left_mm=Decimal(str(spec.get("margin_left_mm") or "0.00")),
        margin_right_mm=Decimal(str(spec.get("margin_right_mm") or "0.00")),
        horizontal_gap_mm=Decimal(str(spec.get("horizontal_gap_mm") or "0.00")),
        vertical_gap_mm=Decimal(str(spec.get("vertical_gap_mm") or "0.00")),
        columns=columns,
        rows=rows,
        slot_count=slot_count,
        is_preset=False,
        is_active=True,
    )
    try:
        created.full_clean()
    except DjangoValidationError as exc:
        raise CardDesignTransferError("Imported paper profile is invalid.") from exc
    created.save()
    return created


def _import_font_asset(entry: dict[str, Any], *, user) -> CardFontAsset:
    filename, raw_bytes, content_type = _decode_asset_bytes(entry)
    uploaded = SimpleUploadedFile(filename, raw_bytes, content_type=content_type)
    serializer = CardFontAssetSerializer(
        data={
            "name": str(entry.get("name") or Path(filename).stem)[:120],
            "file": uploaded,
            "is_active": True,
        }
    )
    serializer.is_valid(raise_exception=True)
    return serializer.save(created_by=user if user and user.is_authenticated else None)


def _import_image_asset(entry: dict[str, Any], *, user) -> CardImageAsset:
    filename, raw_bytes, content_type = _decode_asset_bytes(entry)
    uploaded = SimpleUploadedFile(filename, raw_bytes, content_type=content_type)
    serializer = CardImageAssetSerializer(
        data={
            "name": str(entry.get("name") or Path(filename).stem)[:120],
            "image": uploaded,
            "is_active": True,
        }
    )
    serializer.is_valid(raise_exception=True)
    return serializer.save(created_by=user if user and user.is_authenticated else None)


def import_bundle(payload: dict[str, Any], *, user, name_override: str | None = None) -> CardTemplate:
    if not isinstance(payload, dict):
        raise CardDesignTransferError("Import file must be a JSON object.")
    if payload.get("format") != EXPORT_FORMAT:
        raise CardDesignTransferError("This file is not a license card template export.")
    try:
        schema_version = int(payload.get("schema_version") or 0)
    except (TypeError, ValueError) as exc:
        raise CardDesignTransferError("Invalid export schema version.") from exc
    if schema_version != EXPORT_SCHEMA_VERSION:
        raise CardDesignTransferError(
            f"Unsupported export schema version {schema_version}."
        )

    template_spec = payload.get("template") or {}
    version_spec = payload.get("version") or {}
    if not isinstance(template_spec, dict) or not isinstance(version_spec, dict):
        raise CardDesignTransferError("Export is missing template or version data.")

    name = (name_override or str(template_spec.get("name") or "")).strip()
    if not name:
        raise CardDesignTransferError("Template name is required.")
    description = str(template_spec.get("description") or "")
    design_payload = version_spec.get("design_payload")
    if not isinstance(design_payload, dict):
        raise CardDesignTransferError("Export is missing a design payload.")

    card_format_spec = payload.get("card_format") or {}
    if not isinstance(card_format_spec, dict) or not card_format_spec:
        raise CardDesignTransferError("Export is missing card format data.")

    font_map: dict[int, int] = {}
    for entry in payload.get("font_assets") or []:
        if not isinstance(entry, dict):
            continue
        original_id = int(entry.get("original_id") or 0)
        created = _import_font_asset(entry, user=user)
        if original_id > 0:
            font_map[original_id] = int(created.id)

    image_map: dict[int, int] = {}
    for entry in payload.get("image_assets") or []:
        if not isinstance(entry, dict):
            continue
        original_id = int(entry.get("original_id") or 0)
        created = _import_image_asset(entry, user=user)
        if original_id > 0:
            image_map[original_id] = int(created.id)

    remapped_payload = remap_asset_ids(
        design_payload,
        font_map=font_map,
        image_map=image_map,
        drop_unmapped=True,
    )

    card_format = _resolve_card_format(card_format_spec)
    paper_spec = payload.get("paper_profile")
    paper_profile = _resolve_paper_profile(
        paper_spec if isinstance(paper_spec, dict) else None,
        card_format=card_format,
    )

    try:
        normalized_payload = normalize_design_payload(remapped_payload)
        validate_design_payload_schema(
            normalized_payload,
            canvas_width_mm=Decimal(str(card_format.width_mm)),
            canvas_height_mm=Decimal(str(card_format.height_mm)),
        )
    except DjangoValidationError as exc:
        if hasattr(exc, "message_dict"):
            raise serializers.ValidationError(exc.message_dict) from exc
        raise serializers.ValidationError(exc.messages) from exc

    template = CardTemplate.objects.create(
        name=name[:120],
        description=description,
        is_default=False,
        is_active=True,
        created_by=user if user and user.is_authenticated else None,
        updated_by=user if user and user.is_authenticated else None,
    )
    CardTemplateVersion.objects.create(
        template=template,
        version_number=1,
        label=str(version_spec.get("label") or "")[:120],
        status=CardTemplateVersion.Status.DRAFT,
        card_format=card_format,
        paper_profile=paper_profile,
        design_payload=normalized_payload,
        notes=str(version_spec.get("notes") or ""),
        created_by=user if user and user.is_authenticated else None,
    )
    return template


def dump_export_json(bundle: dict[str, Any]) -> bytes:
    return json.dumps(bundle, indent=2, ensure_ascii=False).encode("utf-8")
