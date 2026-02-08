import json
from datetime import date, datetime

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, response, status, views
from rest_framework.parsers import MultiPartParser

from accounts.permissions import IsClubAdmin, IsLtfAdmin, IsLtfAdminOrClubAdmin
from clubs.models import Club
from members.models import Member

from .csv_utils import read_csv, to_row_dict
from .serializers import (
    ImportBaseSerializer,
    ImportConfirmResponseSerializer,
    ImportDetailResponseSerializer,
    ImportPreviewResponseSerializer,
)


def parse_mapping(raw_mapping):
    if not raw_mapping:
        return None
    if isinstance(raw_mapping, dict):
        return raw_mapping
    return json.loads(raw_mapping)


def parse_actions(raw_actions):
    if not raw_actions:
        return {}
    actions_list = json.loads(raw_actions) if isinstance(raw_actions, str) else raw_actions
    return {int(item["row_index"]): item["action"] for item in actions_list}


def parse_date(value, errors, field_name, date_format):
    if not value:
        return None

    formats = {
        "YYYY-MM-DD": "%Y-%m-%d",
        "DD/MM/YYYY": "%d/%m/%Y",
        "DD-MM-YYYY": "%d-%m-%Y",
        "DD.MM.YYYY": "%d.%m.%Y",
    }
    pattern = formats.get(date_format, "%Y-%m-%d")
    try:
        parsed = date.fromisoformat(value) if pattern == "%Y-%m-%d" else datetime.strptime(value, pattern).date()
        return parsed
    except Exception:
        errors.append(f"{field_name} must match {date_format}")
        return None


def normalize_sex(value, errors):
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in {"m", "male"}:
        return "M"
    if normalized in {"f", "female"}:
        return "F"
    errors.append("sex must be Male or Female")
    return None


def parse_boolean(value, errors, field_name):
    if value is None or value == "":
        return None
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y"}:
        return True
    if normalized in {"false", "0", "no", "n"}:
        return False
    errors.append(f"{field_name} must be true/false")
    return None


