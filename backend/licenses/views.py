from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef, Q, Sum
from django.db.models.functions import Coalesce
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
from config.pagination import OptionalPaginationListMixin

from clubs.models import Club
from members.models import Member, MemberTransfer

from .models import (
    Expense,
    ExpenseCategory,
    FinanceAuditLog,
    FinanceYearOpening,
    Income,
    IncomeCategory,
    Invoice,
    License,
    LicensePrice,
    LicenseType,
    LicenseTypePolicy,
    Order,
    OrderItem,
    Payment,
)
from .history import log_license_created, log_license_status_change
from .serializers import (
    ActivateLicensesSerializer,
    ClubOrderEligibilitySerializer,
    CheckoutSessionSerializer,
    CheckoutSessionRequestSerializer,
    ConfirmCheckoutResultSerializer,
    ConfirmCheckoutSessionSerializer,
    ConfirmPaymentSerializer,
    ExpenseCategorySerializer,
    ExpenseSerializer,
    FinanceAuditLogSerializer,
    IncomeCategorySerializer,
    IncomeSerializer,
    FinanceYearOpeningSerializer,
    InvoiceListSerializer,
    InvoiceSerializer,
    LicensePriceSerializer,
    LicenseSerializer,
    LicenseTypePolicySerializer,
    LicenseTypeSerializer,
    ClubOrderBatchSerializer,
    OrderCreateSerializer,
    OrderListSerializer,
    OrderSerializer,
    PaymentSerializer,
    PayconiqCreateSerializer,
    PayconiqPaymentSerializer,
)
from .finance_reports import build_finance_report, render_finance_report_xlsx
from .pdf_utils import render_invoice_pdf
from .policy import (
    describe_license_order_availability,
    get_or_create_license_type_policy,
    validate_member_license_order,
)
from .services import apply_payment_and_activate
from .stripe_checkout import checkout_success_url, fulfill_checkout_session
from .tasks import process_stripe_webhook_event
from .payconiq import PayconiqServiceError, create_payment, get_status


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


def _flatten_validation_detail(detail) -> str:
    if isinstance(detail, list):
        return "; ".join(str(item) for item in detail)
    if isinstance(detail, dict):
        return "; ".join(f"{key}: {value}" for key, value in detail.items())
    return str(detail)


def _map_order_eligibility_reason_code(detail_text: str) -> str:
    normalized = detail_text.lower()
    if "no active license price configured" in normalized:
        return "no_active_price"
    if "ordering current-year licenses is disabled" in normalized:
        return "current_year_disabled"
    if "pre-ordering next-year licenses is disabled" in normalized:
        return "next_year_disabled"
    if "window is closed" in normalized:
        return "window_closed"
    if "only current-year and next-year license orders are allowed" in normalized:
        return "invalid_target_year"
    if "already has a pending or active" in normalized:
        return "duplicate_pending_or_active"
    if "invalid policy" in normalized:
        return "invalid_policy_configuration"
    return "not_eligible"


def _map_payconiq_payment_status(payconiq_status: str | None) -> tuple[str, bool]:
    normalized = (payconiq_status or "").strip().lower()
    if normalized in {"paid", "succeeded", "success", "completed", "settled"}:
        return Payment.Status.PAID, True
    if normalized in {"failed", "error", "declined"}:
        return Payment.Status.FAILED, False
    if normalized in {"cancelled", "canceled", "expired"}:
        return Payment.Status.CANCELLED, False
    return Payment.Status.PENDING, False


def _parse_csv_ints(raw_value: str | None) -> list[int]:
    if not raw_value:
        return []
    values: list[int] = []
    for token in raw_value.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            values.append(int(token))
        except ValueError:
            continue
    return values


def _apply_invoice_issue_filter(queryset, issue):
    if (issue or "").strip() != "overdue_7d":
        return queryset
    overdue_cutoff = timezone.now() - timedelta(days=7)
    return queryset.filter(status=Invoice.Status.ISSUED).filter(
        Q(issued_at__lte=overdue_cutoff)
        | Q(issued_at__isnull=True, created_at__lte=overdue_cutoff)
    )


def _apply_order_issue_filter(queryset, issue):
    if (issue or "").strip() != "paid_pending_licenses":
        return queryset
    return queryset.filter(
        status=Order.Status.PAID,
        items__license__status=License.Status.PENDING,
    ).distinct()


def _apply_payment_issue_filter(queryset, issue):
    if (issue or "").strip() != "failed_or_cancelled_30d":
        return queryset
    thirty_days_ago = timezone.now() - timedelta(days=30)
    return queryset.filter(
        status__in=[Payment.Status.FAILED, Payment.Status.CANCELLED],
        created_at__gte=thirty_days_ago,
    )


