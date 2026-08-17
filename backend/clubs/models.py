import re
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _

from .banking import derive_bank_name_from_iban, is_valid_iban, normalize_iban

def _validate_luxembourg_postal_code(postal_code: str) -> None:
    normalized_postal_code = str(postal_code or "").strip()
    if normalized_postal_code and not re.fullmatch(r"\d{4}", normalized_postal_code):
        raise ValidationError(
            {"postal_code": _("Postal code must be 4 digits for Luxembourg.")}
        )


class Club(models.Model):
    name = models.CharField(max_length=255)
    city = models.CharField(max_length=255, blank=True)
    address = models.CharField(max_length=255, blank=True)
    address_line1 = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    postal_code = models.CharField(max_length=10, blank=True)
    locality = models.CharField(max_length=255, blank=True)
    iban = models.CharField(max_length=34, blank=True)
    bank_name = models.CharField(max_length=255, blank=True)
    max_admins = models.PositiveIntegerField(default=10)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="clubs_created",
    )
    admins = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="clubs_administered",
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        _validate_luxembourg_postal_code(self.postal_code)
        normalized_iban = normalize_iban(self.iban)
        if normalized_iban and not is_valid_iban(normalized_iban):
            raise ValidationError({"iban": _("Enter a valid IBAN.")})
        self.iban = normalized_iban
        self.bank_name = derive_bank_name_from_iban(normalized_iban)

    @property
    def formatted_address(self) -> str:
        lines = []
        if self.address_line1:
            lines.append(self.address_line1)
        if self.address_line2:
            lines.append(self.address_line2)
        postal_locality = " ".join(
            part for part in [self.postal_code.strip(), self.locality.strip()] if part
        ).strip()
        if postal_locality:
            lines.append(postal_locality)
        return ", ".join(lines)

    def __str__(self):
        return self.name


class FederationProfile(models.Model):
    name = models.CharField(max_length=255, default="Luxembourg Taekwondo Federation")
    address_line1 = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    postal_code = models.CharField(max_length=10, blank=True)
    locality = models.CharField(max_length=255, blank=True)
    iban = models.CharField(max_length=34, blank=True)
    bank_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Federation profile"
        verbose_name_plural = "Federation profile"

    def clean(self):
        _validate_luxembourg_postal_code(self.postal_code)
        normalized_iban = normalize_iban(self.iban)
        if normalized_iban and not is_valid_iban(normalized_iban):
            raise ValidationError({"iban": _("Enter a valid IBAN.")})
        self.iban = normalized_iban
        self.bank_name = derive_bank_name_from_iban(normalized_iban)

    def save(self, *args, **kwargs):
        if self.pk is None:
            self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


def branding_asset_upload_to(instance: "BrandingAsset", filename: str) -> str:
    extension = Path(filename or "").suffix.lower()
    token = uuid4().hex
    usage = (instance.usage_type or BrandingAsset.UsageType.GENERAL).lower()
    if (
        instance.scope_type == BrandingAsset.ScopeType.CLUB
        and instance.club_id
    ):
        scope_path = f"clubs/{instance.club_id}"
    elif (
        instance.scope_type == BrandingAsset.ScopeType.FEDERATION
        and instance.federation_profile_id
    ):
        scope_path = f"federation/{instance.federation_profile_id}"
    else:
        scope_path = "unscoped"
    if instance.asset_type == BrandingAsset.AssetType.LOGO:
        root = "uploads/branding"
        category = "logos"
    else:
        root = "uploads/documents"
        category = "files"
    return f"{root}/{scope_path}/{category}/{usage}/{token}{extension}"


class BrandingAsset(models.Model):
    class ScopeType(models.TextChoices):
        CLUB = "club", "Club"
        FEDERATION = "federation", "Federation"

    class AssetType(models.TextChoices):
        LOGO = "logo", "Logo"
        DOCUMENT = "document", "Document"

    class UsageType(models.TextChoices):
        GENERAL = "general", "General"
        INVOICE = "invoice", "Invoice"
        PRINT = "print", "Print"
        DIGITAL = "digital", "Digital"

    scope_type = models.CharField(max_length=16, choices=ScopeType.choices)
    asset_type = models.CharField(
        max_length=16,
        choices=AssetType.choices,
        default=AssetType.LOGO,
    )
    usage_type = models.CharField(
        max_length=32,
        choices=UsageType.choices,
        default=UsageType.GENERAL,
    )
    club = models.ForeignKey(
        Club,
        on_delete=models.CASCADE,
        related_name="branding_assets",
        null=True,
        blank=True,
    )
    federation_profile = models.ForeignKey(
        FederationProfile,
        on_delete=models.CASCADE,
        related_name="branding_assets",
        null=True,
        blank=True,
    )
    label = models.CharField(max_length=120, blank=True)
    file = models.FileField(upload_to=branding_asset_upload_to, max_length=500)
    is_selected = models.BooleanField(default=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="branding_assets_uploaded",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                name="branding_asset_scope_target_valid",
                condition=(
                    models.Q(
                        scope_type="club",
                        club__isnull=False,
                        federation_profile__isnull=True,
                    )
                    | models.Q(
                        scope_type="federation",
                        club__isnull=True,
                        federation_profile__isnull=False,
                    )
                ),
            ),
            models.UniqueConstraint(
                fields=("club", "asset_type", "usage_type"),
                condition=models.Q(
                    scope_type="club",
                    is_selected=True,
                ),
                name="branding_asset_selected_logo_per_club_usage",
            ),
            models.UniqueConstraint(
                fields=("federation_profile", "asset_type", "usage_type"),
                condition=models.Q(
                    scope_type="federation",
                    is_selected=True,
                ),
                name="branding_asset_selected_logo_per_fed_usage",
            ),
        ]
        indexes = [
            models.Index(
                fields=["scope_type", "asset_type", "usage_type"],
                name="branding_asset_scope_idx",
            ),
            models.Index(
                fields=["club", "asset_type"],
                name="branding_asset_club_idx",
            ),
            models.Index(
                fields=["federation_profile", "asset_type"],
                name="branding_asset_fed_idx",
            ),
        ]

    def __str__(self) -> str:
        if self.scope_type == self.ScopeType.CLUB and self.club_id:
            scope = f"club:{self.club_id}"
        else:
            scope = f"federation:{self.federation_profile_id}"
        return f"{scope}:{self.asset_type}:{self.usage_type}:{self.id}"
