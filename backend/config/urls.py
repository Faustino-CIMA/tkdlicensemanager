from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from accounts.views import (
    ConsentView,
    DataDeleteView,
    DataExportView,
    LoginView,
    LogoutView,
    MeView,
    RegisterView,
    ResendVerificationView,
    VerifyEmailView,
)
from clubs.views import ClubViewSet
from licenses.views import LicenseViewSet
from members.views import MemberViewSet

router = DefaultRouter()
router.register(r"clubs", ClubViewSet, basename="club")
router.register(r"members", MemberViewSet, basename="member")
router.register(r"licenses", LicenseViewSet, basename="license")

urlpatterns = [
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
    path("api/", include(router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
