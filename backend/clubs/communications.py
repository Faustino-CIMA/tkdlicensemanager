from .languages import DEFAULT_CLUB_LANGUAGE, normalize_club_language

INVOICE_COPY = {
    "en": {
        "subject": "Invoice {number}",
        "hello": "Hello,",
        "ready": "Your invoice {number} is ready.",
        "total": "Total due: {total} {currency}",
        "pdf": "The PDF is attached to this email.",
        "thanks": "Thank you.",
    },
    "lb": {
        "subject": "Rechnung {number}",
        "hello": "Moien,",
        "ready": "Är Rechnung {number} ass prett.",
        "total": "Total ze bezuelen: {total} {currency}",
        "pdf": "De PDF ass un dës E-Mail ugemaach.",
        "thanks": "Merci.",
    },
}


def invoice_copy_for_club(club) -> dict[str, str]:
    language = normalize_club_language(getattr(club, "communication_language", None))
    return INVOICE_COPY.get(language) or INVOICE_COPY[DEFAULT_CLUB_LANGUAGE]
