import json
import time
from pathlib import Path

from allauth.account.models import EmailAddress, EmailConfirmationHMAC
from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, response, status, views
from rest_framework.authtoken.models import Token

from members.models import GradePromotionHistory, Member
from members.services import clear_member_profile_picture
from licenses.models import License, LicenseHistoryEvent

from .email_utils import send_password_reset_email
from .models import User
from .serializers import (
    ConsentSerializer,
    DataDeleteResponseSerializer,
    DataExportSerializer,
    DetailResponseSerializer,
    EmptySerializer,
    LoginResponseSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterResponseSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)


def _agent_debug_log(hypothesis_id: str, message: str, data: dict[str, object]) -> None:
    candidate_paths = [
        Path("/home/faustino/Developments/Applications/tkdlicensemanager/.cursor/debug.log"),
        Path("/app/.cursor/debug.log"),
    ]
    payload = {
        "id": f"accounts_{int(time.time() * 1000)}",
        "timestamp": int(time.time() * 1000),
        "runId": "frontend-login-network-v1",
        "hypothesisId": hypothesis_id,
        "location": "backend/accounts/views.py:LoginView",
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
    # region agent log
    print(json.dumps(payload, ensure_ascii=True), flush=True)
    # endregion


@extend_schema(
    request=RegisterSerializer,
    responses=RegisterResponseSerializer,
)
class RegisterView(views.APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

    def post(self, request):
        locale = request.data.get("locale") if isinstance(request.data, dict) else None
        request.confirmation_locale = locale or request.query_params.get("locale")

        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        data.pop("locale", None)

        serializer = RegisterSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        EmailAddress.objects.add_email(
            request, user, user.email, confirm=True, signup=True
        )
        return response.Response(
            {
                "detail": "Check your email to verify your account.",
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )


@extend_schema(
    request=LoginSerializer,
    responses=LoginResponseSerializer,
)
class LoginView(views.APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = LoginSerializer

    def options(self, request, *args, **kwargs):
        _agent_debug_log(
            "H1_H2_H3",
            "Login endpoint OPTIONS request reached backend",
            {
                "path": request.path,
                "origin": request.headers.get("Origin", ""),
                "host": request.get_host(),
                "x_forwarded_proto": request.headers.get("X-Forwarded-Proto", ""),
                "x_forwarded_host": request.headers.get("X-Forwarded-Host", ""),
                "ac_request_method": request.headers.get(
                    "Access-Control-Request-Method", ""
                ),
                "ac_request_headers": request.headers.get(
                    "Access-Control-Request-Headers", ""
                ),
            },
        )
        return super().options(request, *args, **kwargs)

    def post(self, request):
        _agent_debug_log(
            "H1_H2_H4",
            "Login endpoint POST request reached backend",
            {
                "path": request.path,
                "origin": request.headers.get("Origin", ""),
                "referer": request.headers.get("Referer", ""),
                "host": request.get_host(),
                "x_forwarded_proto": request.headers.get("X-Forwarded-Proto", ""),
                "x_forwarded_host": request.headers.get("X-Forwarded-Host", ""),
                "content_type": request.content_type or "",
                "has_username": isinstance(request.data, dict)
                and "username" in request.data,
                "has_password": isinstance(request.data, dict)
                and "password" in request.data,
            },
        )
        serializer = LoginSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except Exception as exc:
            _agent_debug_log(
                "H4",
                "Login serializer validation failed",
                {
                    "exception_type": exc.__class__.__name__,
                    "exception_message": str(exc),
                },
            )
            raise
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        _agent_debug_log(
            "H4",
            "Login request succeeded",
            {
                "user_id": user.id,
                "username_length": len(user.username or ""),
            },
        )
        return response.Response({"token": token.key, "user": UserSerializer(user).data})


@extend_schema(
    request=EmptySerializer,
    responses={status.HTTP_204_NO_CONTENT: None},
)
class LogoutView(views.APIView):
    serializer_class = EmptySerializer

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return response.Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(
    request=EmptySerializer,
    responses=UserSerializer,
)
class MeView(views.APIView):
    serializer_class = EmptySerializer

    def get(self, request):
        return response.Response(UserSerializer(request.user).data)


@extend_schema(
    request=ConsentSerializer,
    responses=UserSerializer,
)
class ConsentView(views.APIView):
    serializer_class = ConsentSerializer

    def post(self, request):
        serializer = ConsentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        consent_given = serializer.validated_data["consent_given"]
        if consent_given:
            request.user.give_consent()
        else:
            request.user.revoke_consent()
        return response.Response(UserSerializer(request.user).data)


@extend_schema(
    request=EmptySerializer,
    responses=DataExportSerializer,
)
class DataExportView(views.APIView):
    serializer_class = EmptySerializer

    def get(self, request):
        member = Member.objects.filter(user=request.user).first()
        licenses = License.objects.filter(member=member).values(
            "id",
            "year",
            "status",
            "start_date",
            "end_date",
        )
        license_history = LicenseHistoryEvent.objects.filter(member=member).values(
            "id",
            "license_id",
            "event_type",
            "event_at",
            "reason",
            "license_year",
            "status_before",
            "status_after",
            "club_name_snapshot",
            "order_id",
            "payment_id",
        )
        grade_history = GradePromotionHistory.objects.filter(member=member).values(
            "id",
            "from_grade",
            "to_grade",
            "promotion_date",
            "exam_date",
            "proof_ref",
            "notes",
            "created_at",
        )
        profile_photo = None
        if member:
            has_photo = bool(member.profile_picture_processed or member.profile_picture_original)
            profile_photo = {
                "has_profile_picture": has_photo,
                "original_url": (
                    request.build_absolute_uri(member.profile_picture_original.url)
                    if member.profile_picture_original
                    else ""
                ),
                "processed_url": (
                    request.build_absolute_uri(member.profile_picture_processed.url)
                    if member.profile_picture_processed
                    else ""
                ),
                "thumbnail_url": (
                    request.build_absolute_uri(member.profile_picture_thumbnail.url)
                    if member.profile_picture_thumbnail
                    else ""
                ),
                "download_url": (
                    request.build_absolute_uri(
                        f"/api/members/{member.id}/profile-picture/download/"
                    )
                    if has_photo
                    else ""
                ),
                "photo_edit_metadata": member.photo_edit_metadata or {},
                "photo_consent_attested_at": member.photo_consent_attested_at,
                "photo_consent_attested_by": member.photo_consent_attested_by_id,
            }
        export = {
            "user": UserSerializer(request.user).data,
            "member": None,
            "profile_photo": profile_photo,
            "licenses": list(licenses),
            "license_history": list(license_history),
            "grade_history": list(grade_history),
        }
        if member:
            export["member"] = {
                "id": member.id,
                "first_name": member.first_name,
                "last_name": member.last_name,
                "belt_rank": member.belt_rank,
                "club_id": member.club_id,
            }
        return response.Response(export)


@extend_schema(
    request=EmptySerializer,
    responses=DataDeleteResponseSerializer,
)
class DataDeleteView(views.APIView):
    serializer_class = EmptySerializer

    def delete(self, request):
        user_id = request.user.id
        member = Member.objects.filter(user=request.user).first()
        with transaction.atomic():
            if member:
                clear_member_profile_picture(member, clear_consent_attestation=True)
                GradePromotionHistory.objects.filter(member=member).update(
                    notes="",
                    proof_ref="",
                    metadata={"anonymized": True},
                )
            request.user.delete()
        return response.Response({"deleted_user_id": user_id}, status=status.HTTP_200_OK)


@extend_schema(
    request=ResendVerificationSerializer,
    responses=DetailResponseSerializer,
)
class ResendVerificationView(views.APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = ResendVerificationSerializer

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        request.confirmation_locale = serializer.validated_data.get("locale")

        email_address = EmailAddress.objects.filter(email__iexact=email).first()
        if email_address and not email_address.verified:
            email_address.send_confirmation(request)

        return response.Response(
            {"detail": "If the email exists, a verification link has been sent."}
        )


@extend_schema(
    request=VerifyEmailSerializer,
    responses=DetailResponseSerializer,
)
class VerifyEmailView(views.APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = VerifyEmailSerializer

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = serializer.validated_data["key"]

        confirmation = EmailConfirmationHMAC.from_key(key)
        if not confirmation:
            return response.Response(
                {"detail": "Invalid or expired verification key."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        confirmation.confirm(request)
        return response.Response({"detail": "Email verified successfully."})


@extend_schema(
    request=PasswordResetRequestSerializer,
    responses=DetailResponseSerializer,
)
class PasswordResetRequestView(views.APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = PasswordResetRequestSerializer

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        locale = (
            serializer.validated_data.get("locale")
            or request.query_params.get("locale")
            or settings.FRONTEND_DEFAULT_LOCALE
        )

        user = User.objects.filter(email__iexact=email).first()
        if user:
            token = PasswordResetTokenGenerator().make_token(user)
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            reset_url = f"{settings.FRONTEND_BASE_URL}/{locale}/reset-password?uid={uid}&token={token}"
            ok, _ = send_password_reset_email(user, reset_url)

        return response.Response(
            {"detail": "If the email exists, a reset link has been sent."}
        )


@extend_schema(
    request=PasswordResetConfirmSerializer,
    responses=DetailResponseSerializer,
)
class PasswordResetConfirmView(views.APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = PasswordResetConfirmSerializer

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uid = serializer.validated_data["uid"]
        token = serializer.validated_data["token"]
        password = serializer.validated_data["password"]

        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return response.Response(
                {"detail": "Invalid or expired reset link."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token_ok = PasswordResetTokenGenerator().check_token(user, token)

        if not token_ok:
            return response.Response(
                {"detail": "Invalid or expired reset link."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(password)
        user.is_email_verified = True
        user.save(update_fields=["password", "is_email_verified"])
        return response.Response({"detail": "Password reset successfully."})


@extend_schema(
    request=EmptySerializer,
    responses=DetailResponseSerializer,
)
class ResendStatusView(views.APIView):
    serializer_class = EmptySerializer

    def get(self, request):
        if not request.user or request.user.role != "ltf_admin":
            return response.Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        api_key = settings.RESEND_API_KEY or ""
        return response.Response(
            {
                "detail": "Resend status",
                "resend_api_key_loaded": bool(api_key),
                "resend_api_key_length": len(api_key),
            }
        )
