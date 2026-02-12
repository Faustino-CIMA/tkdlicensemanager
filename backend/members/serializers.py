from rest_framework import serializers

from licenses.models import LicenseHistoryEvent

from .models import Member
from .models import GradePromotionHistory


class MemberSerializer(serializers.ModelSerializer):
    sex = serializers.ChoiceField(choices=Member.Sex.choices, default=Member.Sex.MALE)
    profile_picture_url = serializers.SerializerMethodField()
    profile_picture_thumbnail_url = serializers.SerializerMethodField()

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
            "profile_picture_url",
            "profile_picture_thumbnail_url",
            "photo_edit_metadata",
            "photo_consent_attested_at",
            "photo_consent_attested_by",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "created_at",
            "updated_at",
            "profile_picture_url",
            "profile_picture_thumbnail_url",
            "photo_edit_metadata",
            "photo_consent_attested_at",
            "photo_consent_attested_by",
        ]

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

    def get_profile_picture_url(self, obj: Member):
        request = self.context.get("request")
        if not obj.profile_picture_processed:
            return None
        url = obj.profile_picture_processed.url
        return request.build_absolute_uri(url) if request else url

    def get_profile_picture_thumbnail_url(self, obj: Member):
        request = self.context.get("request")
        if not obj.profile_picture_thumbnail:
            return None
        url = obj.profile_picture_thumbnail.url
        return request.build_absolute_uri(url) if request else url


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


class MemberProfilePictureUploadSerializer(serializers.Serializer):
    original_image = serializers.FileField(required=False, allow_null=True)
    processed_image = serializers.FileField(required=True)
    photo_edit_metadata = serializers.JSONField(required=False)
    photo_consent_confirmed = serializers.BooleanField(required=True)

    def validate_photo_edit_metadata(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("photo_edit_metadata must be an object.")
        return value

    def validate(self, attrs):
        if not attrs.get("photo_consent_confirmed"):
            raise serializers.ValidationError(
                {"photo_consent_confirmed": "Photo consent confirmation is required."}
            )
        return attrs


class MemberProfilePictureSerializer(serializers.ModelSerializer):
    has_profile_picture = serializers.SerializerMethodField()
    profile_picture_original_url = serializers.SerializerMethodField()
    profile_picture_processed_url = serializers.SerializerMethodField()
    profile_picture_thumbnail_url = serializers.SerializerMethodField()
    photo_consent_attested_by = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Member
        fields = [
            "id",
            "has_profile_picture",
            "profile_picture_original_url",
            "profile_picture_processed_url",
            "profile_picture_thumbnail_url",
            "photo_edit_metadata",
            "photo_consent_attested_at",
            "photo_consent_attested_by",
            "updated_at",
        ]

    def _build_url(self, file_field):
        if not file_field:
            return None
        request = self.context.get("request")
        file_url = file_field.url
        return request.build_absolute_uri(file_url) if request else file_url

    def get_has_profile_picture(self, obj: Member):
        return bool(obj.profile_picture_processed or obj.profile_picture_original)

    def get_profile_picture_original_url(self, obj: Member):
        return self._build_url(obj.profile_picture_original)

    def get_profile_picture_processed_url(self, obj: Member):
        return self._build_url(obj.profile_picture_processed)

    def get_profile_picture_thumbnail_url(self, obj: Member):
        return self._build_url(obj.profile_picture_thumbnail)

