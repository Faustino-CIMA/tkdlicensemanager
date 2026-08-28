import re

MEMBER_HEADER_ALIASES = {
    "first_name": [
        "first name",
        "firstname",
        "preferred first name",
        "given name",
        "prenom",
        "prénom",
    ],
    "last_name": [
        "last name",
        "lastname",
        "preferred last name",
        "surname",
        "family name",
        "nom",
    ],
    "sex": ["gender"],
    "email": ["e-mail", "email address", "e mail"],
    "date_of_birth": ["date of birth", "dob", "birth date", "birthday", "birthdate"],
    "belt_rank": ["belt rank", "belt", "grade", "rank"],
    "wt_licenseid": ["wt license id", "wt license", "wt id", "world taekwondo id"],
    "ltf_licenseid": [
        "ltf license id",
        "ltf license",
        "ltf id",
        "member id",
        "memberid",
    ],
    "primary_license_role": [
        "primary license role",
        "primary member role",
        "primary role",
        "member role",
    ],
    "secondary_license_role": ["secondary license role", "secondary role"],
    "is_active": ["is active", "active"],
}

MEMBERSHIP_END_DATE_ALIASES = [
    "membership_end_date",
    "membership end date",
    "membershipenddate",
    "membership expiry",
    "membership expiration",
    "membership expiry date",
    "membership expiration date",
]

MEMBER_MAPPING_FIELDS = [
    "first_name",
    "last_name",
    "sex",
    "email",
    "date_of_birth",
    "belt_rank",
    "wt_licenseid",
    "ltf_licenseid",
    "primary_license_role",
    "secondary_license_role",
    "is_active",
]


def normalize_header(value):
    text = str(value or "")
    text = text.replace("\ufeff", "")
    text = text.replace("\xa0", " ").replace("\u2007", " ").replace("\u202f", " ")
    text = re.sub(r"[_\./\\-]+", " ", text)
    text = text.replace("'", "").replace('"', "")
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _compact_header(value):
    return normalize_header(value).replace(" ", "")


def _candidate_forms(field_key):
    raw = [field_key, field_key.replace("_", " "), *MEMBER_HEADER_ALIASES.get(field_key, [])]
    normalized = {normalize_header(item) for item in raw if item}
    compact = {item.replace(" ", "") for item in normalized if item}
    return normalized, compact


def suggest_member_mapping(headers):
    mapping = {}
    used = set()
    normalized_headers = [normalize_header(header) for header in headers]
    compact_headers = [header.replace(" ", "") for header in normalized_headers]

    for field_key in MEMBER_MAPPING_FIELDS:
        candidates, compact_candidates = _candidate_forms(field_key)
        match_index = None
        for index, header in enumerate(headers):
            if index in used:
                continue
            normalized = normalized_headers[index]
            compact = compact_headers[index]
            if not normalized:
                continue
            if normalized in candidates or compact in compact_candidates:
                match_index = index
                break
        if match_index is not None:
            used.add(match_index)
            mapping[field_key] = headers[match_index]

    return mapping


def detect_membership_end_date_header(headers, mapping=None):
    mapping = mapping or {}
    mapped = str(mapping.get("membership_end_date") or "").strip()
    header_list = list(headers or [])
    if mapped and (not header_list or mapped in header_list):
        return mapped

    candidates = {normalize_header(item) for item in MEMBERSHIP_END_DATE_ALIASES if item}
    compact_candidates = {item.replace(" ", "") for item in candidates if item}
    for header in header_list:
        normalized = normalize_header(header)
        compact = normalized.replace(" ", "")
        if not normalized:
            continue
        if normalized in candidates or compact in compact_candidates:
            return header
    return None
