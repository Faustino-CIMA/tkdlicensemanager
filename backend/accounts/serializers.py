from allauth.account.models import EmailAddress
from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "role",
            "is_email_verified",
            "consent_given",
            "consent_given_at",
        ]


class EmptySerializer(serializers.Serializer):
    pass


class RegisterResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()
    user = UserSerializer()


class LoginResponseSerializer(serializers.Serializer):
    token = serializers.CharField()
    user = UserSerializer()


class DetailResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()


class DataDeleteResponseSerializer(serializers.Serializer):
    deleted_user_id = serializers.IntegerField()


class LicenseExportSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    year = serializers.IntegerField()
    status = serializers.CharField()
    start_date = serializers.DateField()
    end_date = serializers.DateField()


class MemberExportSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    belt_rank = serializers.CharField()
    club_id = serializers.IntegerField(allow_null=True, required=False)


class DataExportSerializer(serializers.Serializer):
    user = UserSerializer()
    member = MemberExportSerializer(allow_null=True)
    licenses = LicenseExportSerializer(many=True)
    license_history = serializers.ListSerializer(
        child=serializers.DictField(), required=False
    )
    grade_history = serializers.ListSerializer(
        child=serializers.DictField(), required=False
    )


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            "username",
            "email",
            "password",
            "first_name",
            "last_name",
        ]

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data["email"],
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
            role=User.Roles.MEMBER,
        )
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField()

    def validate(self, attrs):
        user = authenticate(
            username=attrs.get("username"),
            password=attrs.get("password"),
        )
        if not user:
            raise serializers.ValidationError("Invalid credentials")
        is_verified = user.is_email_verified or EmailAddress.objects.filter(
            user=user, verified=True
        ).exists()
        if not is_verified:
            raise serializers.ValidationError("Email address not verified")
        attrs["user"] = user
        return attrs


class ConsentSerializer(serializers.Serializer):
    consent_given = serializers.BooleanField()


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()
    locale = serializers.CharField(required=False)


class VerifyEmailSerializer(serializers.Serializer):
    key = serializers.CharField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    locale = serializers.CharField(required=False)


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField()

    def validate_password(self, value):
        validate_password(value)
        return value
