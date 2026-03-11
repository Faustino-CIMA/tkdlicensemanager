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
_DEFAULT_SVG_ALLOWED_TAGS = (
    "svg",
    "title",
    "desc",
    "metadata",
    "style",
    "g",
    "defs",
    "symbol",
    "use",
    "image",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "clipPath",
    "mask",
    "pattern",
    "marker",
    "switch",
    "linearGradient",
    "radialGradient",
    "stop",
    "filter",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
)
_DEFAULT_SVG_ALLOWED_ATTRIBUTES = (
    "xmlns",
    "xmlns:xlink",
    "xml:space",
    "version",
    "baseProfile",
    "viewBox",
    "preserveAspectRatio",
    "width",
    "height",
    "x",
    "y",
    "dx",
    "dy",
    "x1",
    "y1",
    "x2",
    "y2",
    "r",
    "rx",
    "ry",
    "cx",
    "cy",
    "d",
    "points",
    "pathLength",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "opacity",
    "color",
    "paint-order",
    "vector-effect",
    "shape-rendering",
    "text-rendering",
    "image-rendering",
    "clip-path",
    "clip-rule",
    "clipPathUnits",
    "mask",
    "mask-type",
    "maskUnits",
    "maskContentUnits",
    "patternUnits",
    "patternContentUnits",
    "patternTransform",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "filter",
    "filterUnits",
    "primitiveUnits",
    "href",
    "xlink:href",
    "transform",
    "transform-origin",
    "id",
    "class",
    "style",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-stretch",
    "text-anchor",
    "dominant-baseline",
    "letter-spacing",
    "word-spacing",
    "textLength",
    "lengthAdjust",
    "marker-start",
    "marker-mid",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "markerUnits",
    "refX",
    "refY",
    "orient",
    "offset",
    "in",
    "in2",
    "result",
    "type",
    "values",
    "mode",
    "operator",
    "k1",
    "k2",
    "k3",
    "k4",
    "radius",
    "stdDeviation",
    "baseFrequency",
    "numOctaves",
    "seed",
    "stitchTiles",
    "surfaceScale",
    "specularConstant",
    "specularExponent",
    "lighting-color",
    "flood-color",
    "flood-opacity",
    "amplitude",
    "exponent",
    "intercept",
    "slope",
    "tableValues",
    "edgeMode",
    "preserveAlpha",
    "kernelMatrix",
    "kernelUnitLength",
    "targetX",
    "targetY",
    "azimuth",
    "elevation",
    "pointsAtX",
    "pointsAtY",
    "pointsAtZ",
)
_DEFAULT_SVG_ALLOWED_CSS_PROPERTIES = (
    "display",
    "visibility",
    "overflow",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "fill-rule",
    "clip-rule",
    "clip-path",
    "mask",
    "filter",
    "stop-color",
    "stop-opacity",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-stretch",
    "text-anchor",
    "dominant-baseline",
    "letter-spacing",
    "word-spacing",
    "shape-rendering",
    "text-rendering",
    "image-rendering",
    "vector-effect",
    "paint-order",
    "enable-background",
    "transform",
    "transform-origin",
    "mix-blend-mode",
    "isolation",
)
_DEFAULT_SVG_ALLOWED_PROTOCOLS = ("http", "https", "data")
_DANGEROUS_TOKEN_PATTERN = re.compile(r"\b(?:javascript|vbscript|file)\s*:", re.IGNORECASE)
_EVENT_HANDLER_PATTERN = re.compile(r"\bon[a-z0-9_-]+\s*=", re.IGNORECASE)
_BLOCKED_TAG_PATTERN = re.compile(r"<\s*(?:script|foreignobject)\b", re.IGNORECASE)
_HREF_ATTRIBUTE_PATTERN = re.compile(
    r"\b(?:href|xlink:href)\s*=\s*(?:([\"'])(.*?)\1|([^\s>]+))",
    re.IGNORECASE | re.DOTALL,
)
_URL_FUNCTION_PATTERN = re.compile(
    r"url\(\s*([^)]+?)\s*\)",
    re.IGNORECASE | re.DOTALL,
)
_ALLOWED_DATA_IMAGE_MIME_TYPES = (
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/apng",
    "image/avif",
    "image/svg+xml",
    "image/svg",
)


class SvgSanitizationError(ValueError):
    """Raised when uploaded SVG payload cannot be sanitized safely."""


