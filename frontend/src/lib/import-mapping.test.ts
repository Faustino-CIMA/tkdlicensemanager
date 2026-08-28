import {
  applySuggestedMapping,
  buildAutoMapping,
  detectMembershipEndDateHeader,
  normalizeHeader,
  unusedSourceHeaders,
} from "@/lib/import-mapping";

const MEMBER_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "sex", label: "Sex" },
  { key: "email", label: "Email" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "belt_rank", label: "Belt rank" },
  { key: "wt_licenseid", label: "WT license ID" },
  { key: "ltf_licenseid", label: "LTF license ID" },
  { key: "primary_license_role", label: "Primary license role" },
  { key: "secondary_license_role", label: "Secondary license role" },
  { key: "is_active", label: "Active" },
];

const SIMPLYCOMPETE_HEADERS = [
  "Member ID",
  "Preferred First Name",
  "Preferred Last Name",
  "Gender",
  "Date of Birth",
  "Primary Member Role",
  "Secondary Role",
  "Membership End Date",
];

describe("import mapping", () => {
  it("normalizes quoted, punctuated, and compact headers", () => {
    expect(normalizeHeader(' "Membership End Date" ')).toBe("membership end date");
    expect(normalizeHeader("membership_end_date")).toBe("membership end date");
    expect(normalizeHeader("Membership  End\u00a0Date")).toBe("membership end date");
  });

  it("auto-maps SimplyCompete member fields without treating Membership End Date as a mapped field", () => {
    const mapping = buildAutoMapping(MEMBER_FIELDS, SIMPLYCOMPETE_HEADERS);
    expect(mapping.membership_end_date).toBeUndefined();
    expect(mapping.first_name).toBe("Preferred First Name");
    expect(mapping.last_name).toBe("Preferred Last Name");
    expect(mapping.sex).toBe("Gender");
    expect(mapping.date_of_birth).toBe("Date of Birth");
    expect(mapping.primary_license_role).toBe("Primary Member Role");
    expect(mapping.secondary_license_role).toBe("Secondary Role");
    expect(mapping.ltf_licenseid).toBe("Member ID");
  });

  it("detects Membership End Date as a helper column", () => {
    expect(detectMembershipEndDateHeader(SIMPLYCOMPETE_HEADERS)).toBe("Membership End Date");
    expect(detectMembershipEndDateHeader(["first_name", "last_name"])).toBeNull();
  });

  it("keeps backend suggestions when they match known headers", () => {
    const mapping = applySuggestedMapping(MEMBER_FIELDS, SIMPLYCOMPETE_HEADERS, {
      membership_end_date: "Membership End Date",
      first_name: "Preferred First Name",
    });
    expect(mapping.membership_end_date).toBeUndefined();
    expect(mapping.first_name).toBe("Preferred First Name");
  });

  it("falls back to auto-map when suggestions are empty", () => {
    const mapping = applySuggestedMapping(MEMBER_FIELDS, SIMPLYCOMPETE_HEADERS, {});
    expect(mapping.first_name).toBe("Preferred First Name");
    expect(mapping.membership_end_date).toBeUndefined();
  });

  it("does not list the helper column as an unused source header", () => {
    const unused = unusedSourceHeaders(
      SIMPLYCOMPETE_HEADERS,
      { first_name: "Preferred First Name" },
      ["Membership End Date"]
    );
    expect(unused).not.toContain("Membership End Date");
    expect(unused).toContain("Preferred Last Name");
  });
});
