import re

from rest_framework import serializers

from .banking import derive_bank_name_from_iban, is_valid_iban, normalize_iban
from .models import BrandingAsset, Club, FederationProfile


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
            "iban",
            "bank_name",
            "max_admins",
            "created_by",
            "admins",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["bank_name", "created_by", "created_at", "updated_at"]

    def validate_postal_code(self, value):
        return str(value or "").strip()

    def validate_iban(self, value):
        normalized = normalize_iban(value)
        if normalized and not is_valid_iban(normalized):
            raise serializers.ValidationError("Enter a valid IBAN.")
        return normalized

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
        if "iban" in attrs:
            attrs["bank_name"] = derive_bank_name_from_iban(attrs["iban"])
        elif attrs.get("iban"):
            attrs["bank_name"] = derive_bank_name_from_iban(attrs["iban"])
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
            "iban",
            "bank_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["bank_name", "created_at", "updated_at"]

    def validate_postal_code(self, value):
        return str(value or "").strip()

    def validate_iban(self, value):
        normalized = normalize_iban(value)
        if normalized and not is_valid_iban(normalized):
            raise serializers.ValidationError("Enter a valid IBAN.")
        return normalized

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
        if "iban" in attrs:
            attrs["bank_name"] = derive_bank_name_from_iban(attrs["iban"])
        elif attrs.get("iban"):
            attrs["bank_name"] = derive_bank_name_from_iban(attrs["iban"])
        return attrs


class BrandingAssetSerializer(serializers.ModelSerializer):
    content_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()

    class Meta:
        model = BrandingAsset
        fields = [
            "id",
            "scope_type",
            "asset_type",
            "usage_type",
            "label",
            "is_selected",
            "file_name",
            "file_size",
            "content_url",
            "created_at",
            "updated_at",
        ]

    def get_file_name(self, obj: BrandingAsset) -> str:
        return str(obj.file.name or "").split("/")[-1]

    def get_file_size(self, obj: BrandingAsset) -> int:
        try:
            return int(obj.file.size)
        except Exception:
            return 0

    def get_content_url(self, obj: BrandingAsset) -> str | None:
        request = self.context.get("request")
        if obj.scope_type == BrandingAsset.ScopeType.CLUB and obj.club_id:
            path = f"/api/clubs/{obj.club_id}/logos/{obj.id}/content/"
        elif (
            obj.scope_type == BrandingAsset.ScopeType.FEDERATION
            and obj.federation_profile_id
        ):
            path = f"/api/federation-profile/logos/{obj.id}/content/"
        else:
            return None
        return request.build_absolute_uri(path) if request else path


class BrandingAssetCreateSerializer(serializers.Serializer):
    file = serializers.FileField()
    usage_type = serializers.ChoiceField(
        choices=BrandingAsset.UsageType.choices,
        default=BrandingAsset.UsageType.GENERAL,
        required=False,
    )
    label = serializers.CharField(max_length=120, required=False, allow_blank=True)
    is_selected = serializers.BooleanField(required=False, default=False)


class BrandingAssetUpdateSerializer(serializers.Serializer):
    usage_type = serializers.ChoiceField(
        choices=BrandingAsset.UsageType.choices,
        required=False,
    )
    label = serializers.CharField(max_length=120, required=False, allow_blank=True)
    is_selected = serializers.BooleanField(required=False)
