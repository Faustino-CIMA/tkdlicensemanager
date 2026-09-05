export function getDashboardRouteForRole(
  role: string,
  locale: string,
  options?: { isSuperuser?: boolean },
): string | null {
  if (options?.isSuperuser) {
    return `/${locale}/dashboard/ops`;
  }
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
