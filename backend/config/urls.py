import json
import time
from pathlib import Path

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from django.views.generic.base import RedirectView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from accounts.views import (
    ConsentView,
    DataDeleteView,
    DataExportView,
    LoginView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    ResendStatusView,
    ResendVerificationView,
    VerifyEmailView,
)
from imports.views import (
    ClubImportConfirmView,
    ClubImportPreviewView,
    MemberImportConfirmView,
    MemberImportPreviewView,
)
from clubs.views import ClubViewSet, FederationProfileView
from licenses.views import (
    ClubInvoiceViewSet,
    ClubOrderViewSet,
    FinanceAuditLogViewSet,
    InvoiceViewSet,
    InvoicePdfView,
    LicensePriceViewSet,
    LicenseTypeViewSet,
    LicenseViewSet,
    LtfAdminOverviewView,
    LtfFinanceOverviewView,
    OrderViewSet,
    PayconiqPaymentViewSet,
    PaymentViewSet,
    StripeWebhookView,
)
from members.views import MemberViewSet

router = DefaultRouter()
router.register(r"clubs", ClubViewSet, basename="club")
router.register(r"members", MemberViewSet, basename="member")
router.register(r"licenses", LicenseViewSet, basename="license")
router.register(r"license-types", LicenseTypeViewSet, basename="license-type")
router.register(r"license-prices", LicensePriceViewSet, basename="license-price")
router.register(r"orders", OrderViewSet, basename="order")
router.register(r"invoices", InvoiceViewSet, basename="invoice")
router.register(r"payments", PaymentViewSet, basename="payment")
router.register(r"payconiq", PayconiqPaymentViewSet, basename="payconiq")
router.register(r"club-orders", ClubOrderViewSet, basename="club-order")
router.register(r"club-invoices", ClubInvoiceViewSet, basename="club-invoice")
router.register(r"finance-audit-logs", FinanceAuditLogViewSet, basename="finance-audit-log")


def _agent_debug_log(hypothesis_id: str, message: str, data: dict[str, object]) -> None:
    candidate_paths = [
        Path("/home/faustino/Developments/Applications/tkdlicensemanager/.cursor/debug.log"),
        Path("/app/.cursor/debug.log"),
    ]
    payload = {
        "id": f"urls_{int(time.time() * 1000)}",
        "timestamp": int(time.time() * 1000),
        "runId": "dockploy-healthcheck",
        "hypothesisId": hypothesis_id,
        "location": "backend/config/urls.py:health_check",
        "message": message,
        "data": data,
    }
    for log_path in candidate_paths:
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
            break
        except OSError:
            continue

def health_check(request):
    # region agent log
    _agent_debug_log(
        "H1_H3",
        "Health endpoint reached",
        {
            "is_secure": request.is_secure(),
            "scheme": request.scheme,
            "host": request.get_host(),
            "x_forwarded_proto": request.META.get("HTTP_X_FORWARDED_PROTO", ""),
            "x_forwarded_host": request.META.get("HTTP_X_FORWARDED_HOST", ""),
        },
    )
    # endregion
    return JsonResponse({"status": "ok"})


schema_view = (
    SpectacularAPIView.as_view(throttle_classes=[])
    if settings.DEBUG
    else SpectacularAPIView.as_view()
)

urlpatterns = [
    path("favicon.ico", RedirectView.as_view(url="/static/favicon.ico", permanent=True)),
    path("admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("api/auth/login/", LoginView.as_view(), name="login"),
    path("api/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/auth/me/", MeView.as_view(), name="me"),
    path("api/auth/consent/", ConsentView.as_view(), name="consent"),
    path("api/auth/data-export/", DataExportView.as_view(), name="data-export"),
    path("api/auth/data-delete/", DataDeleteView.as_view(), name="data-delete"),
    path(
        "api/auth/resend-verification/",
        ResendVerificationView.as_view(),
        name="resend-verification",
    ),
    path("api/auth/verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path("api/auth/resend-status/", ResendStatusView.as_view(), name="resend-status"),
    path("api/auth/password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "api/auth/password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("api/imports/clubs/preview/", ClubImportPreviewView.as_view(), name="import-clubs-preview"),
    path("api/imports/clubs/confirm/", ClubImportConfirmView.as_view(), name="import-clubs-confirm"),
    path("api/imports/members/preview/", MemberImportPreviewView.as_view(), name="import-members-preview"),
    path("api/imports/members/confirm/", MemberImportConfirmView.as_view(), name="import-members-confirm"),
    path("api/federation-profile/", FederationProfileView.as_view(), name="federation-profile"),
    path("api/health/", health_check, name="health-check"),
    path("api/dashboard/overview/ltf-admin/", LtfAdminOverviewView.as_view(), name="overview-ltf-admin"),
    path(
        "api/dashboard/overview/ltf-finance/",
        LtfFinanceOverviewView.as_view(),
        name="overview-ltf-finance",
    ),
    path("api/stripe/webhook/", StripeWebhookView.as_view(), name="stripe-webhook"),
    path("api/invoices/<int:invoice_id>/pdf/", InvoicePdfView.as_view(), name="invoice-pdf"),
    path("api/", include(router.urls)),
    path("api/schema/", schema_view, name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

