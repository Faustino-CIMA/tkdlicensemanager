from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import re

import clubs.models


_LUXEMBOURG_BANK_CODE_MAP = {
    "0001": "Spuerkeess (BCEE)",
    "0002": "Banque Internationale a Luxembourg (BIL)",
    "0003": "BGL BNP Paribas",
    "0009": "Banque Raiffeisen",
    "0014": "ING Luxembourg",
    "0019": "POST Luxembourg",
    "0020": "Banque de Luxembourg",
    "001": "Spuerkeess (BCEE)",
    "002": "Banque Internationale a Luxembourg (BIL)",
    "003": "BGL BNP Paribas",
    "009": "Banque Raiffeisen",
    "014": "ING Luxembourg",
    "019": "POST Luxembourg",
    "020": "Banque de Luxembourg",
}


def _normalize_iban(raw_value: str | None) -> str:
    return re.sub(r"\s+", "", str(raw_value or "")).upper()


def _derive_bank_name(iban: str) -> str:
    normalized = _normalize_iban(iban)
    if not normalized:
        return ""
    if normalized.startswith("LU") and len(normalized) >= 8:
        code4 = normalized[4:8]
        code3 = normalized[4:7]
        return _LUXEMBOURG_BANK_CODE_MAP.get(
            code4,
            _LUXEMBOURG_BANK_CODE_MAP.get(code3, f"Luxembourg bank ({code4})"),
        )
    if len(normalized) >= 8:
        return f"Bank identifier {normalized[4:8]}"
    return "Bank"


def _backfill_bank_names(apps, schema_editor):
    Club = apps.get_model("clubs", "Club")
    FederationProfile = apps.get_model("clubs", "FederationProfile")

    for club in Club.objects.exclude(iban="").iterator():
        normalized = _normalize_iban(getattr(club, "iban", ""))
        bank_name = _derive_bank_name(normalized)
        if club.iban != normalized or club.bank_name != bank_name:
            club.iban = normalized
            club.bank_name = bank_name
            club.save(update_fields=["iban", "bank_name"])

    for profile in FederationProfile.objects.exclude(iban="").iterator():
        normalized = _normalize_iban(getattr(profile, "iban", ""))
        bank_name = _derive_bank_name(normalized)
        if profile.iban != normalized or profile.bank_name != bank_name:
            profile.iban = normalized
            profile.bank_name = bank_name
            profile.save(update_fields=["iban", "bank_name"])


def _noop(apps, schema_editor):
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0003_club_structured_address_and_federation_profile"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="club",
            name="bank_name",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="club",
            name="iban",
            field=models.CharField(blank=True, max_length=34),
        ),
        migrations.AddField(
            model_name="federationprofile",
            name="bank_name",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="federationprofile",
            name="iban",
            field=models.CharField(blank=True, max_length=34),
        ),
        migrations.RunPython(_backfill_bank_names, _noop),
        migrations.CreateModel(
            name="BrandingAsset",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "scope_type",
                    models.CharField(
                        choices=[("club", "Club"), ("federation", "Federation")],
                        max_length=16,
                    ),
                ),
                (
                    "asset_type",
                    models.CharField(
                        choices=[("logo", "Logo"), ("document", "Document")],
                        default="logo",
                        max_length=16,
                    ),
                ),
                (
                    "usage_type",
                    models.CharField(
                        choices=[
                            ("general", "General"),
                            ("invoice", "Invoice"),
                            ("print", "Print"),
                            ("digital", "Digital"),
                        ],
                        default="general",
                        max_length=32,
                    ),
                ),
                ("label", models.CharField(blank=True, max_length=120)),
                (
                    "file",
                    models.FileField(
                        max_length=500,
                        upload_to=clubs.models.branding_asset_upload_to,
                    ),
                ),
                ("is_selected", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "club",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="branding_assets",
                        to="clubs.club",
                    ),
                ),
                (
                    "federation_profile",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="branding_assets",
                        to="clubs.federationprofile",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="branding_assets_uploaded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="brandingasset",
            constraint=models.CheckConstraint(
                condition=(
                    (
                        models.Q(
                            scope_type="club",
                            club__isnull=False,
                            federation_profile__isnull=True,
                        )
                    )
                    | (
                        models.Q(
                            scope_type="federation",
                            club__isnull=True,
                            federation_profile__isnull=False,
                        )
                    )
                ),
                name="branding_asset_scope_target_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="brandingasset",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_selected=True, scope_type="club"),
                fields=("club", "asset_type", "usage_type"),
                name="branding_asset_selected_logo_per_club_usage",
            ),
        ),
        migrations.AddConstraint(
            model_name="brandingasset",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_selected=True, scope_type="federation"),
                fields=("federation_profile", "asset_type", "usage_type"),
                name="branding_asset_selected_logo_per_fed_usage",
            ),
        ),
        migrations.AddIndex(
            model_name="brandingasset",
            index=models.Index(
                fields=["scope_type", "asset_type", "usage_type"],
                name="branding_asset_scope_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="brandingasset",
            index=models.Index(
                fields=["club", "asset_type"],
                name="branding_asset_club_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="brandingasset",
            index=models.Index(
                fields=["federation_profile", "asset_type"],
                name="branding_asset_fed_idx",
            ),
        ),
    ]
