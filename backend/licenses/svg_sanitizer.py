from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from bleach.sanitizer import Cleaner
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile

try:  # Bleach>=5
    from bleach.css_sanitizer import CSSSanitizer
except Exception:  # pragma: no cover - Bleach<5 compatibility path
    CSSSanitizer = None  # type: ignore[assignment]


SVG_CONTENT_TYPES = {"image/svg+xml", "image/svg"}
_DANGEROUS_TOKEN_PATTERN = re.compile(r"\b(?:javascript|vbscript|file)\s*:", re.IGNORECASE)
_EVENT_HANDLER_PATTERN = re.compile(r"\bon[a-z0-9_-]+\s*=", re.IGNORECASE)
_BLOCKED_TAG_PATTERN = re.compile(r"<\s*(?:script|foreignobject)\b", re.IGNORECASE)
_EXTERNAL_HREF_PATTERN = re.compile(
    r"\b(?:href|xlink:href)\s*=\s*([\"'])\s*(?!#)[^\"']+\1",
    re.IGNORECASE,
)
_EXTERNAL_URL_FUNCTION_PATTERN = re.compile(
    r"url\(\s*([\"'])?\s*(?!#)[^)]*",
    re.IGNORECASE,
)


class SvgSanitizationError(ValueError):
    """Raised when uploaded SVG payload cannot be sanitized safely."""


def _build_svg_cleaner() -> Cleaner:
    allowed_tags = tuple(getattr(settings, "CARD_SVG_ALLOWED_TAGS", ()))
    allowed_attributes = tuple(getattr(settings, "CARD_SVG_ALLOWED_ATTRIBUTES", ()))
    allowed_css = tuple(getattr(settings, "CARD_SVG_ALLOWED_CSS_PROPERTIES", ()))
    normalized_tags = sorted(
        {
            normalized
            for tag in allowed_tags
            for normalized in {str(tag).strip(), str(tag).strip().lower()}
            if normalized
        }
    )
    normalized_attributes = sorted(
        {
            normalized
            for attribute in allowed_attributes
            for normalized in {str(attribute).strip(), str(attribute).strip().lower()}
            if normalized
        }
    )
    cleaner_kwargs: dict[str, Any] = {
        "tags": normalized_tags,
        "attributes": {"*": normalized_attributes},
        "strip": True,
        "strip_comments": True,
    }
    if CSSSanitizer is not None:
        cleaner_kwargs["css_sanitizer"] = CSSSanitizer(
            allowed_css_properties=list(allowed_css)
        )
    else:
        cleaner_kwargs["styles"] = list(allowed_css)
    return Cleaner(**cleaner_kwargs)


def is_svg_upload(uploaded_file: Any) -> bool:
    filename = str(getattr(uploaded_file, "name", "")).strip().lower()
    content_type = str(getattr(uploaded_file, "content_type", "")).split(";")[0].strip().lower()
    return filename.endswith(".svg") or content_type in SVG_CONTENT_TYPES


def _decode_svg_text(payload: bytes) -> str:
    if not payload:
        raise SvgSanitizationError("SVG payload is empty.")
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            decoded = payload.decode(encoding)
            break
        except UnicodeDecodeError:
            decoded = ""
    if not decoded:
        raise SvgSanitizationError("SVG payload must be valid UTF-8 text.")
    if "\x00" in decoded:
        raise SvgSanitizationError("SVG payload contains invalid binary markers.")
    if "<svg" not in decoded.lower():
        raise SvgSanitizationError("SVG payload must include an <svg> root element.")
    return decoded


def _assert_svg_is_safe(svg_text: str) -> None:
    if _BLOCKED_TAG_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload contains blocked tags.")
    if _EVENT_HANDLER_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload contains blocked event handler attributes.")
    if _DANGEROUS_TOKEN_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload contains blocked protocol content.")
    if _EXTERNAL_HREF_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload cannot reference external href resources.")
    if _EXTERNAL_URL_FUNCTION_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload cannot reference external style resources.")


def sanitize_svg_bytes(payload: bytes) -> bytes:
    decoded_payload = _decode_svg_text(payload)
    cleaner = _build_svg_cleaner()
    sanitized_payload = cleaner.clean(decoded_payload).strip()
    if not sanitized_payload:
        raise SvgSanitizationError("SVG payload is empty after sanitization.")
    if "<svg" not in sanitized_payload.lower():
        raise SvgSanitizationError("SVG payload is missing an allowed <svg> root after sanitization.")
    _assert_svg_is_safe(sanitized_payload)
    return sanitized_payload.encode("utf-8")


def sanitize_svg_upload(uploaded_file: Any) -> SimpleUploadedFile:
    filename = str(getattr(uploaded_file, "name", "")).strip() or "asset.svg"
    suffix = Path(filename).suffix.lower()
    if suffix and suffix != ".svg":
        raise SvgSanitizationError("SVG sanitization requires an .svg file extension.")
    try:
        uploaded_file.seek(0)
    except Exception:
        pass
    try:
        raw_payload = uploaded_file.read()
    except Exception as exc:
        raise SvgSanitizationError("Could not read SVG payload.") from exc
    finally:
        try:
            uploaded_file.seek(0)
        except Exception:
            pass
    if isinstance(raw_payload, str):
        raw_payload = raw_payload.encode("utf-8")
    if not isinstance(raw_payload, (bytes, bytearray)):
        raise SvgSanitizationError("SVG payload must be binary content.")
    sanitized_payload = sanitize_svg_bytes(bytes(raw_payload))
    return SimpleUploadedFile(
        name=filename,
        content=sanitized_payload,
        content_type="image/svg+xml",
    )
