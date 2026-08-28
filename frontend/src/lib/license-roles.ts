export const LICENSE_ROLE_VALUES = [
  "Athlete",
  "Coach",
  "Referee",
  "Official",
  "Doctor",
  "Physiotherapist",
  "Volunteer",
  "Staff",
  "Media",
  "Fan",
] as const;

export type LicenseRoleValue = (typeof LICENSE_ROLE_VALUES)[number];

export function canonicalizeLicenseRole(value: unknown): LicenseRoleValue | "" {
  const collapsed = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
  if (!collapsed) {
    return "";
  }
  return LICENSE_ROLE_VALUES.find((role) => role.toLowerCase() === collapsed) ?? "";
}

export function licenseRoleMessageKey(role: string): `licenseRole${string}` {
  const canonical = canonicalizeLicenseRole(role) || role;
  return `licenseRole${canonical}`;
}
