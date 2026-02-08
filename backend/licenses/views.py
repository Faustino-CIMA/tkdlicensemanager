from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from drf_spectacular.utils import extend_schema
import stripe
from rest_framework import permissions, status, viewsets, mixins
from rest_framework.decorators import action
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from django.http import HttpResponse
from rest_framework.status import HTTP_400_BAD_REQUEST
from rest_framework.views import APIView

from accounts.permissions import (
    IsClubAdmin,
    IsLtfAdmin,
    IsLtfFinance,
    IsLtfFinanceOrLtfAdmin,
)

from members.models import Member

from .models import (
    FinanceAuditLog,
    Invoice,
    License,
    LicensePrice,
    LicenseType,
    Order,
    OrderItem,
    get_default_license_type,
)
from .serializers import (
    ActivateLicensesSerializer,
    CheckoutSessionSerializer,
    CheckoutSessionRequestSerializer,
    ConfirmPaymentSerializer,
    FinanceAuditLogSerializer,
    InvoiceSerializer,
    LicensePriceSerializer,
    LicenseSerializer,
    LicenseTypeSerializer,
    ClubOrderBatchSerializer,
    OrderCreateSerializer,
    OrderSerializer,
)
from .pdf_utils import render_invoice_pdf
from .services import apply_payment_and_activate
from .tasks import activate_order_from_stripe, process_stripe_webhook_event

class LicenseViewSet(viewsets.ModelViewSet):
    serializer_class = LicenseSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return License.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return License.objects.none()
        if user.role == "ltf_admin":
            return License.objects.all()
        if user.role in ["club_admin", "coach"]:
            return License.objects.filter(club__admins=user)
        return License.objects.filter(member__user=user)


class LicenseTypeViewSet(viewsets.ModelViewSet):
    serializer_class = LicenseTypeSerializer
    queryset = LicenseType.objects.all().order_by("name")

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [IsLtfAdmin()]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return Response(
                {"detail": "This license type is in use and cannot be deleted."},
                status=HTTP_400_BAD_REQUEST,
            )
        return Response(status=204)


