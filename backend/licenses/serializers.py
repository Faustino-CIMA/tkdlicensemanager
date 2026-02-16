from decimal import Decimal
from datetime import date

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from clubs.models import Club
from members.models import Member

from .history import log_license_created
from .models import (
    FinanceAuditLog,
    Invoice,
    License,
    LicensePrice,
    LicenseType,
    LicenseTypePolicy,
    Order,
    OrderItem,
    Payment,
    get_default_license_type,
)
from .policy import get_or_create_license_type_policy, validate_member_license_order


class LicenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = License
        fields = [
            "id",
            "member",
            "club",
            "license_type",
            "year",
            "start_date",
            "end_date",
            "status",
            "issued_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["start_date", "end_date", "created_at", "updated_at"]


class OrderItemSerializer(serializers.ModelSerializer):
    license = LicenseSerializer(read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "license", "price_snapshot", "quantity"]


class InvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = [
            "id",
            "invoice_number",
            "order",
            "club",
            "member",
            "status",
            "currency",
            "subtotal",
            "tax_total",
            "total",
            "stripe_invoice_id",
            "stripe_customer_id",
            "issued_at",
            "paid_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["invoice_number", "created_at", "updated_at"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    invoice = InvoiceSerializer(read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "order_number",
            "club",
            "member",
            "status",
            "currency",
            "subtotal",
            "tax_total",
            "total",
            "stripe_payment_intent_id",
            "stripe_checkout_session_id",
            "created_at",
            "updated_at",
            "items",
            "invoice",
        ]
        read_only_fields = ["order_number", "created_at", "updated_at"]


class OrderItemCreateSerializer(serializers.Serializer):
    license_type = serializers.PrimaryKeyRelatedField(
        queryset=LicenseType.objects.all(), required=False, allow_null=True
    )
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    price_snapshot = serializers.DecimalField(max_digits=10, decimal_places=2)
    quantity = serializers.IntegerField(min_value=1, default=1)


class OrderCreateSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.all())
    member = serializers.PrimaryKeyRelatedField(
        queryset=Member.objects.all(), allow_null=True, required=False
    )
    currency = serializers.CharField(max_length=3, default="EUR")
    tax_total = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    items = OrderItemCreateSerializer(many=True)

    def validate(self, attrs):
        club = attrs.get("club")
        member = attrs.get("member")
        items = attrs.get("items") or []
        if not items:
            raise serializers.ValidationError({"items": "At least one item is required."})
        if member is None:
            raise serializers.ValidationError({"member": "Member is required to create licenses."})
        if member.club_id != club.id:
            raise serializers.ValidationError(
                {"member": "Member does not belong to the specified club."}
            )

        default_license_type_id = get_default_license_type()
        default_license_type = LicenseType.objects.get(pk=default_license_type_id)
        item_errors = {}
        for index, item in enumerate(items):
            license_type = item.get("license_type") or default_license_type
            try:
                validate_member_license_order(
                    member=member,
                    license_type=license_type,
                    target_year=item["year"],
                )
            except serializers.ValidationError as exc:
                if isinstance(exc.detail, list):
                    item_errors[str(index)] = [str(detail) for detail in exc.detail]
                else:
                    item_errors[str(index)] = [str(exc.detail)]
        if item_errors:
            raise serializers.ValidationError({"items": item_errors})
        return attrs

    def create(self, validated_data):
        club = validated_data["club"]
        member = validated_data["member"]
        currency = validated_data.get("currency", "EUR")
        tax_total = validated_data.get("tax_total", Decimal("0.00"))
        items = validated_data["items"]
        request = self.context.get("request")
        actor = request.user if request and request.user.is_authenticated else None

        subtotal = sum(
            (item["price_snapshot"] * item.get("quantity", 1)) for item in items
        )
        total = subtotal + tax_total

        with transaction.atomic():
            order = Order.objects.create(
                club=club,
                member=member,
                status=Order.Status.PENDING,
                currency=currency,
                subtotal=subtotal,
                tax_total=tax_total,
                total=total,
            )

            default_license_type_id = get_default_license_type()
            default_license_type = LicenseType.objects.get(pk=default_license_type_id)

            created_license_ids = []
            for item in items:
                license_type = item.get("license_type") or default_license_type
                license_record = License.objects.create(
                    member=member,
                    club=club,
                    license_type=license_type,
                    year=item["year"],
                    status=License.Status.PENDING,
                )
                log_license_created(
                    license_record,
                    actor=actor,
                    order=order,
                    reason="License created from order item.",
                    metadata={"source": "order.create"},
                )
                created_license_ids.append(license_record.id)
                OrderItem.objects.create(
                    order=order,
                    license=license_record,
                    price_snapshot=item["price_snapshot"],
                    quantity=item.get("quantity", 1),
                )

            invoice = Invoice.objects.create(
                order=order,
                club=club,
                member=member,
                status=Invoice.Status.DRAFT,
                currency=currency,
                subtotal=subtotal,
                tax_total=tax_total,
                total=total,
            )

            FinanceAuditLog.objects.create(
                action="order.created",
                message="Order created.",
                actor=actor,
                club=club,
                member=member,
                order=order,
                invoice=invoice,
                metadata={
                    "order_status": order.status,
                    "total": str(order.total),
                },
            )
            FinanceAuditLog.objects.create(
                action="invoice.created",
                message="Invoice created.",
                actor=actor,
                club=club,
                member=member,
                order=order,
                invoice=invoice,
                metadata={
                    "invoice_status": invoice.status,
                    "total": str(invoice.total),
                },
            )
            FinanceAuditLog.objects.create(
                action="licenses.created",
                message="Pending licenses created for order.",
                actor=actor,
                club=club,
                member=member,
                order=order,
                invoice=invoice,
                metadata={
                    "license_ids": created_license_ids,
                    "license_status": License.Status.PENDING,
                },
            )

        return order


class ClubOrderBatchSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.all())
    license_type = serializers.PrimaryKeyRelatedField(
        queryset=LicenseType.objects.all(), required=False, allow_null=True
    )
    member_ids = serializers.ListField(
        child=serializers.IntegerField(), min_length=1, allow_empty=False
    )
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    quantity = serializers.IntegerField(min_value=1, default=1)
    tax_total = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )


class ConfirmPaymentSerializer(serializers.Serializer):
    stripe_payment_intent_id = serializers.CharField(max_length=255, required=False)
    stripe_checkout_session_id = serializers.CharField(max_length=255, required=False)
    stripe_invoice_id = serializers.CharField(max_length=255, required=False)
    stripe_customer_id = serializers.CharField(max_length=255, required=False)
    club_admin_consent_confirmed = serializers.BooleanField(required=False, default=False)
    payment_method = serializers.ChoiceField(
        choices=Payment.Method.choices, required=False
    )
    payment_provider = serializers.ChoiceField(
        choices=Payment.Provider.choices, required=False
    )
    payment_reference = serializers.CharField(required=False, allow_blank=True)
    payment_notes = serializers.CharField(required=False, allow_blank=True)
    paid_at = serializers.DateTimeField(required=False)
    card_brand = serializers.CharField(required=False, allow_blank=True)
    card_last4 = serializers.CharField(required=False, allow_blank=True)
    card_exp_month = serializers.IntegerField(required=False)
    card_exp_year = serializers.IntegerField(required=False)


class CheckoutSessionRequestSerializer(serializers.Serializer):
    club_admin_consent_confirmed = serializers.BooleanField(required=False, default=False)


class CheckoutSessionSerializer(serializers.Serializer):
    id = serializers.CharField()
    url = serializers.URLField()


class ActivateLicensesSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True)


class PayconiqPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            "id",
            "invoice",
            "order",
            "amount",
            "currency",
            "method",
            "provider",
            "status",
            "reference",
            "payconiq_payment_id",
            "payconiq_payment_url",
            "payconiq_status",
            "paid_at",
            "created_at",
        ]
        read_only_fields = ["created_at"]


class PayconiqCreateSerializer(serializers.Serializer):
    invoice_id = serializers.IntegerField(required=False)
    order_id = serializers.IntegerField(required=False)

    def validate(self, attrs):
        if not attrs.get("invoice_id") and not attrs.get("order_id"):
            raise serializers.ValidationError(
                {"detail": "Either invoice_id or order_id is required."}
            )
        return attrs


class FinanceAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinanceAuditLog
        fields = [
            "id",
            "action",
            "message",
            "metadata",
            "actor",
            "club",
            "member",
            "license",
            "order",
            "invoice",
            "created_at",
        ]
        read_only_fields = ["created_at"]


class LicensePriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = LicensePrice
        fields = [
            "id",
            "license_type",
            "amount",
            "currency",
            "effective_from",
            "created_by",
            "created_at",
        ]
        read_only_fields = ["created_by", "created_at"]

    def validate_amount(self, value):
        if value < 0:
            raise serializers.ValidationError("Amount cannot be negative.")
        return value