def _merge_allowlist(default_values: tuple[str, ...], configured_values: tuple[Any, ...]) -> tuple[str, ...]:
    merged = {
        normalized
        for source in (default_values, configured_values)
        for value in source
        for normalized in {str(value).strip()}
        if normalized
    }
    return tuple(sorted(merged))


def _build_svg_cleaner() -> Cleaner:
    allowed_tags = _merge_allowlist(
        _DEFAULT_SVG_ALLOWED_TAGS,
        tuple(getattr(settings, "CARD_SVG_ALLOWED_TAGS", ())),
    )
    allowed_attributes = _merge_allowlist(
        _DEFAULT_SVG_ALLOWED_ATTRIBUTES,
        tuple(getattr(settings, "CARD_SVG_ALLOWED_ATTRIBUTES", ())),
    )
    allowed_css = _merge_allowlist(
        _DEFAULT_SVG_ALLOWED_CSS_PROPERTIES,
        tuple(getattr(settings, "CARD_SVG_ALLOWED_CSS_PROPERTIES", ())),
    )
    allowed_protocols = _merge_allowlist(
        _DEFAULT_SVG_ALLOWED_PROTOCOLS,
        tuple(getattr(settings, "CARD_SVG_ALLOWED_PROTOCOLS", ())),
    )
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
    normalized_protocols = sorted(
        {
            normalized
            for protocol in allowed_protocols
            for normalized in {str(protocol).strip().lower()}
            if normalized
        }
    )
    cleaner_kwargs: dict[str, Any] = {
        "tags": normalized_tags,
        "attributes": {"*": normalized_attributes},
        "strip": True,
        "strip_comments": True,
    }
    if normalized_protocols:
        cleaner_kwargs["protocols"] = normalized_protocols
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


def _normalize_reference_target(raw_target: str) -> str:
    target = str(raw_target or "").strip()
    if len(target) >= 2 and target[0] == target[-1] and target[0] in {"'", '"'}:
        target = target[1:-1].strip()
    return target


def _extract_data_uri_meta(target: str) -> tuple[str, tuple[str, ...]] | None:
    normalized_target = str(target or "").strip()
    if not normalized_target:
        return None
    lowered_target = normalized_target.lower()
    if not lowered_target.startswith("data:"):
        return None
    comma_index = normalized_target.find(",")
    if comma_index <= 5:
        return None
    raw_meta = normalized_target[5:comma_index]
    compact_meta = "".join(raw_meta.lower().split())
    if not compact_meta:
        return None
    segments = tuple(segment for segment in compact_meta.split(";") if segment)
    if not segments:
        return None
    return segments[0], segments[1:]


def _is_allowed_data_image_uri(target: str) -> bool:
    parsed_meta = _extract_data_uri_meta(target)
    if parsed_meta is None:
        return False
    mime_type, _ = parsed_meta
    allowed_mime_types = {
        normalized
        for value in (
            _ALLOWED_DATA_IMAGE_MIME_TYPES
            + tuple(getattr(settings, "CARD_SVG_ALLOWED_DATA_IMAGE_MIME_TYPES", ()))
        )
        for normalized in {str(value).strip().lower()}
        if normalized
    }
    return mime_type in allowed_mime_types


def _is_allowed_href_target(target: str) -> bool:
    normalized_target = _normalize_reference_target(target)
    if not normalized_target:
        return True
    if normalized_target.startswith("#"):
        return True
    if normalized_target.lower().startswith("data:"):
        return _is_allowed_data_image_uri(normalized_target)
    return False


def _assert_svg_is_safe(svg_text: str) -> None:
    if _BLOCKED_TAG_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload contains blocked tags.")
    if _EVENT_HANDLER_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload contains blocked event handler attributes.")
    if _DANGEROUS_TOKEN_PATTERN.search(svg_text):
        raise SvgSanitizationError("SVG payload contains blocked protocol content.")
    for match in _HREF_ATTRIBUTE_PATTERN.finditer(svg_text):
        quoted_target = match.group(2) or ""
        unquoted_target = match.group(3) or ""
        reference_target = _normalize_reference_target(quoted_target or unquoted_target)
        if not _is_allowed_href_target(reference_target):
            raise SvgSanitizationError("SVG payload cannot reference external href resources.")
    for match in _URL_FUNCTION_PATTERN.finditer(svg_text):
        reference_target = _normalize_reference_target(match.group(1))
        if not reference_target:
            continue
        if reference_target.startswith("#"):
            continue
        if reference_target.lower().startswith("data:") and _is_allowed_data_image_uri(reference_target):
            continue
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
