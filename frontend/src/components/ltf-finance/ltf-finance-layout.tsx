"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

type LtfFinanceLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

type NavMatchMode = "exact" | "prefix";

type LtfFinanceNavDef = {
  id: string;
  href: (locale: string) => string;
  labelKey: "navOverview" | "navOrders" | "navInvoices" | "navPayments" | "navAuditLog" | "navLicenseSettings";
  matchMode: NavMatchMode;
};

/** Fixed order — single active tab via longest matching href. */
const LTF_FINANCE_NAV_DEFINITIONS: LtfFinanceNavDef[] = [
  {
    id: "overview",
    href: (l) => `/${l}/dashboard/ltf-finance`,
    labelKey: "navOverview",
    matchMode: "exact",
  },
  { id: "orders", href: (l) => `/${l}/dashboard/ltf-finance/orders`, labelKey: "navOrders", matchMode: "prefix" },
  {
    id: "invoices",
    href: (l) => `/${l}/dashboard/ltf-finance/invoices`,
    labelKey: "navInvoices",
    matchMode: "prefix",
  },
  {
    id: "payments",
    href: (l) => `/${l}/dashboard/ltf-finance/payments`,
    labelKey: "navPayments",
    matchMode: "prefix",
  },
  {
    id: "audit-log",
    href: (l) => `/${l}/dashboard/ltf-finance/audit-log`,
    labelKey: "navAuditLog",
    matchMode: "prefix",
  },
  {
    id: "license-settings",
    href: (l) => `/${l}/dashboard/ltf-finance/license-settings`,
    labelKey: "navLicenseSettings",
    matchMode: "prefix",
  },
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

export function LtfFinanceLayout({ title, subtitle, children }: LtfFinanceLayoutProps) {
  const t = useTranslations("LtfFinance");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  const navItems = useMemo(
    () =>
      LTF_FINANCE_NAV_DEFINITIONS.map((def) => ({
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
                  className={`inline-flex h-10 min-h-10 items-center justify-center rounded-[var(--radius-form)] px-4 text-sm font-medium ${
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
