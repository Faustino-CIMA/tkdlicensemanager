from __future__ import annotations

from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .card_registry import MERGE_FIELD_REGISTRY, validate_design_payload_schema
from .models import (
    CardFormatPreset,
    CardTemplate,
    CardTemplateVersion,
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
            "metadata",
            "requested_by",
            "started_at",
            "finished_at",
            "created_at",
            "updated_at",
            "items",
        ]
        read_only_fields = [
            "job_number",
            "status",
            "requested_by",
            "started_at",
            "finished_at",
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


def get_merge_field_registry_payload():
    return MERGE_FIELD_REGISTRY
