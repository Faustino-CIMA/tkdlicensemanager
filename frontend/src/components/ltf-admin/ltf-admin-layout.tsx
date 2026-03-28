"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

type LtfAdminLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

type NavMatchMode = "exact" | "prefix";

type LtfNavDef = {
  id: string;
  href: (locale: string) => string;
  labelKey:
    | "navOverview"
    | "navClubs"
    | "navMembers"
    | "navLicenses"
    | "navLicenseCards"
    | "navLicenseCardPrintJobs"
    | "navLicenseTypes"
    | "navPrinterProfiles"
    | "navSettings";
  matchMode: NavMatchMode;
};

/** Fixed order and stable ids — longer hrefs win active state over shorter prefixes (e.g. print-jobs vs license-cards). */
const LTF_NAV_DEFINITIONS: LtfNavDef[] = [
  { id: "overview", href: (l) => `/${l}/dashboard/ltf`, labelKey: "navOverview", matchMode: "exact" },
  { id: "clubs", href: (l) => `/${l}/dashboard/ltf/clubs`, labelKey: "navClubs", matchMode: "prefix" },
  { id: "members", href: (l) => `/${l}/dashboard/ltf/members`, labelKey: "navMembers", matchMode: "prefix" },
  { id: "licenses", href: (l) => `/${l}/dashboard/ltf/licenses`, labelKey: "navLicenses", matchMode: "prefix" },
  {
    id: "license-cards",
    href: (l) => `/${l}/dashboard/ltf/license-cards`,
    labelKey: "navLicenseCards",
    matchMode: "prefix",
  },
  {
    id: "license-card-print-jobs",
    href: (l) => `/${l}/dashboard/ltf/license-cards/print-jobs`,
    labelKey: "navLicenseCardPrintJobs",
    matchMode: "prefix",
  },
  {
    id: "license-types",
    href: (l) => `/${l}/dashboard/ltf/license-types`,
    labelKey: "navLicenseTypes",
    matchMode: "prefix",
  },
  {
    id: "printer-profiles",
    href: (l) => `/${l}/dashboard/ltf/printer-profiles`,
    labelKey: "navPrinterProfiles",
    matchMode: "prefix",
  },
  { id: "settings", href: (l) => `/${l}/dashboard/ltf/settings`, labelKey: "navSettings", matchMode: "prefix" },
];

function pathMatchesTab(pathname: string, href: string, matchMode: NavMatchMode): boolean {
  if (matchMode === "exact") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolveActiveNavId(
  pathname: string | null,
  items: Array<{ id: string; href: string; matchMode: NavMatchMode }>
): string | null {
  if (!pathname) {
    return null;
  }
  let best: { id: string; href: string } | null = null;
  for (const item of items) {
    if (!pathMatchesTab(pathname, item.href, item.matchMode)) {
      continue;
    }
    if (!best || item.href.length > best.href.length) {
      best = { id: item.id, href: item.href };
    }
  }
  return best?.id ?? null;
}

export function LtfAdminLayout({ title, subtitle, children }: LtfAdminLayoutProps) {
  const t = useTranslations("LtfAdmin");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  const navItems = useMemo(
    () =>
      LTF_NAV_DEFINITIONS.map((def) => ({
        id: def.id,
        href: def.href(locale),
        label: t(def.labelKey),
        matchMode: def.matchMode,
      })),
    [locale, t]
  );

  const activeId = useMemo(() => resolveActiveNavId(pathname, navItems), [pathname, navItems]);

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
          <nav
            aria-label={title}
            className="mt-6 flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-border bg-secondary p-1"
          >
            {navItems.map((item) => {
              const isActive = item.id === activeId;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex h-11 items-center justify-center rounded-[var(--radius-form)] px-4 text-sm font-medium ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
