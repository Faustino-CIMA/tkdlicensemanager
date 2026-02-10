from datetime import date
from decimal import Decimal
from typing import cast
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from .fields import EncryptedCharField
from simple_history.models import HistoricalRecords
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
        REVOKED = "revoked", "Revoked"

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
    history = HistoricalRecords()

    def save(self, *args, **kwargs):
        if not self.start_date or not self.end_date:
            year = cast(int, self.year)
            self.start_date = date(year, 1, 1)
            self.end_date = date(year, 12, 31)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.member} - {self.year}"


class LicenseHistoryEvent(models.Model):
    class EventType(models.TextChoices):
        ISSUED = "issued", "Issued"
        RENEWED = "renewed", "Renewed"
        STATUS_CHANGED = "status_changed", "Status changed"
        EXPIRED = "expired", "Expired"
        REVOKED = "revoked", "Revoked"
        PAYMENT_LINKED = "payment_linked", "Payment linked"

    member = models.ForeignKey(
        Member, on_delete=models.CASCADE, related_name="license_history_events"
    )
    license = models.ForeignKey(
        License, on_delete=models.CASCADE, related_name="history_events"
    )
    club = models.ForeignKey(
        Club,
        on_delete=models.PROTECT,
        related_name="license_history_events",
    )
    order = models.ForeignKey(
        "Order",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="license_history_events",
    )
    payment = models.ForeignKey(
        "Payment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="license_history_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="license_history_events",
    )
    event_type = models.CharField(max_length=30, choices=EventType.choices)
    event_at = models.DateTimeField(default=timezone.now)
    reason = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    license_year = models.PositiveIntegerField()
    status_before = models.CharField(max_length=20, blank=True)
    status_after = models.CharField(max_length=20, blank=True)
    club_name_snapshot = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-event_at", "-id"]
        indexes = [
            models.Index(fields=["member", "-event_at"]),
            models.Index(fields=["license", "-event_at"]),
            models.Index(fields=["event_type", "-event_at"]),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("License history events are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("License history events are immutable.")

    def __str__(self) -> str:
        return f"{self.member} · {self.event_type} · {self.event_at:%Y-%m-%d}"


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


class Payment(models.Model):
    class Method(models.TextChoices):
        CARD = "card", "Card"
        BANK_TRANSFER = "bank_transfer", "Bank transfer"
        CASH = "cash", "Cash"
        OFFLINE = "offline", "Offline"
        OTHER = "other", "Other"

    class Provider(models.TextChoices):
        STRIPE = "stripe", "Stripe"
        PAYCONIQ = "payconiq", "Payconiq"
        PAYPAL = "paypal", "PayPal"
        MANUAL = "manual", "Manual"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="payments"
    )
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    currency = models.CharField(max_length=3, default="EUR")
    method = models.CharField(
        max_length=20, choices=Method.choices, default=Method.OFFLINE
    )
    provider = models.CharField(
        max_length=20, choices=Provider.choices, default=Provider.MANUAL
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reference = models.CharField(max_length=255, blank=True)
    payconiq_payment_id = models.CharField(max_length=255, blank=True)
    payconiq_payment_url = models.URLField(blank=True)
    payconiq_status = models.CharField(max_length=50, blank=True)
    notes = models.TextField(blank=True)
    card_brand = models.CharField(max_length=50, blank=True)
    card_last4 = models.CharField(max_length=4, blank=True)
    card_exp_month = models.PositiveSmallIntegerField(null=True, blank=True)
    card_exp_year = models.PositiveSmallIntegerField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments_recorded",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_at", "-created_at"]

    def __str__(self) -> str:
        return f"{self.invoice} - {self.amount} {self.currency}"


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
