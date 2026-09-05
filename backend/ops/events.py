from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import AuthEvent
from .request_utils import client_ip, user_agent


def record_auth_event(
    request,
    event_type: str,
    *,
    username: str = "",
    user=None,
    metadata: dict | None = None,
) -> AuthEvent:
    return AuthEvent.objects.create(
        event_type=event_type,
        username_attempted=(username or "")[:150],
        user=user,
        ip=client_ip(request),
        user_agent=user_agent(request),
        metadata=metadata or {},
    )


def lockout_window():
    minutes = int(getattr(settings, "OPS_LOCKOUT_WINDOW_MINUTES", 15))
    return timezone.now() - timedelta(minutes=minutes)


def failure_count(*, username: str = "", ip: str | None = None) -> int:
    since = lockout_window()
    qs = AuthEvent.objects.filter(
        event_type=AuthEvent.EventType.LOGIN_FAILURE,
        created_at__gte=since,
    )
    if username:
        return qs.filter(username_attempted__iexact=username).count()
    if ip:
        return qs.filter(ip=ip).count()
    return 0


def is_locked(*, username: str = "", ip: str | None = None) -> bool:
    threshold = int(getattr(settings, "OPS_LOCKOUT_FAILURES", 10))
    if username and failure_count(username=username) >= threshold:
        return True
    if ip and failure_count(ip=ip) >= threshold:
        return True
    return False
