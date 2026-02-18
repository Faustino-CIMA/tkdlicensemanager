import re


_LUXEMBOURG_BANK_CODE_MAP = {
    "0001": "Spuerkeess (BCEE)",
    "0002": "Banque Internationale a Luxembourg (BIL)",
    "0003": "BGL BNP Paribas",
    "0009": "Banque Raiffeisen",
    "0014": "ING Luxembourg",
    "0019": "POST Luxembourg",
    "0020": "Banque de Luxembourg",
    # Backward-compatible 3-digit aliases.
    "001": "Spuerkeess (BCEE)",
    "002": "Banque Internationale a Luxembourg (BIL)",
    "003": "BGL BNP Paribas",
    "009": "Banque Raiffeisen",
    "014": "ING Luxembourg",
    "019": "POST Luxembourg",
    "020": "Banque de Luxembourg",
}


def normalize_iban(raw_value: str | None) -> str:
    return re.sub(r"\s+", "", str(raw_value or "")).upper()


def is_valid_iban(iban: str) -> bool:
    normalized = normalize_iban(iban)
    if len(normalized) < 15 or len(normalized) > 34:
        return False
    if not re.fullmatch(r"[A-Z0-9]+", normalized):
        return False
    rearranged = f"{normalized[4:]}{normalized[:4]}"
    expanded = []
    for char in rearranged:
        if char.isdigit():
            expanded.append(char)
        else:
            expanded.append(str(ord(char) - 55))
    try:
        return int("".join(expanded)) % 97 == 1
    except ValueError:
        return False


def derive_bank_name_from_iban(iban: str) -> str:
    normalized = normalize_iban(iban)
    if not normalized:
        return ""
    if normalized.startswith("LU") and len(normalized) >= 8:
        bank_code4 = normalized[4:8]
        bank_code3 = normalized[4:7]
        if bank_code4 in _LUXEMBOURG_BANK_CODE_MAP:
            return _LUXEMBOURG_BANK_CODE_MAP[bank_code4]
        if bank_code3 in _LUXEMBOURG_BANK_CODE_MAP:
            return _LUXEMBOURG_BANK_CODE_MAP[bank_code3]
        return f"Luxembourg bank ({bank_code4})"
    if len(normalized) >= 8:
        return f"Bank identifier {normalized[4:8]}"
    return "Bank"
