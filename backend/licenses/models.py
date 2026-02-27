from datetime import date
from decimal import Decimal
from typing import cast
from uuid import uuid4

from django.conf import settings
from django.core.validators import MinValueValidator
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .fields import EncryptedCharField
from simple_history.models import HistoricalRecords  # pyright: ignore[reportMissingImports]
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


class LicenseTypePolicy(models.Model):
    license_type = models.OneToOneField(
        LicenseType, on_delete=models.CASCADE, related_name="policy"
    )
    allow_current_year_order = models.BooleanField(default=True)  # pyright: ignore[reportArgumentType]
    current_start_month = models.PositiveSmallIntegerField(default=1)  # pyright: ignore[reportArgumentType]
    current_start_day = models.PositiveSmallIntegerField(default=1)  # pyright: ignore[reportArgumentType]
    current_end_month = models.PositiveSmallIntegerField(default=12)  # pyright: ignore[reportArgumentType]
    current_end_day = models.PositiveSmallIntegerField(default=31)  # pyright: ignore[reportArgumentType]
    allow_next_year_preorder = models.BooleanField(default=False)  # pyright: ignore[reportArgumentType]
    next_start_month = models.PositiveSmallIntegerField(default=12)  # pyright: ignore[reportArgumentType]
    next_start_day = models.PositiveSmallIntegerField(default=1)  # pyright: ignore[reportArgumentType]
    next_end_month = models.PositiveSmallIntegerField(default=12)  # pyright: ignore[reportArgumentType]
    next_end_day = models.PositiveSmallIntegerField(default=31)  # pyright: ignore[reportArgumentType]
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.license_type.name} policy"


def get_default_license_type():
    # Kept for historical migrations that reference this callable.
    license_type, _ = LicenseType._default_manager.get_or_create(
        code="paid",
        defaults={"name": "Paid"},
    )
    return cast(LicenseType, license_type).pk


class LicensePrice(models.Model):
    objects = models.Manager()
    license_type = models.ForeignKey(
        LicenseType,
        on_delete=models.PROTECT,
        related_name="prices",
    )
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
        indexes = [
            models.Index(
                fields=["license_type", "-effective_from", "-created_at"],
                name="licprice_type_eff_created_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.license_type.name}: {self.amount} {self.currency} ({self.effective_from})"

    @classmethod
    def get_active_price(cls, *, license_type: LicenseType, as_of=None):
        date_value = as_of or timezone.localdate()
        return (
            cls.objects.filter(license_type=license_type, effective_from__lte=date_value)
            .order_by("-effective_from", "-created_at")
            .first()
        )


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
    )
    year = models.PositiveIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    issued_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    history = HistoricalRecords()

    class Meta:
        indexes = [
            models.Index(fields=["member", "year"], name="lic_member_year_idx"),
            models.Index(fields=["club", "year", "status"], name="lic_club_year_st_idx"),
            models.Index(fields=["status", "end_date"], name="lic_status_end_idx"),
            models.Index(
                fields=["member", "license_type", "year", "status"],
                name="lic_m_ty_yr_st_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["member"],
                condition=Q(status="active"),
                name="unique_active_license_per_member",
            )
        ]

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

    class Meta:
        indexes = [
            models.Index(fields=["status", "-updated_at"], name="ord_status_upd_idx"),
            models.Index(fields=["club", "-created_at"], name="ord_club_created_idx"),
            models.Index(fields=["member", "-created_at"], name="ord_member_created_idx"),
        ]

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

    class Meta:
        indexes = [
            models.Index(fields=["status", "-issued_at"], name="inv_status_issued_idx"),
            models.Index(
                fields=["club", "status", "-issued_at"],
                name="inv_club_status_iss_idx",
            ),
            models.Index(fields=["-paid_at"], name="inv_paid_at_idx"),
        ]

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
        indexes = [
            models.Index(fields=["status", "-created_at"], name="pay_status_created_idx"),
            models.Index(fields=["invoice", "-created_at"], name="pay_invoice_created_idx"),
            models.Index(fields=["order", "-created_at"], name="pay_order_created_idx"),
            models.Index(
                fields=["provider", "status", "-created_at"],
                name="pay_provider_status_idx",
            ),
        ]

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

    class Meta:
        indexes = [
            models.Index(fields=["-created_at"], name="finlog_created_idx"),
            models.Index(
                fields=["action", "-created_at"],
                name="finlog_action_created_idx",
            ),
        ]

    def __str__(self):
        return f"{self.action} - {self.created_at:%Y-%m-%d}"


def generate_print_job_number() -> str:
    return f"PRN-{uuid4().hex[:12].upper()}"


class CardFormatPreset(models.Model):
    code = models.SlugField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    width_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    height_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    is_custom = models.BooleanField(default=False)  # pyright: ignore[reportArgumentType]
    is_active = models.BooleanField(default=True)  # pyright: ignore[reportArgumentType]
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return str(self.name)


class PaperProfile(models.Model):
    code = models.SlugField(max_length=50, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    card_format = models.ForeignKey(
        CardFormatPreset,
        on_delete=models.PROTECT,
        related_name="paper_profiles",
    )
    sheet_width_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    sheet_height_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    card_width_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    card_height_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    margin_top_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    margin_bottom_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    margin_left_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    margin_right_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    horizontal_gap_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    vertical_gap_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    columns = models.PositiveSmallIntegerField(default=1)  # pyright: ignore[reportArgumentType]
    rows = models.PositiveSmallIntegerField(default=1)  # pyright: ignore[reportArgumentType]
    slot_count = models.PositiveSmallIntegerField(default=1)  # pyright: ignore[reportArgumentType]
    is_preset = models.BooleanField(default=False)  # pyright: ignore[reportArgumentType]
    is_active = models.BooleanField(default=True)  # pyright: ignore[reportArgumentType]
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="paper_profiles_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def clean(self):
        super().clean()
        expected_slot_count = int(self.rows) * int(self.columns)
        if expected_slot_count != int(self.slot_count):
            raise ValidationError({"slot_count": "Slot count must equal rows * columns."})

    def __str__(self) -> str:
        return str(self.name)


class CardTemplate(models.Model):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)  # pyright: ignore[reportArgumentType]
    is_active = models.BooleanField(default=True)  # pyright: ignore[reportArgumentType]
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="card_templates_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="card_templates_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["is_default"],
                condition=Q(is_default=True),
                name="unique_default_card_template",
            )
        ]
        ordering = ["name", "-created_at"]

    def __str__(self) -> str:
        return str(self.name)


