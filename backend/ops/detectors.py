from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .events import failure_count, lockout_window
from .models import AuthEvent, SecurityAlert


def _open_alert(
    *,
    code: str,
    title: str,
    detail: str,
    severity: str,
    related_user=None,
    ip=None,
    metadata: dict | None = None,
) -> SecurityAlert | None:
    since = timezone.now() - timedelta(minutes=int(getattr(settings, "OPS_LOCKOUT_WINDOW_MINUTES", 15)))
    exists = SecurityAlert.objects.filter(
        code=code,
        status=SecurityAlert.Status.OPEN,
        created_at__gte=since,
    )
    if related_user is not None:
        exists = exists.filter(related_user=related_user)
    elif ip:
        exists = exists.filter(ip=ip)
    if exists.exists():
        return None
    return SecurityAlert.objects.create(
        code=code,
        title=title,
        detail=detail,
        severity=severity,
        related_user=related_user,
        ip=ip,
        metadata=metadata or {},
    )


def run_failure_detectors(request, *, username: str, ip: str | None) -> None:
    threshold = int(getattr(settings, "OPS_LOCKOUT_FAILURES", 10))
    stuffing_threshold = int(getattr(settings, "OPS_STUFFING_DISTINCT_USERNAMES", 5))

    if username and failure_count(username=username) >= threshold:
        _open_alert(
            code="brute_force_username",
            title="Repeated failed logins for a username",
            detail=f"At least {threshold} failed logins for '{username}' in the lockout window.",
            severity=SecurityAlert.Severity.CRITICAL,
            ip=ip,
            metadata={"username": username},
        )
    if ip and failure_count(ip=ip) >= threshold:
        _open_alert(
            code="brute_force_ip",
            title="Repeated failed logins from an IP",
            detail=f"At least {threshold} failed logins from {ip} in the lockout window.",
            severity=SecurityAlert.Severity.CRITICAL,
            ip=ip,
        )
    if ip:
        since = lockout_window()
        distinct = (
            AuthEvent.objects.filter(
                event_type=AuthEvent.EventType.LOGIN_FAILURE,
                ip=ip,
                created_at__gte=since,
            )
            .exclude(username_attempted="")
            .values("username_attempted")
            .distinct()
            .count()
        )
        if distinct >= stuffing_threshold:
            _open_alert(
                code="credential_stuffing",
                title="Credential stuffing pattern",
                detail=f"{distinct} distinct usernames failed from {ip} in the lockout window.",
                severity=SecurityAlert.Severity.CRITICAL,
                ip=ip,
                metadata={"distinct_usernames": distinct},
            )


def run_success_detectors(request, *, user, ip: str | None) -> None:
    since = lockout_window()
    had_lockout = AuthEvent.objects.filter(
        event_type=AuthEvent.EventType.LOCKOUT,
        username_attempted__iexact=user.username,
        created_at__gte=since,
    ).exists()
    if had_lockout:
        _open_alert(
            code="login_after_lockout",
            title="Successful login after lockout",
            detail=f"User '{user.username}' signed in after a recent lockout.",
            severity=SecurityAlert.Severity.WARNING,
            related_user=user,
            ip=ip,
        )
    if user.is_superuser:
        _open_alert(
            code="superuser_login",
            title="Superuser signed in",
            detail=f"Superuser '{user.username}' signed in.",
            severity=SecurityAlert.Severity.INFO,
            related_user=user,
            ip=ip,
        )
    if not user.is_active:
        _open_alert(
            code="disabled_account_login",
            title="Login attempt on a disabled account",
            detail=f"Disabled account '{user.username}' authenticated.",
            severity=SecurityAlert.Severity.CRITICAL,
            related_user=user,
            ip=ip,
        )


def record_django_admin_login(request, user) -> None:
    from .events import record_auth_event

    record_auth_event(
        request,
        AuthEvent.EventType.DJANGO_ADMIN_LOGIN,
        username=user.username,
        user=user,
    )
    _open_alert(
        code="django_admin_login",
        title="Django admin login",
        detail=f"User '{user.username}' signed in to Django admin.",
        severity=SecurityAlert.Severity.WARNING,
        related_user=user,
        ip=getattr(request, "META", {}).get("REMOTE_ADDR"),
    )
