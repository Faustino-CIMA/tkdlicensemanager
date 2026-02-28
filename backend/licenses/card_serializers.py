from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from clubs.models import Club
from members.models import Member

from .card_registry import (
    ALLOWED_MERGE_FIELDS,
    MERGE_FIELD_REGISTRY,
    validate_design_payload_schema,
)
from .models import (
    CardFormatPreset,
    CardTemplate,
    CardTemplateVersion,
    FinanceAuditLog,
    License,
    PaperProfile,
    PrintJob,
    PrintJobItem,
)


class CardFormatPresetSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardFormatPreset
        fields = [
            "id",
            "code",
            "name",
            "description",
            "width_mm",
            "height_mm",
            "is_custom",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class PaperProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaperProfile
        fields = [
            "id",
            "code",
            "name",
            "description",
            "card_format",
            "sheet_width_mm",
            "sheet_height_mm",
            "card_width_mm",
            "card_height_mm",
            "margin_top_mm",
            "margin_bottom_mm",
            "margin_left_mm",
            "margin_right_mm",
            "horizontal_gap_mm",
            "vertical_gap_mm",
            "columns",
            "rows",
            "slot_count",
            "is_preset",
            "is_active",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        card_format = attrs.get("card_format") or (instance.card_format if instance else None)
        card_width_mm = attrs.get("card_width_mm")
        if card_width_mm is None and instance:
            card_width_mm = instance.card_width_mm
        card_height_mm = attrs.get("card_height_mm")
        if card_height_mm is None and instance:
            card_height_mm = instance.card_height_mm
        rows = attrs.get("rows")
        if rows is None and instance:
            rows = instance.rows
        columns = attrs.get("columns")
        if columns is None and instance:
            columns = instance.columns
        slot_count = attrs.get("slot_count")
        if slot_count is None and instance:
            slot_count = instance.slot_count

        if card_format and card_width_mm and card_height_mm:
            if Decimal(str(card_width_mm)) != Decimal(str(card_format.width_mm)):
                raise serializers.ValidationError(
                    {"card_width_mm": "Must match selected card format width."}
                )
            if Decimal(str(card_height_mm)) != Decimal(str(card_format.height_mm)):
                raise serializers.ValidationError(
                    {"card_height_mm": "Must match selected card format height."}
                )

        if rows and columns and slot_count and int(rows) * int(columns) != int(slot_count):
            raise serializers.ValidationError(
                {"slot_count": "Slot count must equal rows * columns."}
            )
        return attrs


class CardTemplateVersionSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = CardTemplateVersion
        fields = [
            "id",
            "version_number",
            "label",
            "status",
            "published_at",
            "card_format",
            "paper_profile",
        ]


class CardTemplateSerializer(serializers.ModelSerializer):
    latest_published_version = serializers.SerializerMethodField()

    class Meta:
        model = CardTemplate
        fields = [
            "id",
            "name",
            "description",
            "is_default",
            "is_active",
            "latest_published_version",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by", "updated_by", "created_at", "updated_at"]

    def get_latest_published_version(self, obj: CardTemplate):
        latest_version = (
            obj.versions.filter(status=CardTemplateVersion.Status.PUBLISHED)
            .select_related("card_format", "paper_profile")
            .order_by("-version_number")
            .first()
        )
        if latest_version is None:
            return None
        return CardTemplateVersionSummarySerializer(latest_version).data


class CardTemplateCloneSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(required=False, allow_blank=True)
    source_version_id = serializers.IntegerField(required=False)


class CardTemplateVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardTemplateVersion
        fields = [
            "id",
            "template",
            "version_number",
            "label",
            "status",
            "card_format",
            "paper_profile",
            "design_payload",
            "notes",
            "created_by",
            "published_by",
            "published_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "version_number",
            "status",
            "created_by",
            "published_by",
            "published_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        if instance and instance.status == CardTemplateVersion.Status.PUBLISHED:
            raise serializers.ValidationError("Published template versions are immutable.")

        card_format = attrs.get("card_format")
        if card_format is None and instance is not None:
            card_format = instance.card_format
        paper_profile = attrs.get("paper_profile")
        if paper_profile is None and instance is not None:
            paper_profile = instance.paper_profile
        if paper_profile and card_format and paper_profile.card_format_id != card_format.id:
            raise serializers.ValidationError(
                {"paper_profile": "Paper profile card format must match template card format."}
            )

        design_payload = attrs.get("design_payload")
        if design_payload is None and instance is not None:
            design_payload = instance.design_payload
        if design_payload is None:
            design_payload = {"elements": []}
            attrs["design_payload"] = design_payload

        if card_format is None:
            raise serializers.ValidationError({"card_format": "Card format is required."})

        try:
            validate_design_payload_schema(
                design_payload,
                canvas_width_mm=Decimal(str(card_format.width_mm)),
                canvas_height_mm=Decimal(str(card_format.height_mm)),
            )
        except DjangoValidationError as exc:
            if hasattr(exc, "message_dict"):
                raise serializers.ValidationError(exc.message_dict) from exc
            raise serializers.ValidationError(exc.messages) from exc
        return attrs


class MergeFieldSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    description = serializers.CharField()


class PrintJobItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrintJobItem
        fields = [
            "id",
            "member",
            "license",
            "quantity",
            "slot_index",
            "status",
            "metadata",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["status", "created_at", "updated_at"]


class PrintJobHistoryEventSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = FinanceAuditLog
        fields = ["id", "action", "message", "actor", "metadata", "created_at"]

    def get_actor(self, obj):
        actor = getattr(obj, "actor", None)
        if actor is None:
            return None
        return {
            "id": actor.id,
            "username": actor.username,
            "role": getattr(actor, "role", ""),
        }


class PrintJobSerializer(serializers.ModelSerializer):
    items = PrintJobItemSerializer(many=True, read_only=True)

    class Meta:
        model = PrintJob
        fields = [
            "id",
            "job_number",
            "club",
            "template_version",
            "paper_profile",
            "status",
            "total_items",
            "selected_slots",
            "include_bleed_guide",
            "include_safe_area_guide",
            "bleed_mm",
            "safe_area_mm",
            "metadata",
            "execution_metadata",
            "requested_by",
            "executed_by",
            "queued_at",
            "started_at",
            "finished_at",
            "cancelled_at",
            "execution_attempts",
            "artifact_pdf",
            "artifact_size_bytes",
            "artifact_sha256",
            "error_detail",
            "last_error_at",
            "created_at",
            "updated_at",
            "items",
        ]
        read_only_fields = [
            "job_number",
            "status",
            "total_items",
            "requested_by",
            "executed_by",
            "queued_at",
            "started_at",
            "finished_at",
            "cancelled_at",
            "execution_attempts",
            "artifact_pdf",
            "artifact_size_bytes",
            "artifact_sha256",
            "error_detail",
            "last_error_at",
            "created_at",
            "updated_at",
            "items",
        ]

    def validate(self, attrs):
        template_version = attrs.get("template_version")
        paper_profile = attrs.get("paper_profile")
        if template_version and template_version.status != CardTemplateVersion.Status.PUBLISHED:
            raise serializers.ValidationError(
                {"template_version": "Print jobs must reference a published template version."}
            )
        if paper_profile and template_version:
            if paper_profile.card_format_id != template_version.card_format_id:
                raise serializers.ValidationError(
                    {"paper_profile": "Paper profile card format must match template version format."}
                )
        return attrs


class PrintJobCreateSerializer(serializers.Serializer):
    club = serializers.PrimaryKeyRelatedField(queryset=Club.objects.all())
    template_version = serializers.PrimaryKeyRelatedField(
        queryset=CardTemplateVersion.objects.select_related("paper_profile", "card_format").all()
    )
    paper_profile = serializers.PrimaryKeyRelatedField(
        queryset=PaperProfile.objects.select_related("card_format").all(),
        required=False,
        allow_null=True,
    )
    member_ids = serializers.ListField(
        required=False,
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    license_ids = serializers.ListField(
        required=False,
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    selected_slots = serializers.ListField(
        required=False,
        child=serializers.IntegerField(min_value=0),
        allow_empty=False,
    )
    include_bleed_guide = serializers.BooleanField(required=False, default=False)
    include_safe_area_guide = serializers.BooleanField(required=False, default=False)
    bleed_mm = serializers.DecimalField(
        required=False,
        max_digits=8,
        decimal_places=2,
        min_value=Decimal("0.00"),
        default=Decimal("2.00"),
    )
    safe_area_mm = serializers.DecimalField(
        required=False,
        max_digits=8,
        decimal_places=2,
        min_value=Decimal("0.00"),
        default=Decimal("3.00"),
    )
    metadata = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        club = attrs["club"]
        template_version = attrs["template_version"]
        paper_profile = attrs.get("paper_profile") or template_version.paper_profile
        member_ids = attrs.get("member_ids") or []
        license_ids = attrs.get("license_ids") or []
        selected_slots = attrs.get("selected_slots") or []

        if template_version.status != CardTemplateVersion.Status.PUBLISHED:
            raise serializers.ValidationError(
                {"template_version": "Print jobs must use a published template version."}
            )
        if not member_ids and not license_ids:
            raise serializers.ValidationError(
                {"detail": "At least one of member_ids or license_ids is required."}
            )
        if len(set(member_ids)) != len(member_ids):
            raise serializers.ValidationError({"member_ids": "Duplicate member ids are not allowed."})
        if len(set(license_ids)) != len(license_ids):
            raise serializers.ValidationError({"license_ids": "Duplicate license ids are not allowed."})
        if len(set(selected_slots)) != len(selected_slots):
            raise serializers.ValidationError(
                {"selected_slots": "Duplicate slot indices are not allowed."}
            )
        if paper_profile and paper_profile.card_format_id != template_version.card_format_id:
            raise serializers.ValidationError(
                {"paper_profile": "Paper profile card format must match template version format."}
            )
        if selected_slots and paper_profile is None:
            raise serializers.ValidationError(
                {"selected_slots": "Selected slots require a paper profile."}
            )

        members = []
        if member_ids:
            member_queryset = Member.objects.select_related("club").filter(id__in=member_ids)
            members = sorted(list(member_queryset), key=lambda member: member.id)
            found_member_ids = {member.id for member in members}
            missing_member_ids = [member_id for member_id in member_ids if member_id not in found_member_ids]
            if missing_member_ids:
                raise serializers.ValidationError(
                    {"member_ids": f"Unknown member id(s): {', '.join(str(value) for value in missing_member_ids)}."}
                )
            invalid_member_ids = [member.id for member in members if member.club_id != club.id]
            if invalid_member_ids:
                raise serializers.ValidationError(
                    {
                        "member_ids": (
                            "Member id(s) do not belong to the selected club: "
                            + ", ".join(str(value) for value in invalid_member_ids)
                        )
                    }
                )

        licenses = []
        if license_ids:
            license_queryset = License.objects.select_related("member", "club").filter(id__in=license_ids)
            licenses = sorted(list(license_queryset), key=lambda license_record: license_record.id)
            found_license_ids = {license_record.id for license_record in licenses}
            missing_license_ids = [
                license_id for license_id in license_ids if license_id not in found_license_ids
            ]
            if missing_license_ids:
                raise serializers.ValidationError(
                    {"license_ids": f"Unknown license id(s): {', '.join(str(value) for value in missing_license_ids)}."}
                )
            invalid_license_ids = [license_record.id for license_record in licenses if license_record.club_id != club.id]
            if invalid_license_ids:
                raise serializers.ValidationError(
                    {
                        "license_ids": (
                            "License id(s) do not belong to the selected club: "
                            + ", ".join(str(value) for value in invalid_license_ids)
                        )
                    }
                )

        resolved_items: list[dict[str, Any]] = []
        license_member_ids = set()
        for license_record in licenses:
            resolved_items.append(
                {
                    "member": license_record.member,
                    "license": license_record,
                }
            )
            license_member_ids.add(license_record.member_id)
        for member in members:
            if member.id in license_member_ids:
                continue
            resolved_items.append({"member": member, "license": None})

        if not resolved_items:
            raise serializers.ValidationError({"detail": "No printable items were resolved."})
        if selected_slots:
            sorted_slots = sorted(int(slot) for slot in selected_slots)
            if len(sorted_slots) < len(resolved_items):
                raise serializers.ValidationError(
                    {
                        "selected_slots": (
                            "Selected slots count must be >= number of printable items."
                        )
                    }
                )
            if paper_profile:
                invalid_slot_indexes = [
                    slot
                    for slot in sorted_slots
                    if slot < 0 or slot >= int(paper_profile.slot_count)
                ]
                if invalid_slot_indexes:
                    raise serializers.ValidationError(
                        {
                            "selected_slots": (
                                "Out-of-range slot index(es): "
                                + ", ".join(str(value) for value in invalid_slot_indexes)
                            )
                        }
                    )
            attrs["selected_slots"] = sorted_slots

        metadata = attrs.get("metadata")
        if metadata is None:
            attrs["metadata"] = {}
        elif not isinstance(metadata, dict):
            raise serializers.ValidationError({"metadata": "metadata must be an object."})

        attrs["resolved_paper_profile"] = paper_profile
        attrs["resolved_items"] = resolved_items
        return attrs


def _flatten_preview_sample_data(sample_data: dict[str, Any]) -> set[str]:
    flattened_keys: set[str] = set()
    for key, value in sample_data.items():
        key_name = str(key).strip()
        if not key_name:
            continue
        if isinstance(value, dict):
            for nested_key in value.keys():
                nested_name = str(nested_key).strip()
                if nested_name:
                    flattened_keys.add(f"{key_name}.{nested_name}")
        else:
            flattened_keys.add(key_name)
    return flattened_keys


class CardPreviewRequestSerializer(serializers.Serializer):
    member_id = serializers.IntegerField(required=False, min_value=1)
    license_id = serializers.IntegerField(required=False, min_value=1)
    club_id = serializers.IntegerField(required=False, min_value=1)
    sample_data = serializers.JSONField(required=False)
    include_bleed_guide = serializers.BooleanField(required=False, default=False)
    include_safe_area_guide = serializers.BooleanField(required=False, default=False)
    bleed_mm = serializers.DecimalField(
        required=False,
        max_digits=8,
        decimal_places=2,
        min_value=Decimal("0.00"),
        default=Decimal("2.00"),
    )
    safe_area_mm = serializers.DecimalField(
        required=False,
        max_digits=8,
        decimal_places=2,
        min_value=Decimal("0.00"),
        default=Decimal("3.00"),
    )

    def validate_sample_data(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("sample_data must be an object.")
        flattened_keys = _flatten_preview_sample_data(value)
        unknown_keys = sorted(flattened_keys - ALLOWED_MERGE_FIELDS)
        if unknown_keys:
            raise serializers.ValidationError(
                "Unknown sample_data merge key(s): " + ", ".join(unknown_keys)
            )
        return value


class CardSheetPreviewRequestSerializer(CardPreviewRequestSerializer):
    paper_profile_id = serializers.IntegerField(required=False, min_value=1)
    selected_slots = serializers.ListField(
        required=False,
        child=serializers.IntegerField(min_value=0),
        allow_empty=False,
    )

    def validate_selected_slots(self, value):
        if value is None:
            return value
        if len(set(value)) != len(value):
            raise serializers.ValidationError("selected_slots must not contain duplicates.")
        return value


class CardPreviewDataSerializer(serializers.Serializer):
    template_version_id = serializers.IntegerField()
    template_id = serializers.IntegerField()
    card_format = serializers.DictField()
    paper_profile = serializers.DictField(required=False, allow_null=True)
    guides = serializers.DictField()
    context = serializers.DictField(child=serializers.CharField(allow_blank=True))
    selected_slots = serializers.ListField(child=serializers.IntegerField(), required=False)
    slots = serializers.ListField(child=serializers.DictField(), required=False)
    elements = serializers.ListField(child=serializers.DictField())


def get_merge_field_registry_payload():
    return MERGE_FIELD_REGISTRY
