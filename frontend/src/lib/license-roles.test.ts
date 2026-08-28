import {
  LICENSE_ROLE_VALUES,
  canonicalizeLicenseRole,
  licenseRoleMessageKey,
} from "@/lib/license-roles";

describe("license role canonicalization", () => {
  it("stores capitalized values and accepts mixed CSV casing", () => {
    expect(canonicalizeLicenseRole("athlete")).toBe("Athlete");
    expect(canonicalizeLicenseRole("ATHLETE")).toBe("Athlete");
    expect(canonicalizeLicenseRole(" Athlete ")).toBe("Athlete");
    expect(canonicalizeLicenseRole("physiotherapist")).toBe("Physiotherapist");
    expect(canonicalizeLicenseRole("")).toBe("");
    expect(canonicalizeLicenseRole("InvalidRole")).toBe("");
  });

  it("maps every stored value to the existing i18n key shape", () => {
    for (const role of LICENSE_ROLE_VALUES) {
      expect(licenseRoleMessageKey(role)).toBe(`licenseRole${role}`);
      expect(canonicalizeLicenseRole(role.toLowerCase())).toBe(role);
    }
  });
});
