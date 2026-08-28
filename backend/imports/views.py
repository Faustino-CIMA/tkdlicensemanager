import json
import re
from datetime import date, datetime

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, response, status, views
from rest_framework.parsers import MultiPartParser

from accounts.permissions import IsClubAdmin, IsLtfAdmin, IsLtfAdminOrClubAdmin
from clubs.banking import derive_bank_name_from_iban, is_valid_iban, normalize_iban
from clubs.models import Club
from members.models import Member
from members.services import apply_ltf_license_id_import_prefix, ltf_license_prefix_rewrite_policy

from .csv_utils import read_csv, to_row_dict
from .mapping import detect_membership_end_date_header, suggest_member_mapping
from .serializers import (
    ImportBaseSerializer,
    ImportConfirmResponseSerializer,
    ImportDetailResponseSerializer,
    ImportPreviewResponseSerializer,
)


def resolve_import_license_ids(row_data, mapping, rewrite_enabled: bool):
    wt_licenseid = row_data.get(mapping.get("wt_licenseid", ""), "").strip().upper()
    raw_ltf_licenseid = row_data.get(mapping.get("ltf_licenseid", ""), "").strip().upper()
    ltf_licenseid, rewritten = apply_ltf_license_id_import_prefix(
        raw_ltf_licenseid,
        enabled=rewrite_enabled,
    )
    return wt_licenseid, ltf_licenseid, rewritten


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


def parse_row_overrides(raw_overrides):
    if not raw_overrides:
        return {}
    if isinstance(raw_overrides, (bytes, bytearray)):
        raw_overrides = raw_overrides.decode("utf-8")
    if isinstance(raw_overrides, str):
        raw_overrides = raw_overrides.strip()
        if not raw_overrides:
            return {}
        overrides = json.loads(raw_overrides)
    else:
        overrides = raw_overrides

    parsed: dict[int, dict] = {}

    if isinstance(overrides, list):
        for item in overrides:
            if not isinstance(item, dict):
                continue
            row_index = item.get("row_index")
            if row_index is None:
                continue
            parsed[int(row_index)] = _normalize_row_override(item)
        return parsed

    if isinstance(overrides, dict):
        for row_index, override in overrides.items():
            if not isinstance(override, dict):
                continue
            parsed[int(row_index)] = _normalize_row_override(override)
        return parsed

    return {}


def _normalize_row_override(item: dict) -> dict:
    payload = {
        "primary_license_role": item.get("primary_license_role", ""),
        "secondary_license_role": item.get("secondary_license_role", ""),
    }
    if "is_active" in item:
        payload["is_active"] = item.get("is_active")
    return payload


_ALLOWED_MEMBERSHIP_YEAR_POLICIES = {"skip", "active", "inactive"}


def parse_membership_year_policies(raw):
    if not raw:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
        data = json.loads(raw)
    else:
        data = raw
    if not isinstance(data, dict) or not data.get("enabled"):
        return None
    years_in = data.get("years") or {}
    years: dict[int, str] = {}
    if isinstance(years_in, dict):
        for key, value in years_in.items():
            policy = str(value or "").strip().lower()
            if policy not in _ALLOWED_MEMBERSHIP_YEAR_POLICIES:
                continue
            try:
                years[int(key)] = policy
            except (TypeError, ValueError):
                continue
    unknown = str(data.get("unknown") or "skip").strip().lower()
    if unknown not in _ALLOWED_MEMBERSHIP_YEAR_POLICIES:
        unknown = "skip"
    return {"years": years, "unknown": unknown}


