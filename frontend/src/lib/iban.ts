// Official LU IBAN: LUkk + 3-digit bank code + 13-character account (ABBL/CSSF).
// Older retail accounts often start with 9 after the bank code (e.g. Spuerkeess 001).
// Matching 4 digits first treated "0019…" as POST (0019) instead of Spuerkeess (001).
const LUXEMBOURG_BANK_CODE_MAP: Record<string, string> = {
  "001": "Spuerkeess (BCEE)",
  "002": "Banque Internationale a Luxembourg (BIL)",
  "003": "BGL BNP Paribas",
  "007": "CACEIS Bank Luxembourg",
  "008": "Banque de Luxembourg",
  "009": "Banque Raiffeisen",
  "014": "ING Luxembourg",
  "019": "POST Luxembourg",
  "020": "Banque de Luxembourg",
  "032": "Bank Julius Baer Europe",
  "034": "Citibank Europe Luxembourg",
  "036": "Deutsche Bank Luxembourg",
  "038": "Union Bancaire Privee (Europe)",
  "051": "NORD/LB Luxembourg",
  "061": "Societe Generale Luxembourg",
  "062": "ABN AMRO Luxembourg",
  "067": "J.P. Morgan SE Luxembourg",
  "070": "UBS Europe SE Luxembourg",
  "087": "Intesa Sanpaolo Bank Luxembourg",
  "104": "SNCI",
  "107": "DZ PRIVATBANK",
  "111": "POST Luxembourg",
  "123": "CA Indosuez Wealth (Europe)",
  "131": "State Street Bank Luxembourg",
  "143": "DNB Luxembourg",
  "147": "HSBC Private Bank (Luxembourg)",
  "148": "Banque J. Safra Sarasin (Luxembourg)",
  "151": "Eurobank Private Bank Luxembourg",
  "158": "UniCredit International Bank (Luxembourg)",
  "172": "Edmond de Rothschild (Europe)",
  "177": "Bankinter Luxembourg",
  "178": "Brown Brothers Harriman (Luxembourg)",
  "183": "VP Bank (Luxembourg)",
  "193": "Banque Transatlantique Luxembourg",
  "197": "Natixis Wealth Management Luxembourg",
  "198": "Pictet & Cie (Europe)",
  "222": "Bank of China (Europe)",
  "284": "Banque Havilland",
  "289": "Clearstream Banking",
  "301": "EFG Bank (Luxembourg)",
  "305": "Delen Private Bank Luxembourg",
  "324": "Swissquote Bank Europe",
  "328": "BNP Paribas Luxembourg",
  "341": "RBC Investor Services Bank",
  "344": "Advanzia Bank",
  "348": "ICBC (Europe)",
  "350": "Intesa Sanpaolo Wealth Management",
  "351": "PayPal (Europe)",
  "359": "Keytrade Bank Luxembourg",
  "360": "Andbank Luxembourg",
  "361": "Banque de Patrimoines Prives",
  "364": "Lombard Odier (Europe)",
  "365": "Novo Banco Luxembourg",
  "372": "BEMO Europe - Banque Privee",
  "374": "HSBC Continental Europe Luxembourg",
  "375": "China Construction Bank (Europe)",
  "381": "Mirabaud & Cie (Europe)",
  "408": "Banking Circle",
  "409": "Barclays Bank Ireland Luxembourg",
  "411": "CaixaBank Wealth Management Luxembourg",
  "415": "Goldman Sachs Bank Europe Luxembourg",
  "700": "East-West United Bank",
  "701": "Rakuten Europe Bank",
  "705": "Quintet Private Bank (Europe)",
  "805": "MANGOPAY",
  "810": "Satispay Europe",
  "814": "PingPong Europe",
  "815": "Vivid Money",
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
  if (iban.startsWith("LU") && iban.length >= 7) {
    const bankCode3 = iban.slice(4, 7);
    return LUXEMBOURG_BANK_CODE_MAP[bankCode3] ?? `Luxembourg bank (${bankCode3})`;
  }
  if (iban.length >= 8) {
    return `Bank identifier ${iban.slice(4, 8)}`;
  }
  return "Bank";
}