class LicenseViewSet(OptionalPaginationListMixin, viewsets.ModelViewSet):
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
            queryset = License.objects.select_related("member", "club", "license_type").all()
        elif user.role in ["club_admin", "coach"]:
            queryset = License.objects.select_related("member", "club", "license_type").filter(
                club__admins=user
            )
        else:
            queryset = License.objects.select_related("member", "club", "license_type").filter(
                member__user=user
            )

        club_id = self.request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(club_id=club_id)

        member_id = self.request.query_params.get("member_id")
        if member_id:
            queryset = queryset.filter(member_id=member_id)

        member_ids = _parse_csv_ints(self.request.query_params.get("member_ids"))
        if member_ids:
            queryset = queryset.filter(member_id__in=member_ids)
        elif self.request.query_params.get("member_ids", "").strip():
            queryset = queryset.none()

        ids = _parse_csv_ints(self.request.query_params.get("ids"))
        if ids:
            queryset = queryset.filter(id__in=ids)
        elif self.request.query_params.get("ids", "").strip():
            queryset = queryset.none()

        license_type_ids = _parse_csv_ints(self.request.query_params.get("license_type_ids"))
        if license_type_ids:
            queryset = queryset.filter(license_type_id__in=license_type_ids)
        elif self.request.query_params.get("license_type_ids", "").strip():
            queryset = queryset.none()

        year_param = self.request.query_params.get("year")
        if year_param:
            try:
                queryset = queryset.filter(year=int(year_param))
            except (TypeError, ValueError):
                queryset = queryset.none()

        status_param = self.request.query_params.get("status")
        if status_param:
            statuses = [value.strip() for value in status_param.split(",") if value.strip()]
            queryset = queryset.filter(status__in=statuses)

        search_value = self.request.query_params.get("q", "").strip()
        if search_value:
            search_filter = (
                Q(member__first_name__icontains=search_value)
                | Q(member__last_name__icontains=search_value)
                | Q(member__ltf_licenseid__icontains=search_value)
                | Q(license_type__name__icontains=search_value)
                | Q(license_type__code__icontains=search_value)
                | Q(status__icontains=search_value)
            )
            if search_value.isdigit():
                search_filter = search_filter | Q(year=int(search_value))
            queryset = queryset.filter(search_filter)

        return queryset.order_by("-year", "-created_at")

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


