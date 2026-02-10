from rest_framework import serializers

from licenses.models import LicenseHistoryEvent

from .models import Member
from .models import GradePromotionHistory


class MemberSerializer(serializers.ModelSerializer):
    sex = serializers.ChoiceField(choices=Member.Sex.choices, default=Member.Sex.MALE)

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

    def update(self, instance, validated_data):
        previous_belt_rank = str(instance.belt_rank or "").strip()
        updated_member = super().update(instance, validated_data)
        new_belt_rank = str(updated_member.belt_rank or "").strip()

        if new_belt_rank and new_belt_rank != previous_belt_rank:
            from .services import add_grade_promotion

            request = self.context.get("request")
            actor = request.user if request and request.user.is_authenticated else None
            add_grade_promotion(
                updated_member,
                to_grade=new_belt_rank,
                from_grade=previous_belt_rank,
                actor=actor,
                metadata={"source": "member_serializer.update"},
                sync_member=False,
            )
        return updated_member


class GradePromotionHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = GradePromotionHistory
        fields = [
            "id",
            "member",
            "club",
            "examiner_user",
            "from_grade",
            "to_grade",
            "promotion_date",
            "exam_date",
            "proof_ref",
            "notes",
            "metadata",
            "created_at",
        ]
        read_only_fields = ["created_at", "club", "examiner_user", "from_grade"]


class GradePromotionCreateSerializer(serializers.Serializer):
    to_grade = serializers.CharField(max_length=100)
    promotion_date = serializers.DateField(required=False)
    exam_date = serializers.DateField(required=False, allow_null=True)
    proof_ref = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    metadata = serializers.JSONField(required=False)

    def validate_to_grade(self, value):
        normalized = value.strip()
        if not normalized:
            raise serializers.ValidationError("to_grade is required.")
        return normalized


class LicenseHistoryEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = LicenseHistoryEvent
        fields = [
            "id",
            "member",
            "license",
            "club",
            "order",
            "payment",
            "actor",
            "event_type",
            "event_at",
            "reason",
            "metadata",
            "license_year",
            "status_before",
            "status_after",
            "club_name_snapshot",
            "created_at",
        ]

