from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.authtoken.models import Token

from .models import AuthTokenMeta, OpsAuditLog


def client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR") or ""
    if forwarded:
        first = forwarded.split(",")[0].strip()
        return first or None
    remote = (request.META.get("REMOTE_ADDR") or "").strip()
    return remote or None


def user_agent(request) -> str:
    return (request.META.get("HTTP_USER_AGENT") or "")[:512]


def write_ops_audit(
    request,
    *,
    action: str,
    message: str = "",
    target_type: str = "",
    target_id: str | int | None = "",
    metadata: dict | None = None,
) -> OpsAuditLog:
    actor = getattr(request, "user", None)
    if actor is not None and not getattr(actor, "is_authenticated", False):
        actor = None
    return OpsAuditLog.objects.create(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id="" if target_id is None else str(target_id),
        message=message,
        ip=client_ip(request),
        metadata=metadata or {},
    )


def touch_token_meta(token: Token, request) -> AuthTokenMeta:
    now = timezone.now()
    interval = timedelta(
        seconds=int(getattr(settings, "OPS_TOKEN_TOUCH_INTERVAL_SECONDS", 60))
    )
    ip = client_ip(request)
    ua = user_agent(request)
    meta, created = AuthTokenMeta.objects.get_or_create(
        token=token,
        defaults={"last_used_at": now, "last_ip": ip, "user_agent": ua},
    )
    if created:
        return meta
    if meta.last_used_at and now - meta.last_used_at < interval:
        return meta
    meta.last_used_at = now
    meta.last_ip = ip
    meta.user_agent = ua
    meta.save(update_fields=["last_used_at", "last_ip", "user_agent"])
    return meta