class LicenseTypeSerializer(serializers.ModelSerializer):
    policy = serializers.SerializerMethodField()
    initial_price_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, write_only=True
    )
    initial_price_currency = serializers.CharField(
        max_length=3, required=False, write_only=True, default="EUR"
    )
    initial_price_effective_from = serializers.DateField(required=False, write_only=True)

    class Meta:
        model = LicenseType
        fields = [
            "id",
            "name",
            "code",
            "created_at",
            "updated_at",
            "policy",
            "initial_price_amount",
            "initial_price_currency",
            "initial_price_effective_from",
        ]
        read_only_fields = ["code", "created_at", "updated_at"]

    def validate_name(self, value):
        normalized = value.strip()
        if not normalized:
            raise serializers.ValidationError("Name is required.")
        return normalized

    def create(self, validated_data):
        initial_price_amount = validated_data.pop("initial_price_amount", None)
        initial_price_currency = validated_data.pop("initial_price_currency", "EUR")
        initial_price_effective_from = validated_data.pop("initial_price_effective_from", None)
        name = validated_data["name"]
        code = slugify(name)
        if LicenseType.objects.filter(code=code).exists():
            raise serializers.ValidationError({"name": "A license type with this name already exists."})
        license_type = LicenseType.objects.create(name=name, code=code)
        get_or_create_license_type_policy(license_type)
        if initial_price_amount is not None:
            request = self.context.get("request")
            actor = request.user if request and request.user.is_authenticated else None
            LicensePrice.objects.create(
                license_type=license_type,
                amount=initial_price_amount,
                currency=initial_price_currency,
                effective_from=initial_price_effective_from or timezone.localdate(),
                created_by=actor,
            )
        return license_type

    def update(self, instance, validated_data):
        name = validated_data.get("name", instance.name)
        code = slugify(name)
        if LicenseType.objects.exclude(id=instance.id).filter(code=code).exists():
            raise serializers.ValidationError({"name": "A license type with this name already exists."})
        instance.name = name
        instance.code = code
        instance.save()
        get_or_create_license_type_policy(instance)
        return instance

    def get_policy(self, obj):
        policy = getattr(obj, "policy", None)
        if policy is None:
            policy = LicenseTypePolicy(license_type=obj)
        return LicenseTypePolicySerializer(policy).data

    def validate_initial_price_amount(self, value):
        if value < 0:
            raise serializers.ValidationError("Initial price cannot be negative.")
        return value


class LicenseTypePolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = LicenseTypePolicy
        fields = [
            "id",
            "license_type",
            "allow_current_year_order",
            "current_start_month",
            "current_start_day",
            "current_end_month",
            "current_end_day",
            "allow_next_year_preorder",
            "next_start_month",
            "next_start_day",
            "next_end_month",
            "next_end_day",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        instance = getattr(self, "instance", None)

        def resolved(field_name):
            if field_name in attrs:
                return attrs[field_name]
            return getattr(instance, field_name)

        current_start_month = resolved("current_start_month")
        current_start_day = resolved("current_start_day")
        current_end_month = resolved("current_end_month")
        current_end_day = resolved("current_end_day")
        next_start_month = resolved("next_start_month")
        next_start_day = resolved("next_start_day")
        next_end_month = resolved("next_end_month")
        next_end_day = resolved("next_end_day")

        for label, month_value, day_value in [
            ("current_start", current_start_month, current_start_day),
            ("current_end", current_end_month, current_end_day),
            ("next_start", next_start_month, next_start_day),
            ("next_end", next_end_month, next_end_day),
        ]:
            if month_value < 1 or month_value > 12:
                raise serializers.ValidationError({label: "Month must be between 1 and 12."})
            if day_value < 1 or day_value > 31:
                raise serializers.ValidationError({label: "Day must be between 1 and 31."})
            try:
                date(2024, month_value, day_value)
            except ValueError as exc:
                raise serializers.ValidationError({label: f"Invalid month/day: {exc}"}) from exc

        if (current_start_month, current_start_day) > (current_end_month, current_end_day):
            raise serializers.ValidationError(
                {"current_window": "Current-year window start must be before end."}
            )
        if (next_start_month, next_start_day) > (next_end_month, next_end_day):
            raise serializers.ValidationError(
                {"next_window": "Next-year preorder window start must be before end."}
            )
        return attrs


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            "id",
            "invoice",
            "order",
            "amount",
            "currency",
            "method",
            "provider",
            "status",
            "reference",
            "notes",
            "payconiq_payment_id",
            "payconiq_payment_url",
            "payconiq_status",
            "card_brand",
            "card_last4",
            "card_exp_month",
            "card_exp_year",
            "paid_at",
            "created_by",
            "created_at",
        ]
        read_only_fields = ["created_at"]