def get_member_club_id(request):
    club_id_raw = request.data.get("club_id")
    if not club_id_raw:
        return None, response.Response(
            {"detail": "club_id is required for member imports."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        club_id = int(club_id_raw)
    except ValueError:
        return None, response.Response(
            {"detail": "club_id must be an integer."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if request.user.role == "club_admin":
        if not Club.objects.filter(id=club_id, admins=request.user).exists():
            return None, response.Response(
                {"detail": "You are not allowed to import for this club."},
                status=status.HTTP_403_FORBIDDEN,
            )
    else:
        if not Club.objects.filter(id=club_id).exists():
            return None, response.Response(
                {"detail": "Club does not exist."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    return club_id, None


class ClubImportPreviewView(views.APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsLtfAdmin]
    serializer_class = ImportBaseSerializer

    @extend_schema(
        request=ImportBaseSerializer,
        responses={
            200: ImportPreviewResponseSerializer,
            400: ImportDetailResponseSerializer,
        },
    )
    def post(self, request):
        file_obj = request.data.get("file")
        if not file_obj:
            return response.Response({"detail": "CSV file is required."}, status=400)

        headers, rows = read_csv(file_obj)
        mapping = parse_mapping(request.data.get("mapping"))
        sample_rows = rows[:5]

        if not mapping:
            return response.Response(
                {"headers": headers, "sample_rows": sample_rows, "total_rows": len(rows)}
            )

        name_header = mapping.get("name")
        if not name_header:
            return response.Response({"detail": "Mapping for name is required."}, status=400)

        existing_names = {
            club.name.lower(): club.id for club in Club.objects.all().only("id", "name")
        }

        preview_rows = []
        for index, row in enumerate(rows, start=1):
            row_data = to_row_dict(headers, row)
            errors = []
            name = row_data.get(name_header, "").strip()
            if not name:
                errors.append("name is required")
            duplicate_id = existing_names.get(name.lower()) if name else None
            preview_rows.append(
                {
                    "row_index": index,
                    "data": {"name": name, "city": row_data.get(mapping.get("city", ""), "").strip(),
                             "address": row_data.get(mapping.get("address", ""), "").strip()},
                    "errors": errors,
                    "duplicate": bool(duplicate_id),
                    "existing_id": duplicate_id,
                }
            )

        return response.Response(
            {"headers": headers, "rows": preview_rows, "total_rows": len(rows)}
        )


class ClubImportConfirmView(views.APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsLtfAdmin]
    serializer_class = ImportBaseSerializer

    @extend_schema(
        request=ImportBaseSerializer,
        responses={
            200: ImportConfirmResponseSerializer,
            400: ImportDetailResponseSerializer,
        },
    )
    def post(self, request):
        file_obj = request.data.get("file")
        mapping = parse_mapping(request.data.get("mapping"))
        actions = parse_actions(request.data.get("actions"))
        if not file_obj or not mapping:
            return response.Response(
                {"detail": "file and mapping are required."}, status=400
            )

        headers, rows = read_csv(file_obj)
        name_header = mapping.get("name")
        if not name_header:
            return response.Response({"detail": "Mapping for name is required."}, status=400)

        created = 0
        skipped = 0
        row_errors = []

        with transaction.atomic():
            for index, row in enumerate(rows, start=1):
                action = actions.get(index, "create")
                if action == "skip":
                    skipped += 1
                    continue

                row_data = to_row_dict(headers, row)
                errors = []
                name = row_data.get(name_header, "").strip()
                if not name:
                    errors.append("name is required")

                if errors:
                    row_errors.append({"row_index": index, "errors": errors})
                    continue

                Club.objects.create(
                    name=name,
                    city=row_data.get(mapping.get("city", ""), "").strip(),
                    address=row_data.get(mapping.get("address", ""), "").strip(),
                    created_by=request.user,
                )
                created += 1

        return response.Response(
            {"created": created, "skipped": skipped, "errors": row_errors}
        )


class MemberImportPreviewView(views.APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsLtfAdminOrClubAdmin]
    serializer_class = ImportBaseSerializer

    @extend_schema(
        request=ImportBaseSerializer,
        responses={
            200: ImportPreviewResponseSerializer,
            400: ImportDetailResponseSerializer,
            403: ImportDetailResponseSerializer,
        },
    )
    def post(self, request):
        file_obj = request.data.get("file")
        if not file_obj:
            return response.Response({"detail": "CSV file is required."}, status=400)

        club_id, error_response = get_member_club_id(request)
        if error_response:
            return error_response
        date_format = request.data.get("date_format", "YYYY-MM-DD")

        headers, rows = read_csv(file_obj)
        mapping = parse_mapping(request.data.get("mapping"))
        sample_rows = rows[:5]

        if not mapping:
            return response.Response(
                {"headers": headers, "sample_rows": sample_rows, "total_rows": len(rows)}
            )

        first_header = mapping.get("first_name")
        last_header = mapping.get("last_name")
        if not first_header or not last_header:
            return response.Response(
                {"detail": "Mapping for first_name and last_name is required."},
                status=400,
            )

        existing_members = {
            (m.first_name.lower(), m.last_name.lower()): m.id
            for m in Member.objects.filter(club_id=club_id).only("id", "first_name", "last_name")
        }

        preview_rows = []
        for index, row in enumerate(rows, start=1):
            row_data = to_row_dict(headers, row)
            errors = []
            first_name = row_data.get(first_header, "").strip()
            last_name = row_data.get(last_header, "").strip()
            if not first_name:
                errors.append("first_name is required")
            if not last_name:
                errors.append("last_name is required")

            dob = parse_date(
                row_data.get(mapping.get("date_of_birth", ""), "").strip(),
                errors,
                "date_of_birth",
                date_format,
            )
            sex_value = normalize_sex(
                row_data.get(mapping.get("sex", ""), "").strip(),
                errors,
            )
            is_active_value = parse_boolean(
                row_data.get(mapping.get("is_active", ""), "").strip(),
                errors,
                "is_active",
            )
            duplicate_id = (
                existing_members.get((first_name.lower(), last_name.lower()))
                if first_name and last_name
                else None
            )

            preview_rows.append(
                {
                    "row_index": index,
                    "data": {
                        "first_name": first_name,
                        "last_name": last_name,
                        "date_of_birth": dob.isoformat() if dob else None,
                        "belt_rank": row_data.get(mapping.get("belt_rank", ""), "").strip(),
                        "email": row_data.get(mapping.get("email", ""), "").strip(),
                        "wt_licenseid": row_data.get(mapping.get("wt_licenseid", ""), "").strip(),
                        "ltf_licenseid": row_data.get(mapping.get("ltf_licenseid", ""), "").strip(),
                        "sex": sex_value,
                        "is_active": is_active_value,
                    },
                    "errors": errors,
                    "duplicate": bool(duplicate_id),
                    "existing_id": duplicate_id,
                }
            )

        return response.Response(
            {
                "headers": headers,
                "rows": preview_rows,
                "total_rows": len(rows),
                "club_id": club_id,
            }
        )


class MemberImportConfirmView(views.APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsLtfAdminOrClubAdmin]
    serializer_class = ImportBaseSerializer

    @extend_schema(
        request=ImportBaseSerializer,
        responses={
            200: ImportConfirmResponseSerializer,
            400: ImportDetailResponseSerializer,
            403: ImportDetailResponseSerializer,
        },
    )
    def post(self, request):
        file_obj = request.data.get("file")
        mapping = parse_mapping(request.data.get("mapping"))
        actions = parse_actions(request.data.get("actions"))
        if not file_obj or not mapping:
            return response.Response(
                {"detail": "file and mapping are required."}, status=400
            )

        club_id, error_response = get_member_club_id(request)
        if error_response:
            return error_response
        date_format = request.data.get("date_format", "YYYY-MM-DD")

        headers, rows = read_csv(file_obj)
        first_header = mapping.get("first_name")
        last_header = mapping.get("last_name")
        if not first_header or not last_header:
            return response.Response(
                {"detail": "Mapping for first_name and last_name is required."},
                status=400,
            )

        created = 0
        skipped = 0
        row_errors = []

        with transaction.atomic():
            for index, row in enumerate(rows, start=1):
                action = actions.get(index, "create")
                if action == "skip":
                    skipped += 1
                    continue

                row_data = to_row_dict(headers, row)
                errors = []
                first_name = row_data.get(first_header, "").strip()
                last_name = row_data.get(last_header, "").strip()
                if not first_name:
                    errors.append("first_name is required")
                if not last_name:
                    errors.append("last_name is required")

                dob = parse_date(
                    row_data.get(mapping.get("date_of_birth", ""), "").strip(),
                    errors,
                    "date_of_birth",
                    date_format,
                )
                sex_value = normalize_sex(
                    row_data.get(mapping.get("sex", ""), "").strip(),
                    errors,
                )
                is_active_value = parse_boolean(
                    row_data.get(mapping.get("is_active", ""), "").strip(),
                    errors,
                    "is_active",
                )

                if errors:
                    row_errors.append({"row_index": index, "errors": errors})
                    continue
                member_payload = {
                    "club_id": club_id,
                    "first_name": first_name,
                    "last_name": last_name,
                    "date_of_birth": dob,
                    "belt_rank": row_data.get(mapping.get("belt_rank", ""), "").strip(),
                    "email": row_data.get(mapping.get("email", ""), "").strip(),
                    "wt_licenseid": row_data.get(mapping.get("wt_licenseid", ""), "").strip(),
                    "ltf_licenseid": row_data.get(mapping.get("ltf_licenseid", ""), "").strip(),
                }
                if sex_value:
                    member_payload["sex"] = sex_value
                if is_active_value is not None:
                    member_payload["is_active"] = is_active_value
                Member.objects.create(**member_payload)
                created += 1

        return response.Response(
            {
                "created": created,
                "skipped": skipped,
                "errors": row_errors,
                "club_id": club_id,
            }
        )
