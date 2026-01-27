from allauth.account.models import EmailAddress, EmailConfirmationHMAC
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, response, status, views
from rest_framework.authtoken.models import Token

from members.models import Member
from licenses.models import License

from .models import User
from .serializers import (
    ConsentSerializer,
    DataDeleteResponseSerializer,
    DataExportSerializer,
    DetailResponseSerializer,
    EmptySerializer,
    LoginResponseSerializer,
    LoginSerializer,
    RegisterResponseSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)


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

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
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
        export = {
            "user": UserSerializer(request.user).data,
            "member": None,
            "licenses": list(licenses),
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
