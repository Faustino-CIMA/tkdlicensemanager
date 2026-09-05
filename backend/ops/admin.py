from django.contrib import admin

from .models import AuthEvent, AuthTokenMeta, OpsAuditLog, SecurityAlert, TranslationOverride


@admin.register(AuthEvent)
class AuthEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "event_type", "username_attempted", "user", "ip")
    list_filter = ("event_type",)
    search_fields = ("username_attempted", "ip")
    readonly_fields = ("created_at",)


@admin.register(AuthTokenMeta)
class AuthTokenMetaAdmin(admin.ModelAdmin):
    list_display = ("token", "last_used_at", "last_ip")
    readonly_fields = ("created_at", "last_used_at")


@admin.register(SecurityAlert)
class SecurityAlertAdmin(admin.ModelAdmin):
    list_display = ("created_at", "severity", "code", "status", "related_user", "ip")
    list_filter = ("severity", "status", "code")
    search_fields = ("title", "detail")


@admin.register(TranslationOverride)
class TranslationOverrideAdmin(admin.ModelAdmin):
    list_display = ("locale", "key", "updated_at", "updated_by")
    list_filter = ("locale",)
    search_fields = ("key", "value")


@admin.register(OpsAuditLog)
class OpsAuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "actor", "target_type", "target_id")
    list_filter = ("action",)
    search_fields = ("message", "action")
    readonly_fields = ("created_at",)
