from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path

from django.conf import settings
from django.core.cache import cache

from .models import TranslationOverride

SUPPORTED_LOCALES = ("en", "lb")
I18N_CACHE_TTL = 15
PLACEHOLDER_RE = re.compile(r"\{[a-zA-Z0-9_]+\}")
SECTION_RE = re.compile(r"^([a-z]+)")

NAMESPACE_PAGES = [
    {
        "id": "Home",
        "title": "Landing page",
        "description": "Public home page before sign-in.",
        "preview_path": "/{locale}",
    },
    {
        "id": "Auth",
        "title": "Sign in",
        "description": "Login form and brand panel.",
        "preview_path": "/{locale}/login",
    },
    {
        "id": "Verify",
        "title": "Email verification",
        "description": "Verify-email screen.",
        "preview_path": "/{locale}/verify-email",
    },
    {
        "id": "Reset",
        "title": "Password reset",
        "description": "Reset-password screens.",
        "preview_path": "/{locale}/reset-password",
    },
    {
        "id": "Checkout",
        "title": "Checkout",
        "description": "Payment success and cancel pages.",
        "preview_path": "/{locale}/checkout/success",
    },
    {
        "id": "Common",
        "title": "Shared chrome",
        "description": "Header, roles, buttons, statuses, and logos used on every screen.",
        "preview_path": None,
    },
    {
        "id": "Dashboard",
        "title": "Dashboard redirect",
        "description": "Short role-based dashboard landing.",
        "preview_path": "/{locale}/dashboard",
    },
    {
        "id": "ClubAdmin",
        "title": "Club dashboard",
        "description": "Club Admin and Coach: members, licenses, orders, invoices, transfers, print.",
        "preview_path": "/{locale}/dashboard/club",
    },
    {
        "id": "LtfAdmin",
        "title": "LTF Admin",
        "description": "Federation admin: clubs, members, licenses, and the card designer.",
        "preview_path": "/{locale}/dashboard/ltf",
    },
    {
        "id": "LtfFinance",
        "title": "LTF Finance",
        "description": "Finance: orders, invoices, payments, audit, and settings.",
        "preview_path": "/{locale}/dashboard/ltf-finance",
    },
    {
        "id": "Member",
        "title": "Member area",
        "description": "Member history and profile photo.",
        "preview_path": "/{locale}/dashboard/member",
    },
    {
        "id": "Ops",
        "title": "Ops console",
        "description": "Superuser operations console, including this translator.",
        "preview_path": "/{locale}/dashboard/ops",
    },
    {
        "id": "Import",
        "title": "CSV import",
        "description": "Club and member import wizard.",
        "preview_path": "/{locale}/dashboard/ltf/import",
    },
    {
        "id": "About",
        "title": "About / releases",
        "description": "Version history and about page.",
        "preview_path": "/{locale}/about",
    },
]

SECTION_LABELS = {
    "nav": "Navigation",
    "overview": "Overview",
    "col": "Columns",
    "card": "Summary cards",
    "status": "Statuses",
    "logo": "Logos",
    "role": "Roles",
    "delete": "Delete",
    "batch": "Batch actions",
    "pagination": "Pagination",
    "payment": "Payment",
    "transfer": "Transfers",
    "member": "Members",
    "members": "Members",
    "license": "Licenses",
    "licenses": "Licenses",
    "order": "Orders",
    "orders": "Orders",
    "invoice": "Invoices",
    "invoices": "Invoices",
    "print": "Print",
    "club": "Club",
    "audit": "Audit",
    "release": "Releases",
}


def i18n_search_dirs() -> list[Path]:
    dirs: list[Path] = []
    configured = Path(str(getattr(settings, "OPS_I18N_DIR", "") or ""))
    if str(configured):
        dirs.append(configured)
    dirs.append(Path("/app/i18n_frontend"))
    dirs.append(settings.BASE_DIR.parent / "frontend" / "src" / "messages")
    dirs.append(Path(settings.BASE_DIR) / "ops" / "i18n")
    unique: list[Path] = []
    seen = set()
    for path in dirs:
        resolved = path
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(resolved)
    return unique


def bundled_path(locale: str) -> Path | None:
    filename = f"{locale}.json"
    for directory in i18n_search_dirs():
        candidate = directory / filename
        if candidate.is_file():
            return candidate
    return None


def load_bundled(locale: str) -> dict:
    path = bundled_path(locale)
    if path is None:
        return {}
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def flatten_messages(data: dict, prefix: str = "") -> dict[str, str]:
    items: dict[str, str] = {}
    for key, value in data.items():
        dotted = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            items.update(flatten_messages(value, dotted))
        else:
            items[dotted] = "" if value is None else str(value)
    return items


