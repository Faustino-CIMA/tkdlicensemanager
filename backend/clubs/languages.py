CLUB_COMMUNICATION_LANGUAGES = (
    ("en", "English"),
    ("lb", "Lëtzebuergesch"),
)

DEFAULT_CLUB_LANGUAGE = "en"


def allowed_club_language_codes() -> set[str]:
    return {code for code, _label in CLUB_COMMUNICATION_LANGUAGES}


def normalize_club_language(value: str | None) -> str:
    code = str(value or DEFAULT_CLUB_LANGUAGE).strip().lower()
    if code in allowed_club_language_codes():
        return code
    return DEFAULT_CLUB_LANGUAGE
