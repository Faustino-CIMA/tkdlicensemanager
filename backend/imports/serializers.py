from rest_framework import serializers


class ImportBaseSerializer(serializers.Serializer):
    file = serializers.FileField()
    mapping = serializers.JSONField(required=False)
    actions = serializers.JSONField(required=False)
    club_id = serializers.IntegerField(required=False)
    date_format = serializers.CharField(required=False)


class ImportPreviewResponseSerializer(serializers.Serializer):
    headers = serializers.ListField(child=serializers.CharField())
    sample_rows = serializers.ListField(child=serializers.ListField(), required=False)
    rows = serializers.ListField(child=serializers.DictField(), required=False)
    total_rows = serializers.IntegerField()
    club_id = serializers.IntegerField(required=False)


class ImportConfirmResponseSerializer(serializers.Serializer):
    created = serializers.IntegerField()
    skipped = serializers.IntegerField()
    errors = serializers.ListField(child=serializers.DictField())
    club_id = serializers.IntegerField(required=False)


class ImportDetailResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()
