"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { BadgeDollarSign, FileText, LayoutDashboard, Receipt, ScrollText, Wallet } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/app-shell";

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
  icon: AppNavItem["icon"];
};

const LTF_FINANCE_NAV_DEFINITIONS: LtfFinanceNavDef[] = [
  {
    id: "overview",
    href: (l) => `/${l}/dashboard/ltf-finance`,
    labelKey: "navOverview",
    matchMode: "exact",
    icon: LayoutDashboard,
  },
  { id: "orders", href: (l) => `/${l}/dashboard/ltf-finance/orders`, labelKey: "navOrders", matchMode: "prefix", icon: Wallet },
  {
    id: "invoices",
    href: (l) => `/${l}/dashboard/ltf-finance/invoices`,
    labelKey: "navInvoices",
    matchMode: "prefix",
    icon: FileText,
  },
  {
    id: "payments",
    href: (l) => `/${l}/dashboard/ltf-finance/payments`,
    labelKey: "navPayments",
    matchMode: "prefix",
    icon: BadgeDollarSign,
  },
  {
    id: "audit-log",
    href: (l) => `/${l}/dashboard/ltf-finance/audit-log`,
    labelKey: "navAuditLog",
    matchMode: "prefix",
    icon: ScrollText,
  },
  {
    id: "license-settings",
    href: (l) => `/${l}/dashboard/ltf-finance/license-settings`,
    labelKey: "navLicenseSettings",
    matchMode: "prefix",
    icon: Receipt,
  },
];

export function LtfFinanceLayout({ title, subtitle, children }: LtfFinanceLayoutProps) {
  const t = useTranslations("LtfFinance");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  const navItems = useMemo<AppNavItem[]>(
    () =>
      LTF_FINANCE_NAV_DEFINITIONS.map((def) => ({
        id: def.id,
        href: def.href(locale),
        label: t(def.labelKey),
        icon: def.icon,
        matchMode: def.matchMode,
      })),
    [locale, t]
  );

  return (
    <AppShell title={title} subtitle={subtitle} navItems={navItems}>
      {children}
    </AppShell>
  );
}
