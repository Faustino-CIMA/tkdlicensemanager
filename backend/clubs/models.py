import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _

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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Federation profile"
        verbose_name_plural = "Federation profile"

    def clean(self):
        _validate_luxembourg_postal_code(self.postal_code)

    def save(self, *args, **kwargs):
        if self.pk is None:
            self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name
