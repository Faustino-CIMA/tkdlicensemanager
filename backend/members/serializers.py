from rest_framework import serializers

from .models import Member


class MemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = Member
        fields = [
            "id",
            "user",
            "club",
            "first_name",
            "last_name",
            "sex",
            "email",
            "wt_licenseid",
            "ltf_licenseid",
            "date_of_birth",
            "belt_rank",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

