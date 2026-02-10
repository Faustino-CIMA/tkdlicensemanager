export function getDashboardRouteForRole(role: string, locale: string): string | null {
  if (role === "ltf_admin") {
    return `/${locale}/dashboard/ltf`;
  }
  if (role === "ltf_finance") {
    return `/${locale}/dashboard/ltf-finance`;
  }
  if (role === "club_admin" || role === "coach") {
    return `/${locale}/dashboard/club`;
  }
  if (role === "member") {
    return `/${locale}/dashboard/member`;
  }
  return null;
}