def parse_membership_end_year(value, date_format):
    raw = str(value or "").strip()
    if not raw:
        return None
    local_errors: list[str] = []
    parsed = parse_date(raw, local_errors, "membership_end_date", date_format)
    if parsed:
        return parsed.year
    for pattern in ("%d/%m/%Y", "%d.%m.%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, pattern).date().year
        except Exception:
            continue
    return None


def membership_end_year_for_row(row_data, mapping, date_format, headers=None):
    header = detect_membership_end_date_header(
        headers if headers is not None else list(row_data.keys()),
        mapping,
    )
    if not header:
        return None
    return parse_membership_end_year(row_data.get(header, ""), date_format)


def membership_year_policy_for(year, policies):
    if not policies:
        return None
    if year is None:
        return policies["unknown"]
    return policies["years"].get(year, policies["unknown"])


def resolve_license_role_value(has_row_override, override, field_name, csv_value, errors):
    """Prefer Step 3 row overrides for rows included in row_overrides payload."""
    if has_row_override:
        return normalize_license_role(override.get(field_name, ""), errors, field_name)
    return normalize_license_role(csv_value, errors, field_name)


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


def normalize_license_role(value, errors, field_name):
    # Accept any casing from CSV/overrides ("athlete", "ATHLETE", "Athlete")
    # and persist the capitalized canonical value used in the member table.
    if value is None or value == "":
        return ""
    canonical = Member.canonicalize_license_role(value)
    if canonical:
        return canonical
    errors.append(
        f"{field_name} must be one of: Athlete, Coach, Referee, Official, Doctor, Physiotherapist, Volunteer, Staff, Media, Fan"
    )
    return ""


def parse_club_address_fields(row_data, mapping, errors):
    address_line1 = (
        row_data.get(mapping.get("address_line1", ""), "").strip()
        or row_data.get(mapping.get("address", ""), "").strip()
    )
    address_line2 = row_data.get(mapping.get("address_line2", ""), "").strip()
    locality = (
        row_data.get(mapping.get("locality", ""), "").strip()
        or row_data.get(mapping.get("city", ""), "").strip()
    )
    postal_code = row_data.get(mapping.get("postal_code", ""), "").strip()
    iban_raw = row_data.get(mapping.get("iban", ""), "").strip()
    iban = normalize_iban(iban_raw)

    if postal_code and not re.fullmatch(r"\d{4}", postal_code):
        errors.append("postal_code must be 4 digits for Luxembourg")
    if iban and not is_valid_iban(iban):
        errors.append("iban must be a valid IBAN")

    return {
        "address_line1": address_line1,
        "address_line2": address_line2,
        "postal_code": postal_code,
        "locality": locality,
        "iban": iban,
        "bank_name": derive_bank_name_from_iban(iban),
    }


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
            address_fields = parse_club_address_fields(row_data, mapping, errors)
            duplicate_id = existing_names.get(name.lower()) if name else None
            preview_rows.append(
                {
                    "row_index": index,
                    "data": {
                        "name": name,
                        "address_line1": address_fields["address_line1"],
                        "address_line2": address_fields["address_line2"],
                        "postal_code": address_fields["postal_code"],
                        "locality": address_fields["locality"],
                        "iban": address_fields["iban"],
                        "bank_name": address_fields["bank_name"],
                        # Legacy aliases for backward-compatible previews.
                        "city": address_fields["locality"],
                        "address": address_fields["address_line1"],
                    },
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
                address_fields = parse_club_address_fields(row_data, mapping, errors)
                if errors:
                    row_errors.append({"row_index": index, "errors": errors})
                    continue

                Club.objects.create(
                    name=name,
                    city=address_fields["locality"],
                    address=address_fields["address_line1"],
                    address_line1=address_fields["address_line1"],
                    address_line2=address_fields["address_line2"],
                    postal_code=address_fields["postal_code"],
                    locality=address_fields["locality"],
                    iban=address_fields["iban"],
                    bank_name=address_fields["bank_name"],
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
                {
                    "headers": headers,
                    "sample_rows": sample_rows,
                    "total_rows": len(rows),
                    "suggested_mapping": suggest_member_mapping(headers),
                    "membership_end_date_header": detect_membership_end_date_header(headers),
                    "ltf_license_prefix_rewrite": ltf_license_prefix_rewrite_policy(),
                }
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
        existing_wt_ids = {
            value.strip().upper()
            for value in Member.objects.exclude(wt_licenseid="")
            .values_list("wt_licenseid", flat=True)
            .iterator()
            if value
        }
        existing_ltf_ids = {
            value.strip().upper()
            for value in Member.objects.exclude(ltf_licenseid="")
            .values_list("ltf_licenseid", flat=True)
            .iterator()
            if value
        }
        seen_wt_ids = set()
        seen_ltf_ids = set()
        rewrite_enabled = ltf_license_prefix_rewrite_policy()["enabled"]
        rewritten_count = 0

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
            primary_license_role = normalize_license_role(
                row_data.get(mapping.get("primary_license_role", ""), "").strip(),
                errors,
                "primary_license_role",
            )
            secondary_license_role = normalize_license_role(
                row_data.get(mapping.get("secondary_license_role", ""), "").strip(),
                errors,
                "secondary_license_role",
            )
            if secondary_license_role and not primary_license_role:
                errors.append("secondary_license_role requires primary_license_role")
            if (
                primary_license_role
                and secondary_license_role
                and primary_license_role == secondary_license_role
            ):
                errors.append("secondary_license_role must differ from primary_license_role")
            duplicate_id = (
                existing_members.get((first_name.lower(), last_name.lower()))
                if first_name and last_name
                else None
            )
            wt_licenseid, ltf_licenseid, ltf_rewritten = resolve_import_license_ids(
                row_data, mapping, rewrite_enabled
            )
            if ltf_rewritten:
                rewritten_count += 1
            if wt_licenseid:
                if wt_licenseid in existing_wt_ids or wt_licenseid in seen_wt_ids:
                    errors.append("wt_licenseid must be unique")
                seen_wt_ids.add(wt_licenseid)
            if ltf_licenseid:
                if ltf_licenseid in existing_ltf_ids or ltf_licenseid in seen_ltf_ids:
                    errors.append("ltf_licenseid must be unique")
                seen_ltf_ids.add(ltf_licenseid)
            membership_end_year = membership_end_year_for_row(
                row_data, mapping, date_format, headers
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
                        "wt_licenseid": wt_licenseid,
                        "ltf_licenseid": ltf_licenseid,
                        "sex": sex_value,
                        "is_active": is_active_value,
                        "primary_license_role": primary_license_role,
                        "secondary_license_role": secondary_license_role,
                        "membership_end_year": membership_end_year,
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
                "membership_end_date_header": detect_membership_end_date_header(
                    headers, mapping
                ),
                "ltf_license_prefix_rewrite": ltf_license_prefix_rewrite_policy(
                    rewritten_count=rewritten_count
                ),
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
        row_overrides = parse_row_overrides(request.data.get("row_overrides"))
        membership_year_policies = parse_membership_year_policies(
            request.data.get("membership_year_policies")
        )
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
        existing_wt_ids = {
            value.strip().upper()
            for value in Member.objects.exclude(wt_licenseid="")
            .values_list("wt_licenseid", flat=True)
            .iterator()
            if value
        }
        existing_ltf_ids = {
            value.strip().upper()
            for value in Member.objects.exclude(ltf_licenseid="")
            .values_list("ltf_licenseid", flat=True)
            .iterator()
            if value
        }
        created_wt_ids = set()
        created_ltf_ids = set()
        rewrite_enabled = ltf_license_prefix_rewrite_policy()["enabled"]
        rewritten_count = 0

        with transaction.atomic():
            for index, row in enumerate(rows, start=1):
                action = actions.get(index, "create")
                if action == "skip":
                    skipped += 1
                    continue

                row_data = to_row_dict(headers, row)
                year_policy = membership_year_policy_for(
                    membership_end_year_for_row(row_data, mapping, date_format, headers),
                    membership_year_policies,
                )
                if year_policy == "skip":
                    skipped += 1
                    continue
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

                # Get row overrides if present (Step 3 role corrections from frontend)
                has_row_override = index in row_overrides
                override = row_overrides.get(index, {})
                primary_license_role = resolve_license_role_value(
                    has_row_override,
                    override,
                    "primary_license_role",
                    row_data.get(mapping.get("primary_license_role", ""), "").strip(),
                    errors,
                )
                secondary_license_role = resolve_license_role_value(
                    has_row_override,
                    override,
                    "secondary_license_role",
                    row_data.get(mapping.get("secondary_license_role", ""), "").strip(),
                    errors,
                )

                if secondary_license_role and not primary_license_role:
                    errors.append("secondary_license_role requires primary_license_role")
                if (
                    primary_license_role
                    and secondary_license_role
                    and primary_license_role == secondary_license_role
                ):
                    errors.append("secondary_license_role must differ from primary_license_role")
                wt_licenseid, ltf_licenseid, ltf_rewritten = resolve_import_license_ids(
                    row_data, mapping, rewrite_enabled
                )
                if wt_licenseid:
                    if wt_licenseid in existing_wt_ids or wt_licenseid in created_wt_ids:
                        errors.append("wt_licenseid must be unique")
                if ltf_licenseid:
                    if ltf_licenseid in existing_ltf_ids or ltf_licenseid in created_ltf_ids:
                        errors.append("ltf_licenseid must be unique")

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
                    "wt_licenseid": wt_licenseid,
                    "ltf_licenseid": ltf_licenseid,
                    "primary_license_role": primary_license_role,
                    "secondary_license_role": secondary_license_role,
                }
                if sex_value:
                    member_payload["sex"] = sex_value
                if has_row_override and "is_active" in override:
                    override_active = override.get("is_active")
                    if override_active is True or override_active is False:
                        is_active_value = override_active
                if year_policy == "active":
                    is_active_value = True
                elif year_policy == "inactive":
                    is_active_value = False
                if is_active_value is not None:
                    member_payload["is_active"] = is_active_value
                Member.objects.create(**member_payload)
                if wt_licenseid:
                    created_wt_ids.add(wt_licenseid)
                if ltf_licenseid:
                    created_ltf_ids.add(ltf_licenseid)
                if ltf_rewritten:
                    rewritten_count += 1
                created += 1

        return response.Response(
            {
                "created": created,
                "skipped": skipped,
                "errors": row_errors,
                "club_id": club_id,
                "ltf_license_prefix_rewrite": ltf_license_prefix_rewrite_policy(
                    rewritten_count=rewritten_count
                ),
            }
        )