class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Order.objects.none()
        if user.role == "ltf_finance":
            return (
                Order.objects.select_related("club", "member", "invoice")
                .prefetch_related("items__license")
                .all()
            )
        if user.role == "ltf_admin" and self.action in ["confirm_payment", "activate_licenses"]:
            return (
                Order.objects.select_related("club", "member", "invoice")
                .prefetch_related("items__license")
                .all()
            )
        return Order.objects.none()

    def get_permissions(self):
        if self.action in ["confirm_payment", "activate_licenses"]:
            return [IsLtfFinanceOrLtfAdmin()]
        return [IsLtfFinance()]

    def get_serializer_class(self):
        if self.action in ["create", "batch"]:
            return OrderCreateSerializer
        if self.action == "create_checkout_session":
            return CheckoutSessionSerializer
        if self.action == "confirm_payment":
            return ConfirmPaymentSerializer
        if self.action == "activate_licenses":
            return ActivateLicensesSerializer
        return OrderSerializer

    @extend_schema(request=OrderCreateSerializer, responses=OrderSerializer)
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        return Response(
            OrderSerializer(order, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=OrderCreateSerializer(many=True), responses=OrderSerializer(many=True))
    @action(detail=False, methods=["post"], url_path="batch")
    def batch(self, request):
        serializer = OrderCreateSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            orders = serializer.save()
        return Response(
            OrderSerializer(orders, many=True, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=ConfirmPaymentSerializer, responses=OrderSerializer)
    @action(detail=True, methods=["post"], url_path="confirm-payment")
    def confirm_payment(self, request, *args, **kwargs):
        order = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        consent_user = order.member.user if order.member and order.member.user else None
        if consent_user:
            if not consent_user.consent_given:
                return Response(
                    {"detail": "Member consent is required for Stripe processing."},
                    status=HTTP_400_BAD_REQUEST,
                )
        else:
            if not serializer.validated_data.get("club_admin_consent_confirmed"):
                return Response(
                    {"detail": "Club admin consent confirmation is required."},
                    status=HTTP_400_BAD_REQUEST,
                )
        if order.status == Order.Status.PAID:
            return Response(
                {"detail": "Order is already marked as paid."},
                status=HTTP_400_BAD_REQUEST,
            )
        if order.status not in [Order.Status.DRAFT, Order.Status.PENDING]:
            return Response(
                {"detail": "Order cannot be paid in its current status."},
                status=HTTP_400_BAD_REQUEST,
            )

        apply_payment_and_activate(
            order,
            actor=request.user if request.user.is_authenticated else None,
            stripe_data=serializer.validated_data,
        )
        return Response(
            OrderSerializer(order, context=self.get_serializer_context()).data,
            status=status.HTTP_200_OK,
        )

    @extend_schema(request=CheckoutSessionRequestSerializer, responses=CheckoutSessionSerializer)
    @action(detail=True, methods=["post"], url_path="create-checkout-session")
    def create_checkout_session(self, request, *args, **kwargs):
        order = self.get_object()
        request_serializer = CheckoutSessionRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        consent_user = order.member.user if order.member and order.member.user else None
        if consent_user:
            if not consent_user.consent_given:
                return Response(
                    {"detail": "Member consent is required for Stripe processing."},
                    status=HTTP_400_BAD_REQUEST,
                )
        else:
            if not request_serializer.validated_data.get("club_admin_consent_confirmed"):
                return Response(
                    {"detail": "Club admin consent confirmation is required."},
                    status=HTTP_400_BAD_REQUEST,
                )
        if order.status not in [Order.Status.DRAFT, Order.Status.PENDING]:
            return Response(
                {"detail": "Checkout session cannot be created for this order status."},
                status=HTTP_400_BAD_REQUEST,
            )
        if not settings.STRIPE_SECRET_KEY:
            return Response(
                {"detail": "Stripe is not configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        stripe.api_key = settings.STRIPE_SECRET_KEY
        stripe.api_version = settings.STRIPE_API_VERSION

        amount_cents = int(
            (order.total * Decimal("100")).quantize(Decimal("1"))
        )
        customer_email = order.member.email if order.member and order.member.email else None
        invoice = getattr(order, "invoice", None) or Invoice.objects.filter(order=order).first()
        reference_number = invoice.invoice_number if invoice else order.order_number
        session_kwargs = {
            "mode": "payment",
            "success_url": settings.STRIPE_CHECKOUT_SUCCESS_URL,
            "cancel_url": settings.STRIPE_CHECKOUT_CANCEL_URL,
            "client_reference_id": reference_number,
            "payment_intent_data": {
                "metadata": {"order_id": str(order.id)},
            },
            "metadata": {
                "order_id": str(order.id),
                "invoice_number": reference_number,
            },
            "line_items": [
                {
                    "price_data": {
                        "currency": order.currency.lower(),
                        "unit_amount": amount_cents,
                        "product_data": {
                            "name": f"LTF Invoice {reference_number}",
                        },
                    },
                    "quantity": 1,
                }
            ],
        }
        if customer_email:
            session_kwargs["customer_email"] = customer_email

        try:
            session = stripe.checkout.Session.create(
                **session_kwargs,
            )
        except stripe.error.StripeError as exc:  # type: ignore[attr-defined]
            return Response(
                {"detail": str(exc)},
                status=HTTP_400_BAD_REQUEST,
            )

        order_update_fields = []
        session_id_value = session.id if isinstance(session.id, str) else None
        payment_intent_value = (
            session.payment_intent if isinstance(session.payment_intent, str) else None
        )
        if session_id_value and order.stripe_checkout_session_id != session_id_value:
            order.stripe_checkout_session_id = session_id_value
            order_update_fields.append("stripe_checkout_session_id")
        if (
            payment_intent_value
            and order.stripe_payment_intent_id != payment_intent_value
        ):
            order.stripe_payment_intent_id = payment_intent_value
            order_update_fields.append("stripe_payment_intent_id")
        if order_update_fields:
            order_update_fields.append("updated_at")
            order.save(update_fields=order_update_fields)

        return Response(
            CheckoutSessionSerializer(
                {"id": str(session.id), "url": str(session.url)}
            ).data,
            status=status.HTTP_200_OK,
        )

    @extend_schema(request=ActivateLicensesSerializer, responses=OrderSerializer)
    @action(detail=True, methods=["post"], url_path="activate-licenses")
    def activate_licenses(self, request, *args, **kwargs):
        order = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if order.status != Order.Status.PAID:
            return Response(
                {"detail": "Order must be paid before licenses can be activated."},
                status=HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        with transaction.atomic():
            license_status_before = {}
            activated_license_ids = []
            for item in order.items.select_related("license").all():
                license_record = item.license
                license_status_before[license_record.id] = license_record.status
                if license_record.status != License.Status.ACTIVE:
                    license_record.status = License.Status.ACTIVE
                    license_record.issued_at = now
                    license_record.save(update_fields=["status", "issued_at", "updated_at"])
                    activated_license_ids.append(license_record.id)

            FinanceAuditLog.objects.create(
                action="licenses.activated",
                message="Licenses activated manually.",
                actor=request.user if request.user.is_authenticated else None,
                club=order.club,
                member=order.member,
                order=order,
                invoice=getattr(order, "invoice", None),
                metadata={
                    "activated_license_ids": activated_license_ids,
                    "license_status_before": license_status_before,
                },
            )

        return Response(
            OrderSerializer(order, context=self.get_serializer_context()).data,
            status=status.HTTP_200_OK,
        )


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Invoice.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Invoice.objects.none()
        if user.role == "ltf_finance":
            return Invoice.objects.select_related("club", "member", "order").all()
        return Invoice.objects.none()

    def get_permissions(self):
        return [IsLtfFinance()]


class FinanceAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = FinanceAuditLogSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return FinanceAuditLog.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return FinanceAuditLog.objects.none()
        if user.role == "ltf_finance":
            return (
                FinanceAuditLog.objects.select_related(
                    "actor",
                    "club",
                    "member",
                    "license",
                    "order",
                    "invoice",
                )
                .all()
                .order_by("-created_at")
            )
        return FinanceAuditLog.objects.none()

    def get_permissions(self):
        return [IsLtfFinance()]


class ClubOrderViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Order.objects.none()
        if user.role != "club_admin":
            return Order.objects.none()
        queryset = (
            Order.objects.select_related("club", "member", "invoice")
            .prefetch_related("items__license")
            .filter(club__admins=user)
        )
        club_id = self.request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(club_id=club_id)
        return queryset

    def get_permissions(self):
        return [IsClubAdmin()]

    def get_serializer_class(self):
        if self.action == "batch":
            return ClubOrderBatchSerializer
        if self.action == "create_checkout_session":
            return CheckoutSessionSerializer
        return OrderSerializer

    @extend_schema(request=ClubOrderBatchSerializer, responses=OrderSerializer)
    @action(detail=False, methods=["post"], url_path="batch")
    def batch(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        club = serializer.validated_data["club"]
        member_ids = serializer.validated_data["member_ids"]
        year = serializer.validated_data["year"]
        quantity = serializer.validated_data["quantity"]
        tax_total = serializer.validated_data["tax_total"]

        if not club.admins.filter(id=request.user.id).exists():
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        members = Member.objects.filter(id__in=member_ids, club=club)
        if members.count() != len(set(member_ids)):
            return Response(
                {"detail": "One or more members are invalid for this club."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        price = LicensePrice.get_active_price()
        if not price:
            return Response(
                {"detail": "No active license price configured."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        member_count = members.count()
        subtotal = price.amount * quantity * member_count
        total = subtotal + tax_total
        actor = request.user if request.user.is_authenticated else None

        with transaction.atomic():
            order = Order.objects.create(
                club=club,
                member=None,
                status=Order.Status.PENDING,
                currency=price.currency,
                subtotal=subtotal,
                tax_total=tax_total,
                total=total,
            )

            default_license_type_id = get_default_license_type()
            default_license_type = LicenseType.objects.get(pk=default_license_type_id)
            created_license_ids = []
            for member in members:
                license_record = License.objects.create(
                    member=member,
                    club=club,
                    license_type=default_license_type,
                    year=year,
                    status=License.Status.PENDING,
                )
                created_license_ids.append(license_record.id)
                OrderItem.objects.create(
                    order=order,
                    license=license_record,
                    price_snapshot=price.amount,
                    quantity=quantity,
                )

            invoice = Invoice.objects.create(
                order=order,
                club=club,
                member=None,
                status=Invoice.Status.DRAFT,
                currency=price.currency,
                subtotal=subtotal,
                tax_total=tax_total,
                total=total,
            )

            FinanceAuditLog.objects.create(
                action="order.created",
                message="Order created.",
                actor=actor,
                club=club,
                member=None,
                order=order,
                invoice=invoice,
                metadata={
                    "order_status": order.status,
                    "total": str(order.total),
                    "member_ids": member_ids,
                },
            )
            FinanceAuditLog.objects.create(
                action="invoice.created",
                message="Invoice created.",
                actor=actor,
                club=club,
                member=None,
                order=order,
                invoice=invoice,
                metadata={
                    "invoice_status": invoice.status,
                    "total": str(invoice.total),
                    "member_ids": member_ids,
                },
            )
            FinanceAuditLog.objects.create(
                action="licenses.created",
                message="Pending licenses created for batch order.",
                actor=actor,
                club=club,
                member=None,
                order=order,
                invoice=invoice,
                metadata={
                    "license_ids": created_license_ids,
                    "license_status": License.Status.PENDING,
                    "member_ids": member_ids,
                },
            )

        return Response(
            OrderSerializer(order, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(request=CheckoutSessionRequestSerializer, responses=CheckoutSessionSerializer)
    @action(detail=True, methods=["post"], url_path="create-checkout-session")
    def create_checkout_session(self, request, *args, **kwargs):
        order = self.get_object()
        request_serializer = CheckoutSessionRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        if not request_serializer.validated_data.get("club_admin_consent_confirmed"):
            return Response(
                {"detail": "Club admin consent confirmation is required."},
                status=HTTP_400_BAD_REQUEST,
            )
        if order.status not in [Order.Status.DRAFT, Order.Status.PENDING]:
            return Response(
                {"detail": "Checkout session cannot be created for this order status."},
                status=HTTP_400_BAD_REQUEST,
            )
        if not settings.STRIPE_SECRET_KEY:
            return Response(
                {"detail": "Stripe is not configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        stripe.api_key = settings.STRIPE_SECRET_KEY
        stripe.api_version = settings.STRIPE_API_VERSION

        amount_cents = int((order.total * Decimal("100")).quantize(Decimal("1")))
        customer_email = order.member.email if order.member and order.member.email else None
        invoice = getattr(order, "invoice", None) or Invoice.objects.filter(order=order).first()
        reference_number = invoice.invoice_number if invoice else order.order_number
        session_kwargs = {
            "mode": "payment",
            "success_url": settings.STRIPE_CHECKOUT_SUCCESS_URL,
            "cancel_url": settings.STRIPE_CHECKOUT_CANCEL_URL,
            "client_reference_id": reference_number,
            "payment_intent_data": {
                "metadata": {"order_id": str(order.id)},
            },
            "metadata": {
                "order_id": str(order.id),
                "invoice_number": reference_number,
            },
            "line_items": [
                {
                    "price_data": {
                        "currency": order.currency.lower(),
                        "unit_amount": amount_cents,
                        "product_data": {
                            "name": f"LTF Invoice {reference_number}",
                        },
                    },
                    "quantity": 1,
                }
            ],
        }
        if customer_email:
            session_kwargs["customer_email"] = customer_email

        try:
            session = stripe.checkout.Session.create(
                **session_kwargs,
            )
        except stripe.error.StripeError as exc:  # type: ignore[attr-defined]
            return Response(
                {"detail": str(exc)},
                status=HTTP_400_BAD_REQUEST,
            )

        order_update_fields = []
        session_id_value = session.id if isinstance(session.id, str) else None
        payment_intent_value = (
            session.payment_intent if isinstance(session.payment_intent, str) else None
        )
        if session_id_value and order.stripe_checkout_session_id != session_id_value:
            order.stripe_checkout_session_id = session_id_value
            order_update_fields.append("stripe_checkout_session_id")
        if (
            payment_intent_value
            and order.stripe_payment_intent_id != payment_intent_value
        ):
            order.stripe_payment_intent_id = payment_intent_value
            order_update_fields.append("stripe_payment_intent_id")
        if order_update_fields:
            order_update_fields.append("updated_at")
            order.save(update_fields=order_update_fields)

        return Response(
            CheckoutSessionSerializer(
                {"id": str(session.id), "url": str(session.url)}
            ).data,
            status=status.HTTP_200_OK,
        )


class LicensePriceViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet
):
    serializer_class = LicensePriceSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = LicensePrice.objects.all()

    def get_permissions(self):
        return [IsLtfFinanceOrLtfAdmin()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return LicensePrice.objects.none()
        return LicensePrice.objects.all().order_by("-effective_from", "-created_at")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)


class ClubInvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Invoice.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Invoice.objects.none()
        if user.role != "club_admin":
            return Invoice.objects.none()
        queryset = Invoice.objects.select_related("club", "member", "order").filter(
            club__admins=user
        )
        club_id = self.request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(club_id=club_id)
        return queryset

    def get_permissions(self):
        return [IsClubAdmin()]


class InvoicePdfView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, invoice_id):
        invoice = (
            Invoice.objects.select_related("order", "club", "member")
            .prefetch_related("order__items__license")
            .filter(id=invoice_id)
            .first()
        )
        if not invoice:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        user = request.user
        if user.role not in ["ltf_finance", "club_admin"]:
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        if user.role == "club_admin" and not invoice.club.admins.filter(id=user.id).exists():
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        pdf_file = render_invoice_pdf(invoice, base_url=request.build_absolute_uri("/"))
        if not pdf_file:
            return Response(
                {"detail": "PDF generation is not available."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        filename = f"invoice_{invoice.invoice_number}.pdf"
        response = HttpResponse(pdf_file, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        return response


class StripeWebhookView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    @extend_schema(exclude=True)
    def post(self, request, *args, **kwargs):
        payload = request.body
        sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")

        if not settings.STRIPE_WEBHOOK_SECRET:
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        stripe.api_key = settings.STRIPE_SECRET_KEY
        stripe.api_version = settings.STRIPE_API_VERSION

        try:
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=sig_header,
                secret=settings.STRIPE_WEBHOOK_SECRET,
            )
        except (ValueError, stripe.error.SignatureVerificationError):  # type: ignore[attr-defined]
            return Response(status=HTTP_400_BAD_REQUEST)

        event_type = event.get("type")
        data_object = event.get("data", {}).get("object", {}) or {}
        event_payload = {
            "event_type": event_type,
            "metadata": data_object.get("metadata", {}) or {},
            "id": data_object.get("id"),
            "payment_intent": data_object.get("payment_intent"),
            "customer": data_object.get("customer"),
        }
        process_stripe_webhook_event.delay(event_payload)

        return Response(status=status.HTTP_200_OK)