class OrderViewSet(OptionalPaginationListMixin, viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _base_queryset(self):
        queryset = (
            Order.objects.select_related("club", "member", "invoice")
            .annotate(item_quantity=Coalesce(Sum("items__quantity"), 0))
        )
        if self.action != "list":
            queryset = queryset.prefetch_related("items__license__member")
        return queryset

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Order.objects.none()
        if user.role == "ltf_finance":
            queryset = self._base_queryset()

            club_id = self.request.query_params.get("club_id")
            if club_id:
                queryset = queryset.filter(club_id=club_id)

            member_id = self.request.query_params.get("member_id")
            if member_id:
                queryset = queryset.filter(member_id=member_id)

            status_param = self.request.query_params.get("status")
            if status_param:
                statuses = [value.strip() for value in status_param.split(",") if value.strip()]
                queryset = queryset.filter(status__in=statuses)

            year_param = self.request.query_params.get("year")
            if year_param:
                try:
                    queryset = queryset.filter(created_at__year=int(year_param))
                except (TypeError, ValueError):
                    queryset = queryset.none()

            ids = _parse_csv_ints(self.request.query_params.get("ids"))
            if ids:
                queryset = queryset.filter(id__in=ids)

            search_value = self.request.query_params.get("q", "").strip()
            if search_value:
                queryset = queryset.filter(
                    Q(order_number__icontains=search_value)
                    | Q(club__name__icontains=search_value)
                    | Q(member__first_name__icontains=search_value)
                    | Q(member__last_name__icontains=search_value)
                    | Q(currency__icontains=search_value)
                )
            queryset = _apply_order_issue_filter(
                queryset, self.request.query_params.get("issue")
            )
            return queryset.order_by("-created_at")
        if user.role == "ltf_admin" and self.action in ["confirm_payment", "activate_licenses"]:
            queryset = self._base_queryset()
            return queryset.order_by("-created_at")
        return Order.objects.none()

    def get_permissions(self):
        if self.action in ["confirm_payment", "activate_licenses"]:
            return [IsLtfFinanceOrLtfAdmin()]
        return [IsLtfFinance()]

    def get_serializer_class(self):
        if self.action == "list":
            return OrderListSerializer
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
            "success_url": checkout_success_url(),
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


class InvoiceViewSet(OptionalPaginationListMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Invoice.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Invoice.objects.none()
        if user.role == "ltf_finance":
            queryset = (
                Invoice.objects.select_related("club", "member", "order")
                .annotate(item_quantity=Coalesce(Sum("order__items__quantity"), 0))
                .all()
            )

            club_id = self.request.query_params.get("club_id")
            if club_id:
                queryset = queryset.filter(club_id=club_id)

            member_id = self.request.query_params.get("member_id")
            if member_id:
                queryset = queryset.filter(member_id=member_id)

            year_param = self.request.query_params.get("year")
            if year_param:
                try:
                    queryset = queryset.filter(created_at__year=int(year_param))
                except (TypeError, ValueError):
                    queryset = queryset.none()

            status_param = self.request.query_params.get("status")
            if status_param:
                statuses = [value.strip() for value in status_param.split(",") if value.strip()]
                queryset = queryset.filter(status__in=statuses)

            ids = _parse_csv_ints(self.request.query_params.get("ids"))
            if ids:
                queryset = queryset.filter(id__in=ids)

            search_value = self.request.query_params.get("q", "").strip()
            if search_value:
                queryset = queryset.filter(
                    Q(invoice_number__icontains=search_value)
                    | Q(status__icontains=search_value)
                    | Q(club__name__icontains=search_value)
                    | Q(member__first_name__icontains=search_value)
                    | Q(member__last_name__icontains=search_value)
                    | Q(order__order_number__icontains=search_value)
                    | Q(currency__icontains=search_value)
                )
            queryset = _apply_invoice_issue_filter(
                queryset, self.request.query_params.get("issue")
            )
            return queryset.order_by("-created_at")
        return Invoice.objects.none()

    def get_permissions(self):
        return [IsLtfFinance()]

    def get_serializer_class(self):
        if self.action == "list":
            return InvoiceListSerializer
        return InvoiceSerializer

    @action(detail=False, methods=["get"], url_path="totals")
    def totals(self, request):
        queryset = Invoice.objects.all()
        club_id = request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(club_id=club_id)
        search_value = request.query_params.get("q", "").strip()
        if search_value:
            queryset = queryset.filter(
                Q(invoice_number__icontains=search_value)
                | Q(status__icontains=search_value)
                | Q(club__name__icontains=search_value)
                | Q(member__first_name__icontains=search_value)
                | Q(member__last_name__icontains=search_value)
                | Q(order__order_number__icontains=search_value)
                | Q(currency__icontains=search_value)
            )
        issued = queryset.filter(status=Invoice.Status.ISSUED)
        outstanding = issued.aggregate(total=Sum("total"))["total"]
        currency = issued.values_list("currency", flat=True).first() or "EUR"
        return Response(
            {
                "outstanding_amount": _decimal_string(outstanding),
                "currency": currency,
            }
        )


class PaymentViewSet(OptionalPaginationListMixin, viewsets.ReadOnlyModelViewSet):
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
        queryset = Payment.objects.select_related(
            "invoice", "order", "order__club", "created_by"
        ).all()

        club_id = self.request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(order__club_id=club_id)

        invoice_id = self.request.query_params.get("invoice_id")
        if invoice_id:
            queryset = queryset.filter(invoice_id=invoice_id)
        order_id = self.request.query_params.get("order_id")
        if order_id:
            queryset = queryset.filter(order_id=order_id)

        year_param = self.request.query_params.get("year")
        if year_param:
            try:
                queryset = queryset.filter(created_at__year=int(year_param))
            except (TypeError, ValueError):
                queryset = queryset.none()

        status_param = self.request.query_params.get("status")
        if status_param:
            statuses = [value.strip() for value in status_param.split(",") if value.strip()]
            queryset = queryset.filter(status__in=statuses)

        ids = _parse_csv_ints(self.request.query_params.get("ids"))
        if ids:
            queryset = queryset.filter(id__in=ids)

        search_value = self.request.query_params.get("q", "").strip()
        if search_value:
            queryset = queryset.filter(
                Q(reference__icontains=search_value)
                | Q(status__icontains=search_value)
                | Q(method__icontains=search_value)
                | Q(provider__icontains=search_value)
                | Q(invoice__invoice_number__icontains=search_value)
                | Q(order__order_number__icontains=search_value)
                | Q(order__club__name__icontains=search_value)
            )
        queryset = _apply_payment_issue_filter(
            queryset, self.request.query_params.get("issue")
        )
        return queryset.order_by("-created_at")

    def get_permissions(self):
        return [IsLtfFinance()]


class FinanceAuditLogViewSet(OptionalPaginationListMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = FinanceAuditLogSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return FinanceAuditLog.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return FinanceAuditLog.objects.none()
        if user.role == "ltf_finance":
            queryset = (
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
            search_value = self.request.query_params.get("q", "").strip()
            if search_value:
                queryset = queryset.filter(
                    Q(action__icontains=search_value)
                    | Q(message__icontains=search_value)
                )
            return queryset
        return FinanceAuditLog.objects.none()

    def get_permissions(self):
        return [IsLtfFinance()]


class LtfAdminOverviewView(APIView):
    permission_classes = [IsLtfAdmin]

    def get(self, request):
        cache_key = "dashboard:overview:ltf_admin:v4"
        cached_payload = cache.get(cache_key)
        if cached_payload is not None:
            return Response(cached_payload, status=status.HTTP_200_OK)

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
        paid_pending_transfers = MemberTransfer.objects.filter(
            status=MemberTransfer.Status.PENDING,
            fee_amount__gt=0,
        ).count()
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
                    "link": _overview_link(
                        "LtfAdmin.navClubAdmins",
                        "/dashboard/ltf/club-admins?issue=no_admin",
                    ),
                },
                {
                    "key": "paid_pending_transfers",
                    "count": paid_pending_transfers,
                    "severity": "warning",
                    "link": _overview_link(
                        "LtfAdmin.navMemberTransfers", "/dashboard/ltf/member-transfers"
                    ),
                },
                {
                    "key": "members_missing_ltf_licenseid",
                    "count": members_missing_ltf_licenseid,
                    "severity": "info",
                    "link": _overview_link(
                        "LtfAdmin.navMembers",
                        "/dashboard/ltf/members?issue=missing_ltf_licenseid",
                    ),
                },
                {
                    "key": "members_without_active_or_pending_license",
                    "count": active_members_without_valid_license,
                    "severity": "critical",
                    "link": _overview_link(
                        "LtfAdmin.navMembers",
                        "/dashboard/ltf/members?issue=no_valid_license",
                    ),
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
        cache.set(
            cache_key,
            payload,
            timeout=settings.DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS,
        )
        return Response(payload, status=status.HTTP_200_OK)


class LtfFinanceOverviewView(APIView):
    permission_classes = [IsLtfFinance]

    def get(self, request):
        cache_key = "dashboard:overview:ltf_finance:v4"
        cached_payload = cache.get(cache_key)
        if cached_payload is not None:
            return Response(cached_payload, status=status.HTTP_200_OK)

        today = timezone.localdate()
        month_start, month_end = _month_bounds(today)
        now = timezone.now()
        overdue_cutoff = now - timedelta(days=7)
        thirty_days_ago = now - timedelta(days=30)
        month_start_dt = timezone.make_aware(datetime.combine(month_start, time.min))
        next_month_start_dt = timezone.make_aware(
            datetime.combine(month_end + timedelta(days=1), time.min)
        )

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
            Q(issued_at__lte=overdue_cutoff)
            | Q(issued_at__isnull=True, created_at__lte=overdue_cutoff)
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
            created_at__gte=thirty_days_ago,
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
            paid_at__gte=month_start_dt,
            paid_at__lt=next_month_start_dt,
        ).aggregate(total=Sum("amount"))["total"]
        other_income_this_year = Income.objects.filter(
            status=Income.Status.RECEIVED,
            income_date__year=today.year,
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
        for log in FinanceAuditLog.objects.select_related("club", "order", "invoice").order_by(
            "-created_at"
        )[:10]:
            recent_activity.append(
                {
                    "id": log.id,
                    "created_at": _to_iso_z(log.created_at),
                    "action": log.action,
                    "message": log.message,
                    "club_id": log.club_id,
                    "club_name": log.club.name if log.club_id else None,
                    "order_id": log.order_id,
                    "order_number": log.order.order_number if log.order_id else None,
                    "invoice_id": log.invoice_id,
                    "invoice_number": log.invoice.invoice_number if log.invoice_id else None,
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
                "other_income_this_year": _decimal_string(other_income_this_year),
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
                    "link": _overview_link(
                        "LtfFinance.navInvoices",
                        "/dashboard/ltf-finance/invoices?issue=overdue_7d",
                    ),
                },
                {
                    "key": "license_types_without_active_price",
                    "count": missing_active_price,
                    "severity": "warning",
                    "link": _overview_link(
                        "LtfFinance.navLicenseSettings",
                        "/dashboard/ltf-finance/license-settings?issue=missing_price",
                    ),
                },
                {
                    "key": "paid_orders_with_pending_licenses",
                    "count": paid_orders_with_pending_licenses,
                    "severity": "warning",
                    "link": _overview_link(
                        "LtfFinance.navOrders",
                        "/dashboard/ltf-finance/orders?issue=paid_pending_licenses",
                    ),
                },
                {
                    "key": "failed_or_cancelled_payments_30d",
                    "count": failed_or_cancelled_payments_30d,
                    "severity": "info",
                    "link": _overview_link(
                        "LtfFinance.navPayments",
                        "/dashboard/ltf-finance/payments?issue=failed_or_cancelled_30d",
                    ),
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
        cache.set(
            cache_key,
            payload,
            timeout=settings.DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS,
        )
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

        try:
            result = create_payment(
                amount=order.total,
                currency=order.currency,
                reference=invoice.invoice_number,
            )
        except PayconiqServiceError as exc:
            return Response({"detail": str(exc)}, status=exc.status_code)

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

        try:
            payment.payconiq_status = get_status(payment_id=payment.payconiq_payment_id)
        except PayconiqServiceError as exc:
            return Response({"detail": str(exc)}, status=exc.status_code)
        mapped_status, should_finalize_order = _map_payconiq_payment_status(
            payment.payconiq_status
        )

        payment_update_fields = ["payconiq_status"]
        if payment.status != mapped_status:
            payment.status = mapped_status
            payment_update_fields.append("status")
        if mapped_status == Payment.Status.PAID and payment.paid_at is None:
            payment.paid_at = timezone.now()
            payment_update_fields.append("paid_at")
        payment.save(update_fields=payment_update_fields)

        if should_finalize_order:
            apply_payment_and_activate(
                payment.order,
                actor=request.user if request.user.is_authenticated else None,
                payment_details={
                    "payment_method": payment.method,
                    "payment_provider": payment.provider,
                    "payment_reference": payment.reference,
                    "payment_notes": payment.notes,
                    "paid_at": payment.paid_at or timezone.now(),
                },
                message="Payconiq payment confirmed and licenses activated.",
            )
            payment.refresh_from_db()

        return Response(PayconiqPaymentSerializer(payment).data, status=status.HTTP_200_OK)


class ClubOrderViewSet(OptionalPaginationListMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _base_queryset(self):
        queryset = (
            Order.objects.select_related("club", "member", "invoice")
            .annotate(item_quantity=Coalesce(Sum("items__quantity"), 0))
            .filter(club__admins=self.request.user)
        )
        if self.action != "list":
            queryset = queryset.prefetch_related("items__license__member")
        return queryset

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Order.objects.none()
        if user.role != "club_admin":
            return Order.objects.none()
        queryset = self._base_queryset()
        club_id = self.request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(club_id=club_id)

        member_id = self.request.query_params.get("member_id")
        if member_id:
            queryset = queryset.filter(member_id=member_id)

        year_param = self.request.query_params.get("year")
        if year_param:
            try:
                queryset = queryset.filter(created_at__year=int(year_param))
            except (TypeError, ValueError):
                queryset = queryset.none()

        status_param = self.request.query_params.get("status")
        if status_param:
            statuses = [value.strip() for value in status_param.split(",") if value.strip()]
            queryset = queryset.filter(status__in=statuses)

        ids = _parse_csv_ints(self.request.query_params.get("ids"))
        if ids:
            queryset = queryset.filter(id__in=ids)

        search_value = self.request.query_params.get("q", "").strip()
        if search_value:
            queryset = queryset.filter(
                Q(order_number__icontains=search_value)
                | Q(club__name__icontains=search_value)
                | Q(member__first_name__icontains=search_value)
                | Q(member__last_name__icontains=search_value)
                | Q(currency__icontains=search_value)
            )
        return queryset.order_by("-created_at")

    def get_permissions(self):
        return [IsClubAdmin()]

    def get_serializer_class(self):
        if self.action == "list":
            return OrderListSerializer
        if self.action == "batch":
            return ClubOrderBatchSerializer
        if self.action == "eligibility":
            return ClubOrderEligibilitySerializer
        if self.action == "create_checkout_session":
            return CheckoutSessionSerializer
        return OrderSerializer

    @extend_schema(request=ClubOrderEligibilitySerializer, responses={200: None})
    @action(detail=False, methods=["post"], url_path="eligibility")
    def eligibility(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        club = serializer.validated_data["club"]
        member_ids = serializer.validated_data["member_ids"]
        year = serializer.validated_data["year"]

        if not club.admins.filter(id=request.user.id).exists():
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        members = list(
            Member.objects.filter(id__in=member_ids, club=club).only(
                "id", "first_name", "last_name"
            )
        )
        if len(members) != len(set(member_ids)):
            return Response(
                {"detail": "One or more members are invalid for this club."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        selected_member_count = len(members)
        today = timezone.localdate()
        member_ids_set = {member.id for member in members}

        license_types = list(LicenseType.objects.select_related("policy").all().order_by("name"))
        license_type_ids = [license_type.id for license_type in license_types]
        active_prices_qs = LicensePrice.objects.filter(
            license_type_id__in=license_type_ids, effective_from__lte=today
        ).order_by("license_type_id", "-effective_from", "-created_at")
        active_price_by_type_id: dict[int, LicensePrice] = {}
        for price in active_prices_qs:
            if price.license_type_id not in active_price_by_type_id:
                active_price_by_type_id[price.license_type_id] = price

        future_prices_qs = LicensePrice.objects.filter(
            license_type_id__in=license_type_ids, effective_from__gt=today
        ).order_by("license_type_id", "effective_from")
        next_price_by_type_id: dict[int, LicensePrice] = {}
        for price in future_prices_qs:
            if price.license_type_id not in next_price_by_type_id:
                next_price_by_type_id[price.license_type_id] = price

        duplicate_rows = License.objects.filter(
            member_id__in=member_ids_set,
            license_type_id__in=license_type_ids,
            year=year,
            status__in=[License.Status.PENDING, License.Status.ACTIVE],
        ).values_list("license_type_id", "member_id", "status")
        duplicate_member_ids_by_type: dict[int, set[int]] = defaultdict(set)
        duplicate_status_by_type_member: dict[tuple[int, int], str] = {}
        status_rank = {License.Status.ACTIVE: 0, License.Status.PENDING: 1}
        for license_type_id, member_id, license_status in duplicate_rows:
            type_id = int(license_type_id)
            member_key = int(member_id)
            duplicate_member_ids_by_type[type_id].add(member_key)
            existing_status = duplicate_status_by_type_member.get((type_id, member_key))
            if existing_status is None or status_rank.get(license_status, 9) < status_rank.get(
                existing_status, 9
            ):
                duplicate_status_by_type_member[(type_id, member_key)] = str(license_status)

        eligible_license_types = []
        ineligible_license_types = []

        for license_type in license_types:
            policy = getattr(license_type, "policy", None) or get_or_create_license_type_policy(
                license_type
            )
            active_price = active_price_by_type_id.get(license_type.id)
            next_price = next_price_by_type_id.get(license_type.id)

            def availability_for(reason_codes: set[str]) -> dict:
                return describe_license_order_availability(
                    policy=policy,
                    target_year=year,
                    order_date=today,
                    reason_codes=reason_codes,
                    next_price_effective_from=next_price.effective_from if next_price else None,
                )

            if not active_price:
                ineligible_members = [
                    {
                        "member_id": member.id,
                        "member_name": f"{member.first_name} {member.last_name}".strip(),
                        "reason_code": "no_active_price",
                        "message": (
                            f"No active license price configured for license type "
                            f"'{license_type.name}'."
                        ),
                    }
                    for member in members
                ]
                ineligible_license_types.append(
                    {
                        "id": license_type.id,
                        "name": license_type.name,
                        "code": license_type.code,
                        "reason_counts": [
                            {
                                "code": "no_active_price",
                                "count": selected_member_count,
                                "message": (
                                    f"No active license price configured for license type "
                                    f"'{license_type.name}'."
                                ),
                            }
                        ],
                        "ineligible_members": ineligible_members,
                        "availability": availability_for({"no_active_price"}),
                    }
                )
                continue

            reason_counts = defaultdict(int)
            ineligible_members = []
            duplicate_member_ids = duplicate_member_ids_by_type.get(license_type.id, set())
            for member in members:
                try:
                    validate_member_license_order(
                        member=member,
                        license_type=license_type,
                        target_year=year,
                        order_date=today,
                        policy=policy,
                        duplicate_exists=member.id in duplicate_member_ids,
                    )
                except serializers.ValidationError as exc:
                    detail_text = _flatten_validation_detail(exc.detail)
                    reason_code = _map_order_eligibility_reason_code(detail_text)
                    reason_counts[(reason_code, detail_text)] += 1
                    ineligible_members.append(
                        {
                            "member_id": member.id,
                            "member_name": f"{member.first_name} {member.last_name}".strip(),
                            "reason_code": reason_code,
                            "message": detail_text,
                            "license_status": duplicate_status_by_type_member.get(
                                (license_type.id, member.id)
                            ),
                        }
                    )

            if reason_counts:
                sorted_reasons = sorted(
                    (
                        {"code": code, "count": count, "message": message}
                        for (code, message), count in reason_counts.items()
                    ),
                    key=lambda item: (-item["count"], item["message"]),
                )
                sorted_members = sorted(
                    ineligible_members,
                    key=lambda item: (
                        item["member_name"].lower(),
                        item["member_id"],
                        item["reason_code"],
                    ),
                )
                ineligible_license_types.append(
                    {
                        "id": license_type.id,
                        "name": license_type.name,
                        "code": license_type.code,
                        "reason_counts": sorted_reasons,
                        "ineligible_members": sorted_members,
                        "availability": availability_for(
                            {reason["code"] for reason in sorted_reasons}
                        ),
                    }
                )
                continue

            eligible_license_types.append(
                {
                    "id": license_type.id,
                    "name": license_type.name,
                    "code": license_type.code,
                    "active_price": {
                        "amount": f"{active_price.amount:.2f}",
                        "currency": active_price.currency,
                        "effective_from": active_price.effective_from.isoformat(),
                    },
                }
            )

        return Response(
            {
                "summary": {
                    "selected_member_count": selected_member_count,
                    "eligible_license_type_count": len(eligible_license_types),
                    "ineligible_license_type_count": len(ineligible_license_types),
                },
                "eligible_license_types": eligible_license_types,
                "ineligible_license_types": ineligible_license_types,
            },
            status=status.HTTP_200_OK,
        )

    @extend_schema(request=ClubOrderBatchSerializer, responses=OrderSerializer)
    @action(detail=False, methods=["post"], url_path="batch")
    def batch(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        club = serializer.validated_data["club"]
        member_ids = serializer.validated_data["member_ids"]
        license_type = serializer.validated_data["license_type"]
        year = serializer.validated_data["year"]
        quantity = serializer.validated_data["quantity"]
        tax_total = serializer.validated_data["tax_total"]

        if not club.admins.filter(id=request.user.id).exists():
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        members = list(
            Member.objects.filter(id__in=member_ids, club=club).only(
                "id", "first_name", "last_name"
            )
        )
        if len(members) != len(set(member_ids)):
            return Response(
                {"detail": "One or more members are invalid for this club."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        member_ids_set = {member.id for member in members}
        policy = get_or_create_license_type_policy(license_type)
        duplicate_member_ids = set(
            License.objects.filter(
                member_id__in=member_ids_set,
                license_type=license_type,
                year=year,
                status__in=[License.Status.PENDING, License.Status.ACTIVE],
            ).values_list("member_id", flat=True)
        )

        policy_errors = []
        for member in members:
            try:
                validate_member_license_order(
                    member=member,
                    license_type=license_type,
                    target_year=year,
                    policy=policy,
                    duplicate_exists=member.id in duplicate_member_ids,
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

        member_count = len(members)
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

            period_start = date(year, 1, 1)
            period_end = date(year, 12, 31)
            pending_licenses = [
                License(
                    member=member,
                    club=club,
                    license_type=license_type,
                    year=year,
                    start_date=period_start,
                    end_date=period_end,
                    status=License.Status.PENDING,
                )
                for member in members
            ]
            created_licenses = License.objects.bulk_create(pending_licenses)
            OrderItem.objects.bulk_create(
                [
                    OrderItem(
                        order=order,
                        license=license_record,
                        price_snapshot=price.amount,
                        quantity=quantity,
                    )
                    for license_record in created_licenses
                ]
            )
            created_license_ids = [
                license_record.id for license_record in created_licenses if license_record.id is not None
            ]
            for license_record in created_licenses:
                if license_record.id is None:
                    continue
                log_license_created(
                    license_record,
                    actor=actor,
                    order=order,
                    reason="License ordered (pending).",
                    metadata={"source": "club_order.batch", "year": year},
                )

            invoice = Invoice.objects.create(
                order=order,
                club=club,
                member=None,
                status=Invoice.Status.ISSUED,
                currency=price.currency,
                subtotal=subtotal,
                tax_total=tax_total,
                total=total,
                issued_at=timezone.now(),
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
            "success_url": checkout_success_url(),
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
    OptionalPaginationListMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
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


class ClubInvoiceViewSet(OptionalPaginationListMixin, viewsets.ReadOnlyModelViewSet):
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
        queryset = (
            Invoice.objects.select_related("club", "member", "order")
            .annotate(item_quantity=Coalesce(Sum("order__items__quantity"), 0))
            .filter(club__admins=user)
        )
        club_id = self.request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(club_id=club_id)

        member_id = self.request.query_params.get("member_id")
        if member_id:
            queryset = queryset.filter(member_id=member_id)

        year_param = self.request.query_params.get("year")
        if year_param:
            try:
                queryset = queryset.filter(created_at__year=int(year_param))
            except (TypeError, ValueError):
                queryset = queryset.none()

        status_param = self.request.query_params.get("status")
        if status_param:
            statuses = [value.strip() for value in status_param.split(",") if value.strip()]
            queryset = queryset.filter(status__in=statuses)

        ids = _parse_csv_ints(self.request.query_params.get("ids"))
        if ids:
            queryset = queryset.filter(id__in=ids)

        search_value = self.request.query_params.get("q", "").strip()
        if search_value:
            queryset = queryset.filter(
                Q(invoice_number__icontains=search_value)
                | Q(status__icontains=search_value)
                | Q(club__name__icontains=search_value)
                | Q(member__first_name__icontains=search_value)
                | Q(member__last_name__icontains=search_value)
                | Q(order__order_number__icontains=search_value)
                | Q(currency__icontains=search_value)
            )
        queryset = _apply_invoice_issue_filter(
            queryset, self.request.query_params.get("issue")
        )
        return queryset.order_by("-created_at")

    def get_permissions(self):
        return [IsClubAdmin()]

    def get_serializer_class(self):
        if self.action == "list":
            return InvoiceListSerializer
        return InvoiceSerializer


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


class ExpenseCategoryViewSet(OptionalPaginationListMixin, viewsets.ModelViewSet):
    serializer_class = ExpenseCategorySerializer
    permission_classes = [IsLtfFinance]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ExpenseCategory.objects.none()
        queryset = ExpenseCategory.objects.all()
        active_param = self.request.query_params.get("active")
        if active_param == "1":
            queryset = queryset.filter(is_active=True)
        return queryset


class ExpenseViewSet(OptionalPaginationListMixin, viewsets.ModelViewSet):
    serializer_class = ExpenseSerializer
    permission_classes = [IsLtfFinance]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Expense.objects.none()
        queryset = Expense.objects.select_related("category", "club", "created_by")
        status_param = self.request.query_params.get("status")
        if status_param:
            statuses = [value.strip() for value in status_param.split(",") if value.strip()]
            queryset = queryset.filter(status__in=statuses)
        year_param = self.request.query_params.get("year")
        if year_param:
            try:
                queryset = queryset.filter(expense_date__year=int(year_param))
            except (TypeError, ValueError):
                queryset = queryset.none()
        category_id = self.request.query_params.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        club_id = self.request.query_params.get("club_id")
        if club_id:
            queryset = queryset.filter(club_id=club_id)
        search_value = self.request.query_params.get("q", "").strip()
        if search_value:
            queryset = queryset.filter(
                Q(expense_number__icontains=search_value)
                | Q(description__icontains=search_value)
                | Q(payee__icontains=search_value)
                | Q(reference__icontains=search_value)
                | Q(category__name__icontains=search_value)
            )
        return queryset.order_by("-expense_date", "-id")

    def perform_create(self, serializer):
        expense = serializer.save(created_by=self.request.user)
        FinanceAuditLog.objects.create(
            action="expense.created",
            message=f"Expense {expense.expense_number} recorded.",
            actor=self.request.user,
            club=expense.club,
            metadata={
                "expense_id": expense.id,
                "expense_number": expense.expense_number,
                "amount": str(expense.amount),
                "status": expense.status,
            },
        )

    def perform_update(self, serializer):
        expense = serializer.save()
        FinanceAuditLog.objects.create(
            action="expense.updated",
            message=f"Expense {expense.expense_number} updated.",
            actor=self.request.user,
            club=expense.club,
            metadata={
                "expense_id": expense.id,
                "expense_number": expense.expense_number,
                "amount": str(expense.amount),
                "status": expense.status,
            },
        )

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        expense = self.get_object()
        if expense.status == Expense.Status.VOID:
            return Response({"detail": "Void expenses cannot be marked paid."}, status=HTTP_400_BAD_REQUEST)
        if expense.status == Expense.Status.PAID:
            return Response(self.get_serializer(expense).data)
        paid_at = request.data.get("paid_at")
        payment_method = request.data.get("payment_method") or expense.payment_method
        reference = request.data.get("reference")
        expense.status = Expense.Status.PAID
        if paid_at:
            parsed = str(paid_at).replace("Z", "+00:00")
            try:
                resolved_paid_at = datetime.fromisoformat(parsed)
            except ValueError:
                resolved_paid_at = timezone.now()
            if timezone.is_naive(resolved_paid_at):
                resolved_paid_at = timezone.make_aware(resolved_paid_at)
            expense.paid_at = resolved_paid_at
        else:
            expense.paid_at = timezone.now()
        if payment_method:
            expense.payment_method = payment_method
        if reference:
            expense.reference = reference
        expense.save()
        FinanceAuditLog.objects.create(
            action="expense.paid",
            message=f"Expense {expense.expense_number} marked paid.",
            actor=request.user,
            club=expense.club,
            metadata={"expense_id": expense.id, "expense_number": expense.expense_number},
        )
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        expense = self.get_object()
        if expense.status == Expense.Status.VOID:
            return Response(self.get_serializer(expense).data)
        expense.status = Expense.Status.VOID
        expense.paid_at = None
        expense.save()
        FinanceAuditLog.objects.create(
            action="expense.voided",
            message=f"Expense {expense.expense_number} voided.",
            actor=request.user,
            club=expense.club,
            metadata={"expense_id": expense.id, "expense_number": expense.expense_number},
        )
        return Response(self.get_serializer(expense).data)


class IncomeCategoryViewSet(OptionalPaginationListMixin, viewsets.ModelViewSet):
    serializer_class = IncomeCategorySerializer
    permission_classes = [IsLtfFinance]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return IncomeCategory.objects.none()
        queryset = IncomeCategory.objects.all()
        active_param = self.request.query_params.get("active")
        if active_param == "1":
            queryset = queryset.filter(is_active=True)
        return queryset


class IncomeViewSet(OptionalPaginationListMixin, viewsets.ModelViewSet):
    serializer_class = IncomeSerializer
    permission_classes = [IsLtfFinance]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Income.objects.none()
        queryset = Income.objects.select_related("category", "club", "created_by")
        status_param = self.request.query_params.get("status")
        if status_param:
            statuses = [value.strip() for value in status_param.split(",") if value.strip()]
            queryset = queryset.filter(status__in=statuses)
        year_param = self.request.query_params.get("year")
        if year_param:
            try:
                queryset = queryset.filter(income_date__year=int(year_param))
            except (TypeError, ValueError):
                queryset = queryset.none()
        category_id = self.request.query_params.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        search_value = self.request.query_params.get("q", "").strip()
        if search_value:
            queryset = queryset.filter(
                Q(income_number__icontains=search_value)
                | Q(description__icontains=search_value)
                | Q(payer__icontains=search_value)
                | Q(reference__icontains=search_value)
                | Q(category__name__icontains=search_value)
            )
        return queryset.order_by("-income_date", "-id")

    def perform_create(self, serializer):
        income = serializer.save(created_by=self.request.user)
        FinanceAuditLog.objects.create(
            action="income.created",
            message=f"Income {income.income_number} recorded.",
            actor=self.request.user,
            club=income.club,
            metadata={
                "income_id": income.id,
                "income_number": income.income_number,
                "amount": str(income.amount),
                "status": income.status,
            },
        )

    def perform_update(self, serializer):
        income = serializer.save()
        FinanceAuditLog.objects.create(
            action="income.updated",
            message=f"Income {income.income_number} updated.",
            actor=self.request.user,
            club=income.club,
            metadata={
                "income_id": income.id,
                "income_number": income.income_number,
                "amount": str(income.amount),
                "status": income.status,
            },
        )

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        income = self.get_object()
        if income.status == Income.Status.VOID:
            return Response(self.get_serializer(income).data)
        income.status = Income.Status.VOID
        income.received_at = None
        income.save()
        FinanceAuditLog.objects.create(
            action="income.voided",
            message=f"Income {income.income_number} voided.",
            actor=request.user,
            club=income.club,
            metadata={"income_id": income.id, "income_number": income.income_number},
        )
        return Response(self.get_serializer(income).data)


class FinanceYearOpeningView(APIView):
    permission_classes = [IsLtfFinance]

    def put(self, request):
        serializer = FinanceYearOpeningSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        opening, _created = FinanceYearOpening.objects.update_or_create(
            year=serializer.validated_data["year"],
            defaults={
                "opening_cash": serializer.validated_data["opening_cash"],
                "notes": serializer.validated_data.get("notes", ""),
                "updated_by": request.user,
            },
        )
        FinanceAuditLog.objects.create(
            action="finance_opening.updated",
            message=f"Opening cash for {opening.year} set to {opening.opening_cash} EUR.",
            actor=request.user,
            metadata={"year": opening.year, "opening_cash": str(opening.opening_cash)},
        )
        return Response(FinanceYearOpeningSerializer(opening).data)


class FinanceReportView(APIView):
    permission_classes = [IsLtfFinance]

    def get(self, request):
        year_param = request.query_params.get("year")
        try:
            year = int(year_param) if year_param else timezone.localdate().year
        except (TypeError, ValueError):
            return Response({"detail": "Enter a valid year."}, status=HTTP_400_BAD_REQUEST)
        if year < 2000 or year > 2100:
            return Response({"detail": "Enter a valid year."}, status=HTTP_400_BAD_REQUEST)
        return Response(build_finance_report(year))


class FinanceReportExportView(APIView):
    permission_classes = [IsLtfFinance]

    def get(self, request):
        year_param = request.query_params.get("year")
        try:
            year = int(year_param) if year_param else timezone.localdate().year
        except (TypeError, ValueError):
            return Response({"detail": "Enter a valid year."}, status=HTTP_400_BAD_REQUEST)
        if year < 2000 or year > 2100:
            return Response({"detail": "Enter a valid year."}, status=HTTP_400_BAD_REQUEST)
        report = build_finance_report(year)
        payload = render_finance_report_xlsx(report)
        filename = f"LTF_financial_report_{year}.xlsx"
        response = HttpResponse(
            payload,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
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


class StripeConfirmCheckoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=ConfirmCheckoutSessionSerializer,
        responses=ConfirmCheckoutResultSerializer,
    )
    def post(self, request, *args, **kwargs):
        serializer = ConfirmCheckoutSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session_id = serializer.validated_data["session_id"].strip()

        try:
            fulfillment = fulfill_checkout_session(session_id, actor=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=HTTP_400_BAD_REQUEST)
        except RuntimeError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except PermissionError:
            return Response({"detail": "Checkout session not found."}, status=status.HTTP_404_NOT_FOUND)
        except stripe.error.StripeError as exc:  # type: ignore[attr-defined]
            return Response({"detail": str(exc)}, status=HTTP_400_BAD_REQUEST)

        order = fulfillment.order
        if order is None:
            return Response({"detail": "Checkout session not found."}, status=status.HTTP_404_NOT_FOUND)

        invoice = fulfillment.invoice
        payload = {
            "status": fulfillment.status,
            "order_id": order.id,
            "invoice_id": invoice.id if invoice else None,
            "order_status": order.status,
            "invoice_status": invoice.status if invoice else None,
        }
        return Response(ConfirmCheckoutResultSerializer(payload).data, status=status.HTTP_200_OK)