class CardTemplateVersion(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"

    template = models.ForeignKey(
        CardTemplate,
        on_delete=models.CASCADE,
        related_name="versions",
    )
    version_number = models.PositiveIntegerField()
    label = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    card_format = models.ForeignKey(
        CardFormatPreset,
        on_delete=models.PROTECT,
        related_name="template_versions",
    )
    paper_profile = models.ForeignKey(
        PaperProfile,
        on_delete=models.PROTECT,
        related_name="template_versions",
        null=True,
        blank=True,
    )
    design_payload = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="card_template_versions_created",
    )
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="card_template_versions_published",
    )
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["template_id", "-version_number", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["template", "version_number"],
                name="unique_template_version_number",
            ),
        ]
        indexes = [
            models.Index(fields=["template", "status"], name="tmplv_template_status_idx"),
            models.Index(fields=["status", "-published_at"], name="tmplv_status_published_idx"),
        ]

    def clean(self):
        super().clean()
        if (
            self.paper_profile_id
            and self.card_format_id
            and self.paper_profile.card_format_id != self.card_format_id
        ):
            raise ValidationError(
                {"paper_profile": "Paper profile card format must match template card format."}
            )

    def save(self, *args, **kwargs):
        if self.pk:
            existing = CardTemplateVersion.objects.filter(pk=self.pk).first()
            if (
                existing
                and existing.status == CardTemplateVersion.Status.PUBLISHED
                and self.status == CardTemplateVersion.Status.PUBLISHED
            ):
                immutable_fields = [
                    "template_id",
                    "version_number",
                    "label",
                    "card_format_id",
                    "paper_profile_id",
                    "design_payload",
                    "notes",
                ]
                if any(
                    getattr(existing, field_name) != getattr(self, field_name)
                    for field_name in immutable_fields
                ):
                    raise ValidationError("Published template versions are immutable.")
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.template.name} v{self.version_number}"


class PrintJob(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    job_number = models.CharField(
        max_length=20,
        unique=True,
        default=generate_print_job_number,
        editable=False,
    )
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="print_jobs")
    template_version = models.ForeignKey(
        CardTemplateVersion,
        on_delete=models.PROTECT,
        related_name="print_jobs",
    )
    paper_profile = models.ForeignKey(
        PaperProfile,
        on_delete=models.PROTECT,
        related_name="print_jobs",
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    total_items = models.PositiveIntegerField(default=0)  # pyright: ignore[reportArgumentType]
    selected_slots = models.JSONField(default=list, blank=True)
    include_bleed_guide = models.BooleanField(default=False)  # pyright: ignore[reportArgumentType]
    include_safe_area_guide = models.BooleanField(default=False)  # pyright: ignore[reportArgumentType]
    bleed_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("2.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    safe_area_mm = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("3.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    metadata = models.JSONField(default=dict, blank=True)
    execution_metadata = models.JSONField(default=dict, blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="print_jobs_requested",
    )
    executed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="print_jobs_executed",
    )
    queued_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    execution_attempts = models.PositiveIntegerField(default=0)  # pyright: ignore[reportArgumentType]
    artifact_pdf = models.FileField(upload_to="print_jobs/artifacts/", blank=True)
    artifact_size_bytes = models.PositiveIntegerField(default=0)  # pyright: ignore[reportArgumentType]
    artifact_sha256 = models.CharField(max_length=64, blank=True)
    error_detail = models.TextField(blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["club", "status", "-created_at"], name="prjob_club_status_idx"),
            models.Index(fields=["status", "-created_at"], name="prjob_status_created_idx"),
        ]

    def __str__(self) -> str:
        return str(self.job_number)


class PrintJobItem(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PRINTED = "printed", "Printed"
        FAILED = "failed", "Failed"

    print_job = models.ForeignKey(
        PrintJob,
        on_delete=models.CASCADE,
        related_name="items",
    )
    member = models.ForeignKey(
        Member,
        on_delete=models.PROTECT,
        related_name="print_job_items",
        null=True,
        blank=True,
    )
    license = models.ForeignKey(
        License,
        on_delete=models.PROTECT,
        related_name="print_job_items",
        null=True,
        blank=True,
    )
    quantity = models.PositiveIntegerField(default=1)  # pyright: ignore[reportArgumentType]
    slot_index = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["print_job", "status"], name="pritem_job_status_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["print_job", "slot_index"],
                condition=Q(slot_index__isnull=False),
                name="pritem_unique_nonnull_slot_per_job",
            )
        ]

    def __str__(self) -> str:
        return f"{self.print_job.job_number} item {self.id}"
