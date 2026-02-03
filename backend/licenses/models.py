from datetime import date
from typing import cast

from django.db import models
from django.utils.text import slugify

from clubs.models import Club
from members.models import Member


class LicenseType(models.Model):
    name = models.CharField(max_length=100, unique=True)
    code = models.SlugField(max_length=50, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return str(self.name)


def get_default_license_type():
    license_type, _ = LicenseType.objects.get_or_create(  # type: ignore[attr-defined]
        code="paid",
        defaults={"name": "Paid"},
    )
    return license_type.pk


class License(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACTIVE = "active", "Active"
        EXPIRED = "expired", "Expired"

    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="licenses")
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="licenses")
    license_type = models.ForeignKey(
        LicenseType,
        on_delete=models.PROTECT,
        related_name="licenses",
        default=get_default_license_type,
    )
    year = models.PositiveIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    issued_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.start_date or not self.end_date:
            year = cast(int, self.year)
            self.start_date = date(year, 1, 1)
            self.end_date = date(year, 12, 31)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.member} - {self.year}"
