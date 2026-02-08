from datetime import date
from decimal import Decimal
from typing import cast
from uuid import uuid4

from django.conf import settings
from django.db import models

from .fields import EncryptedCharField
from django.utils.text import slugify
from django.utils import timezone

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


class LicensePrice(models.Model):
    objects = models.Manager()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default="EUR")
    effective_from = models.DateField(default=timezone.localdate)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="license_prices",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-created_at"]

    def __str__(self) -> str:
        return f"{self.amount} {self.currency} ({self.effective_from})"

    @classmethod
    def get_active_price(cls, as_of=None):
        date_value = as_of or timezone.localdate()
        return (
            cls.objects.filter(effective_from__lte=date_value)
            .order_by("-effective_from", "-created_at")
            .first()
        )


def get_default_license_type():
    license_type, _ = LicenseType.objects.get_or_create(  # type: ignore[attr-defined]
        code="paid",
        defaults={"name": "Paid"},
    )
    return license_type.pk


def generate_order_number() -> str:
    return f"ORD-{uuid4().hex[:12].upper()}"


def generate_invoice_number() -> str:
    return f"INV-{uuid4().hex[:12].upper()}"


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


class Order(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        CANCELLED = "cancelled", "Cancelled"
        REFUNDED = "refunded", "Refunded"

    order_number = models.CharField(
        max_length=20,
        unique=True,
        default=generate_order_number,
        editable=False,
    )
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="orders")
    member = models.ForeignKey(
        Member, on_delete=models.PROTECT, related_name="orders", null=True, blank=True
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    currency = models.CharField(max_length=3, default="EUR")
    subtotal = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    tax_total = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    stripe_payment_intent_id = EncryptedCharField(max_length=255, blank=True)
    stripe_checkout_session_id = EncryptedCharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return str(self.order_number)


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    license = models.ForeignKey(
        License, on_delete=models.PROTECT, related_name="order_items"
    )
    price_snapshot = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.PositiveIntegerField(default=1)  # type: ignore[arg-type]

    def __str__(self) -> str:
        return f"{self.order} - {self.license}"


class Invoice(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ISSUED = "issued", "Issued"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    invoice_number = models.CharField(
        max_length=20,
        unique=True,
        default=generate_invoice_number,
        editable=False,
    )
    order = models.OneToOneField(
        Order, on_delete=models.PROTECT, related_name="invoice"
    )
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="invoices")
    member = models.ForeignKey(
        Member, on_delete=models.PROTECT, related_name="invoices", null=True, blank=True
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    currency = models.CharField(max_length=3, default="EUR")
    subtotal = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    tax_total = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    stripe_invoice_id = EncryptedCharField(max_length=255, blank=True)
    stripe_customer_id = EncryptedCharField(max_length=255, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return str(self.invoice_number)


class FinanceAuditLog(models.Model):
    action = models.CharField(max_length=100)
    message = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finance_audit_logs",
    )
    club = models.ForeignKey(
        Club, on_delete=models.SET_NULL, null=True, blank=True, related_name="finance_logs"
    )
    member = models.ForeignKey(
        Member, on_delete=models.SET_NULL, null=True, blank=True, related_name="finance_logs"
    )
    license = models.ForeignKey(
        License, on_delete=models.SET_NULL, null=True, blank=True, related_name="finance_logs"
    )
    order = models.ForeignKey(
        Order, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.action} - {self.created_at:%Y-%m-%d}"
