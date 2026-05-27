"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

type ClubAdminLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

type NavMatchMode = "exact" | "prefix";

type ClubNavDef = Readonly<{
  id: string;
  /** Route after locale segment: `/${locale}/<routePath>` */
  routePath: string;
  labelKey:
    | "navOverview"
    | "navMembers"
    | "navLicenses"
    | "navPrintJobs"
    | "navOrders"
    | "navInvoices"
    | "navPrinterProfiles"
    | "navSettings";
  matchMode: NavMatchMode;
}>;

/**
 * Frozen module-level definitions — plain data only (no `t()`, no locale, no per-render functions).
 * Stable order for club_admin: Overview → Members → Licenses → Print jobs → Orders → Invoices
 * → Printer profiles → Settings.
 */
const CLUB_NAV_DEFINITIONS: readonly ClubNavDef[] = Object.freeze([
  Object.freeze({
    id: "overview",
    routePath: "dashboard/club",
    labelKey: "navOverview",
    matchMode: "exact",
  } satisfies ClubNavDef),
  Object.freeze({
    id: "members",
    routePath: "dashboard/club/members",
    labelKey: "navMembers",
    matchMode: "prefix",
  } satisfies ClubNavDef),
  Object.freeze({
    id: "licenses",
    routePath: "dashboard/club/licenses",
    labelKey: "navLicenses",
    matchMode: "prefix",
  } satisfies ClubNavDef),
  Object.freeze({
    id: "print-jobs",
    routePath: "dashboard/club/print-jobs",
    labelKey: "navPrintJobs",
    matchMode: "prefix",
  } satisfies ClubNavDef),
  Object.freeze({
    id: "orders",
    routePath: "dashboard/club/orders",
    labelKey: "navOrders",
    matchMode: "prefix",
  } satisfies ClubNavDef),
  Object.freeze({
    id: "invoices",
    routePath: "dashboard/club/invoices",
    labelKey: "navInvoices",
    matchMode: "prefix",
  } satisfies ClubNavDef),
  Object.freeze({
    id: "printer-profiles",
    routePath: "dashboard/club/printer-profiles",
    labelKey: "navPrinterProfiles",
    matchMode: "prefix",
  } satisfies ClubNavDef),
  Object.freeze({
    id: "settings",
    routePath: "dashboard/club/settings",
    labelKey: "navSettings",
    matchMode: "prefix",
  } satisfies ClubNavDef),
]);

function clubNavHref(locale: string, routePath: string): string {
  return `/${locale}/${routePath}`;
}

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

export function ClubAdminLayout({ title, subtitle, children }: ClubAdminLayoutProps) {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  /** Same array reference for the entire component lifetime — no `t`, no locale, no role. */
  const visibleNavDefs = useMemo(() => CLUB_NAV_DEFINITIONS, []);

  const activeId = useMemo(() => {
    const items = CLUB_NAV_DEFINITIONS.map((def) => ({
      id: def.id,
      href: clubNavHref(locale, def.routePath),
      matchMode: def.matchMode,
    }));
    return resolveActiveNavId(pathname, items);
  }, [pathname, locale]);

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
            {visibleNavDefs.map((def) => {
              const href = clubNavHref(locale, def.routePath);
              const isActive = def.id === activeId;
              return (
                <Link
                  key={def.id}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex h-10 min-h-10 items-center justify-center rounded-[var(--radius-form)] px-4 text-sm font-medium ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted"
                  }`}
                >
                  {t(def.labelKey)}
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