def unflatten_messages(items: dict[str, str]) -> dict:
    root: dict = {}
    for dotted, value in items.items():
        parts = dotted.split(".")
        cursor = root
        for part in parts[:-1]:
            nxt = cursor.get(part)
            if not isinstance(nxt, dict):
                nxt = {}
                cursor[part] = nxt
            cursor = nxt
        cursor[parts[-1]] = value
    return root


def override_map(locale: str) -> dict[str, str]:
    return dict(
        TranslationOverride.objects.filter(locale=locale).values_list("key", "value")
    )


def merged_flat(locale: str) -> dict[str, str]:
    data = flatten_messages(load_bundled(locale))
    data.update(override_map(locale))
    return data


def merged_nested(locale: str) -> dict:
    cache_key = f"ops:i18n:{locale}"
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return cached
    nested = unflatten_messages(merged_flat(locale))
    cache.set(cache_key, nested, timeout=I18N_CACHE_TTL)
    return nested


def bust_i18n_cache(locale: str | None = None) -> None:
    locales = [locale] if locale else list(SUPPORTED_LOCALES)
    for item in locales:
        cache.delete(f"ops:i18n:{item}")


def local_key_for(key: str, namespace: str) -> str:
    prefix = f"{namespace}."
    if key.startswith(prefix):
        return key[len(prefix) :]
    if "." in key:
        return key.split(".", 1)[1]
    return key


def section_for(local_key: str) -> tuple[str, str]:
    match = SECTION_RE.match(local_key)
    section_id = match.group(1) if match else "other"
    label = SECTION_LABELS.get(section_id, section_id[:1].upper() + section_id[1:])
    return section_id, label


def translation_rows(*, query: str = "", namespace: str = "", missing_only: bool = False) -> list[dict]:
    en = flatten_messages(load_bundled("en"))
    lb = flatten_messages(load_bundled("lb"))
    en_over = override_map("en")
    lb_over = override_map("lb")
    keys = list(en.keys())
    extras = [
        key
        for key in list(lb.keys()) + list(en_over.keys()) + list(lb_over.keys())
        if key not in en
    ]
    seen = set(keys)
    for key in extras:
        if key not in seen:
            keys.append(key)
            seen.add(key)
    q = query.strip().lower()
    rows = []
    for key in keys:
        ns = key.split(".", 1)[0] if "." in key else key
        if namespace and ns != namespace:
            continue
        en_value = en_over.get(key, en.get(key, ""))
        lb_value = lb_over.get(key, lb.get(key, ""))
        missing = not str(lb_value).strip()
        if missing_only and not missing:
            continue
        if q and q not in key.lower() and q not in en_value.lower() and q not in lb_value.lower():
            continue
        local = local_key_for(key, ns)
        section_id, section_label = section_for(local)
        rows.append(
            {
                "key": key,
                "local_key": local,
                "namespace": ns,
                "section": section_id,
                "section_label": section_label,
                "en": en_value,
                "lb": lb_value,
                "en_overridden": key in en_over,
                "lb_overridden": key in lb_over,
                "missing_lb": missing,
                "placeholders": PLACEHOLDER_RE.findall(en_value),
            }
        )
    return rows


def namespace_summaries() -> list[dict]:
    rows = translation_rows()
    by_ns: dict[str, list[dict]] = {}
    for row in rows:
        by_ns.setdefault(row["namespace"], []).append(row)
    known = {item["id"]: item for item in NAMESPACE_PAGES}
    summaries = []
    for item in NAMESPACE_PAGES:
        ns_rows = by_ns.get(item["id"], [])
        summaries.append(
            {
                **item,
                "string_count": len(ns_rows),
                "missing_lb": sum(1 for row in ns_rows if row["missing_lb"]),
            }
        )
    for ns, ns_rows in by_ns.items():
        if ns in known:
            continue
        summaries.append(
            {
                "id": ns,
                "title": ns,
                "description": "",
                "preview_path": None,
                "string_count": len(ns_rows),
                "missing_lb": sum(1 for row in ns_rows if row["missing_lb"]),
            }
        )
    return summaries


def export_nested(locale: str) -> dict:
    if locale == "en":
        bundled = deepcopy(load_bundled("en"))
        flat = flatten_messages(bundled)
        flat.update(override_map("en"))
        return unflatten_messages(flat)
    bundled = deepcopy(load_bundled(locale))
    flat = flatten_messages(bundled)
    # Start from English so newly added keys exist in the export.
    en_flat = flatten_messages(load_bundled("en"))
    merged = dict(en_flat)
    merged.update(flat)
    merged.update(override_map(locale))
    return unflatten_messages(merged)


def namespaces() -> list[str]:
    return [item["id"] for item in namespace_summaries()]
