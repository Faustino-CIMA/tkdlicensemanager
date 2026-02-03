from django.contrib import admin

from .models import License, LicenseType


@admin.register(License)
class LicenseAdmin(admin.ModelAdmin):
    list_display = ("member", "club", "year", "status", "license_type")
    list_filter = ("status", "year", "license_type")


@admin.register(LicenseType)
class LicenseTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "code")
    search_fields = ("name", "code")
