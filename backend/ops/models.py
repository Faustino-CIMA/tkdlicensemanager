from django.conf import settings
from django.db import models


class AuthEvent(models.Model):
    class EventType(models.TextChoices):
        LOGIN_SUCCESS = "login_success", "Login success"
        LOGIN_FAILURE = "login_failure", "Login failure"
        LOGOUT = "logout", "Logout"
        TOKEN_REVOKED = "token_revoked", "Token revoked"
        LOCKOUT = "lockout", "Lockout"
        PASSWORD_RESET = "password_reset", "Password reset"
        DJANGO_ADMIN_LOGIN = "django_admin_login", "Django admin login"

    event_type = models.CharField(max_length=32, choices=EventType.choices)
    username_attempted = models.CharField(max_length=150, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="auth_events",
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"], name="authevt_created_idx"),
            models.Index(fields=["event_type", "-created_at"], name="authevt_type_created_idx"),
            models.Index(fields=["username_attempted", "-created_at"], name="authevt_user_created_idx"),
            models.Index(fields=["ip", "-created_at"], name="authevt_ip_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.event_type} {self.username_attempted or self.user_id}"


class AuthTokenMeta(models.Model):
    token = models.OneToOneField(
        "authtoken.Token",
        on_delete=models.CASCADE,
        related_name="ops_meta",
    )
    last_used_at = models.DateTimeField(null=True, blank=True)
    last_ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["-last_used_at"], name="authtok_last_used_idx"),
        ]

    def __str__(self) -> str:
        return f"token meta {self.token_id}"


class SecurityAlert(models.Model):
    class Severity(models.TextChoices):
        INFO = "info", "Info"
        WARNING = "warning", "Warning"
        CRITICAL = "critical", "Critical"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACK = "ack", "Acknowledged"
        RESOLVED = "resolved", "Resolved"

    severity = models.CharField(max_length=16, choices=Severity.choices)
    code = models.CharField(max_length=64)
    title = models.CharField(max_length=200)
    detail = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    related_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="security_alerts",
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="resolved_security_alerts",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="secalert_status_created_idx"),
            models.Index(fields=["code", "-created_at"], name="secalert_code_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.severity} {self.code}"


class TranslationOverride(models.Model):
    locale = models.CharField(max_length=10)
    key = models.CharField(max_length=255)
    value = models.TextField()
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="translation_overrides",
    )
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["locale", "key"], name="ops_i18n_locale_key_uniq"),
        ]
        indexes = [
            models.Index(fields=["locale", "key"], name="ops_i18n_locale_key_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.locale}:{self.key}"


class OpsAuditLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ops_audit_logs",
    )
    action = models.CharField(max_length=100)
    target_type = models.CharField(max_length=64, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    message = models.TextField(blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"], name="opsaudit_created_idx"),
            models.Index(fields=["action", "-created_at"], name="opsaudit_action_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.action} {self.target_type}:{self.target_id}"
