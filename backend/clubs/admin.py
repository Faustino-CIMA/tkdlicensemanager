from django.contrib import admin

from .models import BrandingAsset, Club, FederationProfile


@admin.register(Club)
class ClubAdmin(admin.ModelAdmin):
    list_display = ("name", "locality", "postal_code", "iban", "bank_name", "created_by")
    search_fields = (
        "name",
        "locality",
        "postal_code",
        "address_line1",
        "city",
        "iban",
        "bank_name",
    )


@admin.register(FederationProfile)
class FederationProfileAdmin(admin.ModelAdmin):
    list_display = ("name", "locality", "postal_code", "iban", "bank_name", "updated_at")
    search_fields = ("name", "locality", "postal_code", "address_line1", "iban", "bank_name")


@admin.register(BrandingAsset)
class BrandingAssetAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "scope_type",
        "asset_type",
        "usage_type",
        "club",
        "federation_profile",
        "is_selected",
        "uploaded_by",
        "created_at",
    )
    list_filter = ("scope_type", "asset_type", "usage_type", "is_selected")
    search_fields = ("label", "file")
