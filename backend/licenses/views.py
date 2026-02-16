from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef, Q, Sum
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from drf_spectacular.utils import extend_schema
import stripe
from rest_framework import permissions, serializers, status, viewsets, mixins
from rest_framework.decorators import action
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from django.http import HttpResponse
from rest_framework.status import HTTP_400_BAD_REQUEST, HTTP_403_FORBIDDEN
from rest_framework.views import APIView

from accounts.permissions import (
    IsClubAdmin,
    IsLtfAdmin,
    IsLtfFinance,
    IsLtfFinanceOrLtfAdmin,
)

from clubs.models import Club
from members.models import Member

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
from .history import log_license_created, log_license_status_change
from .serializers import (
    ActivateLicensesSerializer,
    CheckoutSessionSerializer,
    CheckoutSessionRequestSerializer,
    ConfirmPaymentSerializer,
    FinanceAuditLogSerializer,
    InvoiceSerializer,
    LicensePriceSerializer,
    LicenseSerializer,
    LicenseTypePolicySerializer,
    LicenseTypeSerializer,
    ClubOrderBatchSerializer,
    OrderCreateSerializer,
    OrderSerializer,
    PaymentSerializer,
    PayconiqCreateSerializer,
    PayconiqPaymentSerializer,
)
from .pdf_utils import render_invoice_pdf
from .policy import validate_member_license_order
from .services import apply_payment_and_activate
from .tasks import activate_order_from_stripe, process_stripe_webhook_event
from .payconiq import create_payment, get_status


def _to_iso_z(value):
    return value.isoformat().replace("+00:00", "Z")


def _month_bounds(today):
    month_start = today.replace(day=1)
    next_month_start = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_end = next_month_start - timedelta(days=1)
    return month_start, month_end


def _decimal_string(value):
    decimal_value = value if value is not None else Decimal("0.00")
    return f"{decimal_value:.2f}"


def _overview_meta(role):
    now = timezone.now()
    today = timezone.localdate()
    month_start, month_end = _month_bounds(today)
    return {
        "version": "1.0",
        "role": role,
        "generated_at": _to_iso_z(now),
        "period": {
            "today": today.isoformat(),
            "month_start": month_start.isoformat(),
            "month_end": month_end.isoformat(),
            "expiring_window_days": 30,
        },
    }


def _overview_link(label_key, path):
    return {"label_key": label_key, "path": path}


