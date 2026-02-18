const LUXEMBOURG_BANK_CODE_MAP: Record<string, string> = {
  "0001": "Spuerkeess (BCEE)",
  "0002": "Banque Internationale a Luxembourg (BIL)",
  "0003": "BGL BNP Paribas",
  "0009": "Banque Raiffeisen",
  "0014": "ING Luxembourg",
  "0019": "POST Luxembourg",
  "0020": "Banque de Luxembourg",
  "001": "Spuerkeess (BCEE)",
  "002": "Banque Internationale a Luxembourg (BIL)",
  "003": "BGL BNP Paribas",
  "009": "Banque Raiffeisen",
  "014": "ING Luxembourg",
  "019": "POST Luxembourg",
  "020": "Banque de Luxembourg",
};

export function normalizeIban(rawValue: string | null | undefined): string {
  return String(rawValue ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function isValidIban(rawValue: string | null | undefined): boolean {
  const iban = normalizeIban(rawValue);
  if (iban.length < 15 || iban.length > 34) {
    return false;
  }
  if (!/^[A-Z0-9]+$/.test(iban)) {
    return false;
  }
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let expanded = "";
  for (const char of rearranged) {
    if (/\d/.test(char)) {
      expanded += char;
    } else {
      expanded += String(char.charCodeAt(0) - 55);
    }
  }
  let remainder = 0;
  for (const digit of expanded) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function deriveBankNameFromIban(rawValue: string | null | undefined): string {
  const iban = normalizeIban(rawValue);
  if (!iban) {
    return "";
  }
  if (iban.startsWith("LU") && iban.length >= 8) {
    const bankCode4 = iban.slice(4, 8);
    const bankCode3 = iban.slice(4, 7);
    return (
      LUXEMBOURG_BANK_CODE_MAP[bankCode4] ??
      LUXEMBOURG_BANK_CODE_MAP[bankCode3] ??
      `Luxembourg bank (${bankCode4})`
    );
  }
  if (iban.length >= 8) {
    return `Bank identifier ${iban.slice(4, 8)}`;
  }
  return "Bank";
}
