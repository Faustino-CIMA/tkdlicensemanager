import { getDashboardRouteForRole } from "./dashboard-routing";

describe("dashboard routing", () => {
  it("maps member role to member history page", () => {
    expect(getDashboardRouteForRole("member", "en")).toBe("/en/dashboard/member");
  });

  it("maps coach role to club dashboard", () => {
    expect(getDashboardRouteForRole("coach", "lb")).toBe("/lb/dashboard/club");
  });

  it("returns null for unknown role", () => {
    expect(getDashboardRouteForRole("unknown", "en")).toBeNull();
  });
});
