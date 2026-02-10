from decimal import Decimal

from django.db import transaction
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
    Order,
    OrderItem,
    Payment,
    get_default_license_type,
)


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
            "amount",
            "currency",
            "effective_from",
            "created_by",
            "created_at",
        ]
        read_only_fields = ["created_by", "created_at"]


class LicenseTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LicenseType
        fields = ["id", "name", "code", "created_at", "updated_at"]
        read_only_fields = ["code", "created_at", "updated_at"]

    def validate_name(self, value):
        normalized = value.strip()
        if not normalized:
            raise serializers.ValidationError("Name is required.")
        return normalized

    def create(self, validated_data):
        name = validated_data["name"]
        code = slugify(name)
        if LicenseType.objects.filter(code=code).exists():
            raise serializers.ValidationError({"name": "A license type with this name already exists."})
        return LicenseType.objects.create(name=name, code=code)

    def update(self, instance, validated_data):
        name = validated_data.get("name", instance.name)
        code = slugify(name)
        if LicenseType.objects.exclude(id=instance.id).filter(code=code).exists():
            raise serializers.ValidationError({"name": "A license type with this name already exists."})
        instance.name = name
        instance.code = code
        instance.save()
        return instance


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
