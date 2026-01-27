from rest_framework import serializers

from .models import License


class LicenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = License
        fields = [
            "id",
            "member",
            "club",
            "year",
            "start_date",
            "end_date",
            "status",
            "issued_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["start_date", "end_date", "created_at", "updated_at"]
