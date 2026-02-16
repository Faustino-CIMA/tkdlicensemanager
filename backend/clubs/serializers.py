import re

from rest_framework import serializers

from .models import Club, FederationProfile


class ClubSerializer(serializers.ModelSerializer):
    class Meta:
        model = Club
        fields = [
            "id",
            "name",
            "city",
            "address",
            "address_line1",
            "address_line2",
            "postal_code",
            "locality",
            "max_admins",
            "created_by",
            "admins",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def validate_postal_code(self, value):
        return str(value or "").strip()

    def validate(self, attrs):
        attrs = super().validate(attrs)

        if attrs.get("address_line1") in (None, "") and attrs.get("address"):
            attrs["address_line1"] = str(attrs["address"]).strip()
        if attrs.get("locality") in (None, "") and attrs.get("city"):
            attrs["locality"] = str(attrs["city"]).strip()

        if attrs.get("address_line1") not in (None, ""):
            attrs["address"] = str(attrs["address_line1"]).strip()
        if attrs.get("locality") not in (None, ""):
            attrs["city"] = str(attrs["locality"]).strip()

        postal_code = str(
            attrs.get(
                "postal_code",
                getattr(self.instance, "postal_code", ""),
            )
            or ""
        ).strip()
        if postal_code and not re.fullmatch(r"\d{4}", postal_code):
            raise serializers.ValidationError(
                {"postal_code": "Postal code must be 4 digits for Luxembourg."}
            )
        return attrs


class FederationProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = FederationProfile
        fields = [
            "id",
            "name",
            "address_line1",
            "address_line2",
            "postal_code",
            "locality",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate_postal_code(self, value):
        return str(value or "").strip()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        postal_code = str(
            attrs.get(
                "postal_code",
                getattr(self.instance, "postal_code", ""),
            )
            or ""
        ).strip()
        if postal_code and not re.fullmatch(r"\d{4}", postal_code):
            raise serializers.ValidationError(
                {"postal_code": "Postal code must be 4 digits for Luxembourg."}
            )
        return attrs
