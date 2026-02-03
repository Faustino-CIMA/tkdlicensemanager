from django.utils.text import slugify
from rest_framework import serializers

from .models import License, LicenseType


class LicenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = License
        fields = [
            "id",
            "member",
            "club",
            "license_type",
            "year",
            "start_date",
            "end_date",
            "status",
            "issued_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["start_date", "end_date", "created_at", "updated_at"]


class LicenseTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LicenseType
        fields = ["id", "name", "code", "created_at", "updated_at"]
        read_only_fields = ["code", "created_at", "updated_at"]

    def validate_name(self, value):
        normalized = value.strip()
        if not normalized:
            raise serializers.ValidationError("Name is required.")
        return normalized

    def create(self, validated_data):
        name = validated_data["name"]
        code = slugify(name)
        if LicenseType.objects.filter(code=code).exists():
            raise serializers.ValidationError({"name": "A license type with this name already exists."})
        return LicenseType.objects.create(name=name, code=code)

    def update(self, instance, validated_data):
        name = validated_data.get("name", instance.name)
        code = slugify(name)
        if LicenseType.objects.exclude(id=instance.id).filter(code=code).exists():
            raise serializers.ValidationError({"name": "A license type with this name already exists."})
        instance.name = name
        instance.code = code
        instance.save()
        return instance