class LicenseViewSet(viewsets.ModelViewSet):
    serializer_class = LicenseSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [IsLtfAdmin()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return License.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return License.objects.none()
        if user.role == "ltf_admin":
            return License.objects.select_related("member", "club", "license_type").all()
        if user.role in ["club_admin", "coach"]:
            return License.objects.select_related("member", "club", "license_type").filter(
                club__admins=user
            )
        return License.objects.select_related("member", "club", "license_type").filter(
            member__user=user
        )

    def perform_create(self, serializer):
        license_record = serializer.save()
        log_license_created(
            license_record,
            actor=self.request.user if self.request.user.is_authenticated else None,
            reason="License created manually.",
            metadata={"source": "license_viewset.create"},
        )

    def perform_update(self, serializer):
        previous_status = serializer.instance.status
        license_record = serializer.save()
        log_license_status_change(
            license_record,
            status_before=previous_status,
            actor=self.request.user if self.request.user.is_authenticated else None,
            reason="License updated manually.",
            metadata={"source": "license_viewset.update"},
        )


class LicenseTypeViewSet(viewsets.ModelViewSet):
    serializer_class = LicenseTypeSerializer
    queryset = LicenseType.objects.select_related("policy").all().order_by("name")

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [IsLtfFinance()]

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

    @action(detail=True, methods=["get", "patch"], url_path="policy")
    def policy(self, request, *args, **kwargs):
        license_type = self.get_object()
        policy, _ = LicenseTypePolicy.objects.get_or_create(license_type=license_type)
        if request.method.lower() == "get":
            return Response(
                LicenseTypePolicySerializer(policy, context=self.get_serializer_context()).data
            )
        serializer = LicenseTypePolicySerializer(
            policy,
            data=request.data,
            partial=True,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)


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
        consent_confirmed = serializer.validated_data.get("club_admin_consent_confirmed", False)
        stripe_processing_requested = bool(
            serializer.validated_data.get("stripe_payment_intent_id")
            or serializer.validated_data.get("stripe_checkout_session_id")
            or serializer.validated_data.get("stripe_invoice_id")
            or serializer.validated_data.get("stripe_customer_id")
            or serializer.validated_data.get("payment_provider") == Payment.Provider.STRIPE
        )
        consent_required = stripe_processing_requested and not (
            consent_user and consent_user.consent_given
        )
        if consent_required and not consent_confirmed:
            return Response(
                {"detail": "Member consent is required for Stripe processing."},
                status=HTTP_400_BAD_REQUEST,
            )
        if consent_required and consent_confirmed:
            FinanceAuditLog.objects.create(
                action="consent.confirmed",
                message="Consent confirmed for Stripe processing.",
                actor=request.user if request.user.is_authenticated else None,
                club=order.club,
                member=order.member,
                order=order,
                invoice=getattr(order, "invoice", None),
                metadata={
                    "source": "confirm_payment",
                    "confirmed_by_role": request.user.role if request.user.is_authenticated else None,
                },
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

        stripe_keys = {
            "stripe_payment_intent_id",
            "stripe_checkout_session_id",
            "stripe_invoice_id",
            "stripe_customer_id",
        }
        stripe_data = {
            key: value
            for key, value in serializer.validated_data.items()
            if key in stripe_keys and value
        }
        payment_details = {
            "payment_method": serializer.validated_data.get("payment_method"),
            "payment_provider": serializer.validated_data.get("payment_provider"),
            "payment_reference": serializer.validated_data.get("payment_reference"),
            "payment_notes": serializer.validated_data.get("payment_notes"),
            "paid_at": serializer.validated_data.get("paid_at"),
            "card_brand": serializer.validated_data.get("card_brand"),
            "card_last4": serializer.validated_data.get("card_last4"),
            "card_exp_month": serializer.validated_data.get("card_exp_month"),
            "card_exp_year": serializer.validated_data.get("card_exp_year"),
        }
        apply_payment_and_activate(
            order,
            actor=request.user if request.user.is_authenticated else None,
            stripe_data=stripe_data,
            payment_details=payment_details,
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
        consent_confirmed = request_serializer.validated_data.get(
            "club_admin_consent_confirmed", False
        )
        consent_user = order.member.user if order.member and order.member.user else None
        if consent_user:
            if not consent_user.consent_given:
                return Response(
                    {"detail": "Member consent is required for Stripe processing."},
                    status=HTTP_400_BAD_REQUEST,
                )
        else:
            if not consent_confirmed:
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
        today = timezone.localdate()
        with transaction.atomic():
            license_status_before = {}
            activated_license_ids = []
            deferred_license_ids = []
            conflict_license_ids = []
            for item in order.items.select_related("license").all():
                license_record = item.license
                license_status_before[license_record.id] = license_record.status
                if license_record.status != License.Status.ACTIVE:
                    if license_record.start_date > today or license_record.end_date < today:
                        deferred_license_ids.append(license_record.id)
                        continue
                    has_conflict = License.objects.filter(
                        member=license_record.member,
                        status=License.Status.ACTIVE,
                    ).exclude(id=license_record.id).exists()
                    if has_conflict:
                        conflict_license_ids.append(license_record.id)
                        continue
                    license_record.status = License.Status.ACTIVE
                    license_record.issued_at = now
                    try:
                        license_record.save(update_fields=["status", "issued_at", "updated_at"])
                    except IntegrityError:
                        conflict_license_ids.append(license_record.id)
                        continue
                    activated_license_ids.append(license_record.id)
                    log_license_status_change(
                        license_record,
                        status_before=license_status_before[license_record.id],
                        actor=request.user if request.user.is_authenticated else None,
                        reason="Licenses activated manually.",
                        order=order,
                        metadata={"source": "order.activate_licenses"},
                    )

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
                    "deferred_license_ids": deferred_license_ids,
                    "conflict_license_ids": conflict_license_ids,
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


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Payment.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Payment.objects.none()
        if user.role != "ltf_finance":
            return Payment.objects.none()
        queryset = Payment.objects.select_related("invoice", "order", "created_by").all()
        invoice_id = self.request.query_params.get("invoice_id")
        if invoice_id:
            queryset = queryset.filter(invoice_id=invoice_id)
        order_id = self.request.query_params.get("order_id")
        if order_id:
            queryset = queryset.filter(order_id=order_id)
        return queryset

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


class LtfAdminOverviewView(APIView):
    permission_classes = [IsLtfAdmin]

    def get(self, request):
        today = timezone.localdate()
        active_members_queryset = Member.objects.filter(is_active=True)
        licenses_queryset = License.objects.all()

        status_counts = {
            row["status"]: row["total"]
            for row in licenses_queryset.values("status").annotate(total=Count("id"))
        }
        active_licenses = int(status_counts.get(License.Status.ACTIVE, 0))
        pending_licenses = int(status_counts.get(License.Status.PENDING, 0))
        expired_licenses = int(status_counts.get(License.Status.EXPIRED, 0))
        revoked_licenses = int(status_counts.get(License.Status.REVOKED, 0))

        has_valid_license_subquery = License.objects.filter(
            member_id=OuterRef("pk"),
            status__in=[License.Status.ACTIVE, License.Status.PENDING],
        )
        active_members_without_valid_license = (
            active_members_queryset.annotate(has_valid_license=Exists(has_valid_license_subquery))
            .filter(has_valid_license=False)
            .count()
        )
        members_missing_ltf_licenseid = active_members_queryset.filter(
            Q(ltf_licenseid__isnull=True) | Q(ltf_licenseid="")
        ).count()
        clubs_without_admin = (
            Club.objects.annotate(admin_count=Count("admins")).filter(admin_count=0).count()
        )
        expiring_in_30_days = licenses_queryset.filter(
            status=License.Status.ACTIVE,
            end_date__gte=today,
            end_date__lte=today + timedelta(days=30),
        ).count()

        active_members_by_club = {
            row["club_id"]: row["total"]
            for row in active_members_queryset.values("club_id").annotate(total=Count("id"))
        }
        active_licenses_by_club = {
            row["club_id"]: row["total"]
            for row in licenses_queryset.filter(status=License.Status.ACTIVE)
            .values("club_id")
            .annotate(total=Count("id"))
        }
        pending_licenses_by_club = {
            row["club_id"]: row["total"]
            for row in licenses_queryset.filter(status=License.Status.PENDING)
            .values("club_id")
            .annotate(total=Count("id"))
        }
        top_clubs = []
        for club in Club.objects.all().values("id", "name"):
            club_id = club["id"]
            top_clubs.append(
                {
                    "club_id": club_id,
                    "club_name": club["name"],
                    "active_members": int(active_members_by_club.get(club_id, 0)),
                    "active_licenses": int(active_licenses_by_club.get(club_id, 0)),
                    "pending_licenses": int(pending_licenses_by_club.get(club_id, 0)),
                }
            )
        top_clubs = sorted(
            top_clubs,
            key=lambda item: (-item["active_members"], item["club_name"]),
        )[:5]

        payload = {
            "meta": _overview_meta("ltf_admin"),
            "cards": {
                "total_clubs": Club.objects.count(),
                "active_members": active_members_queryset.count(),
                "active_licenses": active_licenses,
                "pending_licenses": pending_licenses,
                "expired_licenses": expired_licenses,
                "revoked_licenses": revoked_licenses,
                "expiring_in_30_days": expiring_in_30_days,
                "active_members_without_valid_license": active_members_without_valid_license,
            },
            "action_queue": [
                {
                    "key": "clubs_without_admin",
                    "count": clubs_without_admin,
                    "severity": "warning",
                    "link": _overview_link("LtfAdmin.navClubs", "/dashboard/ltf/clubs"),
                },
                {
                    "key": "members_missing_ltf_licenseid",
                    "count": members_missing_ltf_licenseid,
                    "severity": "info",
                    "link": _overview_link("LtfAdmin.navMembers", "/dashboard/ltf/members"),
                },
                {
                    "key": "members_without_active_or_pending_license",
                    "count": active_members_without_valid_license,
                    "severity": "critical",
                    "link": _overview_link("LtfAdmin.navMembers", "/dashboard/ltf/members"),
                },
            ],
            "distributions": {
                "licenses_by_status": {
                    "active": active_licenses,
                    "pending": pending_licenses,
                    "expired": expired_licenses,
                    "revoked": revoked_licenses,
                }
            },
            "top_clubs": top_clubs,
            "links": {
                "clubs": _overview_link("LtfAdmin.navClubs", "/dashboard/ltf/clubs"),
                "members": _overview_link("LtfAdmin.navMembers", "/dashboard/ltf/members"),
                "licenses": _overview_link("LtfAdmin.navLicenses", "/dashboard/ltf/licenses"),
            },
        }
        return Response(payload, status=status.HTTP_200_OK)


class LtfFinanceOverviewView(APIView):
    permission_classes = [IsLtfFinance]

    def get(self, request):
        today = timezone.localdate()
        month_start, month_end = _month_bounds(today)

        order_counts = Order.objects.aggregate(
            draft=Count("id", filter=Q(status=Order.Status.DRAFT)),
            pending=Count("id", filter=Q(status=Order.Status.PENDING)),
            paid=Count("id", filter=Q(status=Order.Status.PAID)),
            cancelled=Count("id", filter=Q(status=Order.Status.CANCELLED)),
            refunded=Count("id", filter=Q(status=Order.Status.REFUNDED)),
        )
        invoice_counts = Invoice.objects.aggregate(
            draft=Count("id", filter=Q(status=Invoice.Status.DRAFT)),
            issued=Count("id", filter=Q(status=Invoice.Status.ISSUED)),
            paid=Count("id", filter=Q(status=Invoice.Status.PAID)),
            void=Count("id", filter=Q(status=Invoice.Status.VOID)),
        )

        issued_invoices_overdue_7d = Invoice.objects.filter(status=Invoice.Status.ISSUED).filter(
            Q(issued_at__date__lte=today - timedelta(days=7))
            | Q(issued_at__isnull=True, created_at__date__lte=today - timedelta(days=7))
        )
        paid_orders_with_pending_licenses = (
            Order.objects.filter(
                status=Order.Status.PAID,
                items__license__status=License.Status.PENDING,
            )
            .distinct()
            .count()
        )
        failed_or_cancelled_payments_30d = Payment.objects.filter(
            status__in=[Payment.Status.FAILED, Payment.Status.CANCELLED],
            created_at__date__gte=today - timedelta(days=30),
        ).count()

        active_priced_type_ids = set(
            LicensePrice.objects.filter(effective_from__lte=today)
            .values_list("license_type_id", flat=True)
            .distinct()
        )
        total_license_types = LicenseType.objects.count()
        with_active_price = len(active_priced_type_ids)
        missing_active_price = max(total_license_types - with_active_price, 0)

        outstanding_amount = Invoice.objects.filter(status=Invoice.Status.ISSUED).aggregate(
            total=Sum("total")
        )["total"]
        collected_this_month_amount = Payment.objects.filter(
            status=Payment.Status.PAID,
            paid_at__date__gte=month_start,
            paid_at__date__lte=month_end,
        ).aggregate(total=Sum("amount"))["total"]

        currency = (
            Invoice.objects.exclude(currency="")
            .values_list("currency", flat=True)
            .first()
            or Order.objects.exclude(currency="")
            .values_list("currency", flat=True)
            .first()
            or Payment.objects.exclude(currency="")
            .values_list("currency", flat=True)
            .first()
            or "EUR"
        )

        recent_activity = []
        for row in FinanceAuditLog.objects.order_by("-created_at").values(
            "id",
            "created_at",
            "action",
            "message",
            "club_id",
            "order_id",
            "invoice_id",
        )[:10]:
            recent_activity.append(
                {
                    "id": row["id"],
                    "created_at": _to_iso_z(row["created_at"]),
                    "action": row["action"],
                    "message": row["message"],
                    "club_id": row["club_id"],
                    "order_id": row["order_id"],
                    "invoice_id": row["invoice_id"],
                }
            )

        payload = {
            "meta": _overview_meta("ltf_finance"),
            "currency": currency,
            "cards": {
                "received_orders": int((order_counts.get("draft") or 0) + (order_counts.get("pending") or 0)),
                "delivered_orders": int(order_counts.get("paid") or 0),
                "cancelled_orders": int((order_counts.get("cancelled") or 0) + (order_counts.get("refunded") or 0)),
                "issued_invoices_open": int(invoice_counts.get("issued") or 0),
                "paid_invoices": int(invoice_counts.get("paid") or 0),
                "outstanding_amount": _decimal_string(outstanding_amount),
                "collected_this_month_amount": _decimal_string(collected_this_month_amount),
                "pricing_coverage": {
                    "total_license_types": total_license_types,
                    "with_active_price": with_active_price,
                    "missing_active_price": missing_active_price,
                },
            },
            "action_queue": [
                {
                    "key": "issued_invoices_overdue_7d",
                    "count": issued_invoices_overdue_7d.count(),
                    "severity": "critical",
                    "link": _overview_link("LtfFinance.navInvoices", "/dashboard/ltf-finance/invoices"),
                },
                {
                    "key": "license_types_without_active_price",
                    "count": missing_active_price,
                    "severity": "warning",
                    "link": _overview_link(
                        "LtfFinance.navLicenseSettings",
                        "/dashboard/ltf-finance/license-settings",
                    ),
                },
                {
                    "key": "paid_orders_with_pending_licenses",
                    "count": paid_orders_with_pending_licenses,
                    "severity": "warning",
                    "link": _overview_link("LtfFinance.navOrders", "/dashboard/ltf-finance/orders"),
                },
                {
                    "key": "failed_or_cancelled_payments_30d",
                    "count": failed_or_cancelled_payments_30d,
                    "severity": "info",
                    "link": _overview_link("LtfFinance.navPayments", "/dashboard/ltf-finance/payments"),
                },
            ],
            "distributions": {
                "orders_by_status": {
                    "draft": int(order_counts.get("draft") or 0),
                    "pending": int(order_counts.get("pending") or 0),
                    "paid": int(order_counts.get("paid") or 0),
                    "cancelled": int(order_counts.get("cancelled") or 0),
                    "refunded": int(order_counts.get("refunded") or 0),
                },
                "invoices_by_status": {
                    "draft": int(invoice_counts.get("draft") or 0),
                    "issued": int(invoice_counts.get("issued") or 0),
                    "paid": int(invoice_counts.get("paid") or 0),
                    "void": int(invoice_counts.get("void") or 0),
                },
            },
            "recent_activity": recent_activity,
            "links": {
                "orders": _overview_link("LtfFinance.navOrders", "/dashboard/ltf-finance/orders"),
                "invoices": _overview_link("LtfFinance.navInvoices", "/dashboard/ltf-finance/invoices"),
                "payments": _overview_link("LtfFinance.navPayments", "/dashboard/ltf-finance/payments"),
                "license_settings": _overview_link(
                    "LtfFinance.navLicenseSettings",
                    "/dashboard/ltf-finance/license-settings",
                ),
                "audit_log": _overview_link("LtfFinance.navAuditLog", "/dashboard/ltf-finance/audit-log"),
            },
        }
        return Response(payload, status=status.HTTP_200_OK)


class PayconiqPaymentViewSet(viewsets.GenericViewSet):
    serializer_class = PayconiqPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Payment.objects.all()

    def get_permissions(self):
        return [permissions.IsAuthenticated()]

    def _ensure_club_access(self, user, order) -> bool:
        if user.role in ["ltf_finance", "ltf_admin"]:
            return True
        if user.role == "club_admin":
            return order.club.admins.filter(id=user.id).exists()
        return False

    @extend_schema(request=PayconiqCreateSerializer, responses=PayconiqPaymentSerializer)
    @action(detail=False, methods=["post"], url_path="create")
    def create_payment(self, request):
        serializer = PayconiqCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        invoice_id = serializer.validated_data.get("invoice_id")
        order_id = serializer.validated_data.get("order_id")
        invoice = Invoice.objects.filter(id=invoice_id).first() if invoice_id else None
        order = Order.objects.filter(id=order_id).first() if order_id else None

        if not invoice and order:
            invoice = Invoice.objects.filter(order=order).first()

        if not order and invoice:
            order = invoice.order

        if not invoice or not order:
            return Response({"detail": "Invoice or order not found."}, status=HTTP_400_BAD_REQUEST)
        if not self._ensure_club_access(request.user, order):
            return Response({"detail": "Not allowed."}, status=HTTP_403_FORBIDDEN)

        result = create_payment(
            amount=order.total,
            currency=order.currency,
            reference=invoice.invoice_number,
        )

        payment = Payment.objects.create(
            invoice=invoice,
            order=order,
            amount=order.total,
            currency=order.currency,
            method=Payment.Method.OTHER,
            provider=Payment.Provider.PAYCONIQ,
            status=Payment.Status.PENDING,
            reference=invoice.invoice_number,
            payconiq_payment_id=result.payment_id,
            payconiq_payment_url=result.payment_url,
            payconiq_status=result.status,
            created_by=request.user if request.user.is_authenticated else None,
        )

        FinanceAuditLog.objects.create(
            action="payconiq.created",
            message="Payconiq payment created.",
            actor=request.user if request.user.is_authenticated else None,
            club=order.club,
            member=order.member,
            order=order,
            invoice=invoice,
            metadata={"payment_id": payment.payconiq_payment_id},
        )

        return Response(
            PayconiqPaymentSerializer(payment).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(responses=PayconiqPaymentSerializer)
    @action(detail=True, methods=["get"], url_path="status")
    def status(self, request, pk=None):
        payment = self.get_object()
        if not self._ensure_club_access(request.user, payment.order):
            return Response({"detail": "Not allowed."}, status=HTTP_403_FORBIDDEN)
        if payment.provider != Payment.Provider.PAYCONIQ:
            return Response({"detail": "Not a Payconiq payment."}, status=HTTP_400_BAD_REQUEST)

        payment.payconiq_status = get_status(payment_id=payment.payconiq_payment_id)
        payment.save(update_fields=["payconiq_status"])

        return Response(PayconiqPaymentSerializer(payment).data, status=status.HTTP_200_OK)


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
        selected_license_type = serializer.validated_data.get("license_type")
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

        default_license_type = LicenseType.objects.get(pk=get_default_license_type())
        license_type = selected_license_type or default_license_type
        policy_errors = []
        for member in members:
            try:
                validate_member_license_order(
                    member=member,
                    license_type=license_type,
                    target_year=year,
                )
            except serializers.ValidationError as exc:
                if isinstance(exc.detail, list):
                    detail = "; ".join([str(item) for item in exc.detail])
                else:
                    detail = str(exc.detail)
                policy_errors.append(
                    {
                        "member_id": member.id,
                        "member_name": f"{member.first_name} {member.last_name}".strip(),
                        "detail": detail,
                    }
                )
        if policy_errors:
            return Response(
                {
                    "detail": "One or more selected members are not eligible for this order.",
                    "errors": policy_errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        price = LicensePrice.get_active_price(license_type=license_type)
        if not price:
            return Response(
                {
                    "detail": f"No active license price configured for license type '{license_type.name}'."
                },
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

            created_license_ids = []
            for member in members:
                license_record = License.objects.create(
                    member=member,
                    club=club,
                    license_type=license_type,
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
                    "license_type_id": license_type.id,
                    "license_year": year,
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
                    "license_type_id": license_type.id,
                    "license_year": year,
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
                    "license_type_id": license_type.id,
                    "license_year": year,
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
        consent_confirmed = request_serializer.validated_data.get(
            "club_admin_consent_confirmed", False
        )
        consent_user = order.member.user if order.member and order.member.user else None
        is_club_admin = (
            request.user.is_authenticated and request.user.role == "club_admin"
        )
        consent_required = (not is_club_admin) and not (
            consent_user and consent_user.consent_given
        )
        if consent_required and not consent_confirmed:
            return Response(
                {"detail": "Member consent is required for Stripe processing."},
                status=HTTP_400_BAD_REQUEST,
            )
        if consent_required and consent_confirmed:
            FinanceAuditLog.objects.create(
                action="consent.confirmed",
                message="Consent confirmed for Stripe processing.",
                actor=request.user if request.user.is_authenticated else None,
                club=order.club,
                member=order.member,
                order=order,
                invoice=getattr(order, "invoice", None),
                metadata={
                    "source": "club_create_checkout_session",
                    "confirmed_by_role": request.user.role if request.user.is_authenticated else None,
                },
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
        queryset = LicensePrice.objects.select_related("license_type").all().order_by(
            "-effective_from", "-created_at"
        )
        license_type_id = self.request.query_params.get("license_type")
        if license_type_id:
            queryset = queryset.filter(license_type_id=license_type_id)
        return queryset

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
        card_details = {}
        if event_type == "payment_intent.succeeded":
            charges = data_object.get("charges", {}).get("data", [])
            if charges:
                card = charges[0].get("payment_method_details", {}).get("card", {}) or {}
                card_details = {
                    "card_brand": card.get("brand"),
                    "card_last4": card.get("last4"),
                    "card_exp_month": card.get("exp_month"),
                    "card_exp_year": card.get("exp_year"),
                }
        elif event_type == "checkout.session.completed":
            payment_intent_id = data_object.get("payment_intent")
            if payment_intent_id:
                try:
                    payment_intent = stripe.PaymentIntent.retrieve(
                        payment_intent_id,
                        expand=["charges.data.payment_method_details"],
                    )
                    charges = payment_intent.get("charges", {}).get("data", [])
                    if charges:
                        card = (
                            charges[0]
                            .get("payment_method_details", {})
                            .get("card", {})
                            or {}
                        )
                        card_details = {
                            "card_brand": card.get("brand"),
                            "card_last4": card.get("last4"),
                            "card_exp_month": card.get("exp_month"),
                            "card_exp_year": card.get("exp_year"),
                        }
                except stripe.error.StripeError:  # type: ignore[attr-defined]
                    card_details = {}
        event_payload = {
            "event_type": event_type,
            "metadata": data_object.get("metadata", {}) or {},
            "id": data_object.get("id"),
            "payment_intent": data_object.get("payment_intent"),
            "customer": data_object.get("customer"),
            **card_details,
        }
        process_stripe_webhook_event.delay(event_payload)

        return Response(status=status.HTTP_200_OK)
