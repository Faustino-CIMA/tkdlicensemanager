export type ImportMappingField = {
  key: string;
  label: string;
};

export const FIELD_HEADER_ALIASES: Record<string, string[]> = {
  first_name: [
    "first name",
    "firstname",
    "preferred first name",
    "given name",
    "prenom",
    "prénom",
  ],
  last_name: [
    "last name",
    "lastname",
    "preferred last name",
    "surname",
    "family name",
    "nom",
  ],
  sex: ["gender"],
  email: ["e-mail", "email address", "e mail"],
  date_of_birth: ["date of birth", "dob", "birth date", "birthday", "birthdate"],
  belt_rank: ["belt rank", "belt", "grade", "rank"],
  wt_licenseid: ["wt license id", "wt license", "wt id", "world taekwondo id"],
  ltf_licenseid: [
    "ltf license id",
    "ltf license",
    "ltf id",
    "member id",
    "memberid",
  ],
  primary_license_role: [
    "primary license role",
    "primary member role",
    "primary role",
    "member role",
  ],
  secondary_license_role: ["secondary license role", "secondary role"],
  is_active: ["is active", "active"],
  membership_end_date: [
    "membership end date",
    "membershipenddate",
    "membership expiry",
    "membership expiration",
    "membership expiry date",
    "membership expiration date",
  ],
};

export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[_./\\-]+/g, " ")
    .replace(/['"]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactHeader(value: string): string {
  return normalizeHeader(value).replace(/ /g, "");
}

function candidateForms(field: ImportMappingField): { normalized: Set<string>; compact: Set<string> } {
  const raw = [
    field.key,
    field.key.replace(/_/g, " "),
    field.label,
    field.label.split("(")[0],
    ...(FIELD_HEADER_ALIASES[field.key] ?? []),
  ];
  const normalized = new Set(
    raw.map((item) => normalizeHeader(item)).filter((item) => item.length > 0)
  );
  const compact = new Set([...normalized].map((item) => item.replace(/ /g, "")).filter(Boolean));
  return { normalized, compact };
}

export function buildAutoMapping(
  fields: ImportMappingField[],
  headers: string[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedIndexes = new Set<number>();
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const compactHeaders = normalizedHeaders.map((header) => header.replace(/ /g, ""));

  for (const field of fields) {
    const candidates = candidateForms(field);
    let matchIndex = -1;
    for (let index = 0; index < headers.length; index += 1) {
      if (usedIndexes.has(index)) {
        continue;
      }
      const normalized = normalizedHeaders[index];
      const compact = compactHeaders[index];
      if (!normalized) {
        continue;
      }
      if (candidates.normalized.has(normalized) || candidates.compact.has(compact)) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex >= 0) {
      usedIndexes.add(matchIndex);
      mapping[field.key] = headers[matchIndex];
    }
  }

  return mapping;
}

export function applySuggestedMapping(
  fields: ImportMappingField[],
  headers: string[],
  suggested?: Record<string, string> | null
): Record<string, string> {
  const allowed = new Set(fields.map((field) => field.key));
  const headerSet = new Set(headers);
  const picked: Record<string, string> = {};
  if (suggested) {
    for (const [key, header] of Object.entries(suggested)) {
      if (!allowed.has(key) || !header || !headerSet.has(header)) {
        continue;
      }
      picked[key] = header;
    }
  }
  if (Object.keys(picked).length > 0) {
    return picked;
  }
  return buildAutoMapping(fields, headers);
}

export function detectMembershipEndDateHeader(headers: string[]): string | null {
  const mapping = buildAutoMapping(
    [{ key: "membership_end_date", label: "Membership End Date" }],
    headers
  );
  return mapping.membership_end_date ?? null;
}

export function unusedSourceHeaders(
  headers: string[],
  mapping: Record<string, string>,
  helperHeaders: Array<string | null | undefined> = []
): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  for (const helper of helperHeaders) {
    if (helper) {
      mapped.add(helper);
    }
  }
  return headers.filter((header) => header && !mapped.has(header));
}
