from django.contrib import admin

from .models import Club, FederationProfile


@admin.register(Club)
class ClubAdmin(admin.ModelAdmin):
    list_display = ("name", "locality", "postal_code", "created_by")
    search_fields = ("name", "locality", "postal_code", "address_line1", "city")


@admin.register(FederationProfile)
class FederationProfileAdmin(admin.ModelAdmin):
    list_display = ("name", "locality", "postal_code", "updated_at")
    search_fields = ("name", "locality", "postal_code", "address_line1")
