from django.contrib import admin

from .models import License, LicenseHistoryEvent, LicenseType


@admin.register(License)
class LicenseAdmin(admin.ModelAdmin):
    list_display = ("member", "club", "year", "status", "license_type")
    list_filter = ("status", "year", "license_type")


@admin.register(LicenseType)
class LicenseTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "code")
    search_fields = ("name", "code")


@admin.register(LicenseHistoryEvent)
class LicenseHistoryEventAdmin(admin.ModelAdmin):
    list_display = (
        "member",
        "license",
        "event_type",
        "status_before",
        "status_after",
        "event_at",
    )
    list_filter = ("event_type", "status_before", "status_after", "event_at")
    search_fields = ("member__first_name", "member__last_name", "reason")
    readonly_fields = (
        "member",
        "license",
        "club",
        "order",
        "payment",
        "actor",
        "event_type",
        "event_at",
        "reason",
        "metadata",
        "license_year",
        "status_before",
        "status_after",
        "club_name_snapshot",
        "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
