from django.contrib import admin

from .models import License


@admin.register(License)
class LicenseAdmin(admin.ModelAdmin):
    list_display = ("member", "club", "year", "status")
    list_filter = ("status", "year")
