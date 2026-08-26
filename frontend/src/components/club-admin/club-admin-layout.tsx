"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  ArrowLeftRight,
  CreditCard,
  FileText,
  IdCard,
  LayoutDashboard,
  Printer,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";

import { IncomingTransferNotice } from "@/components/club-admin/incoming-transfer-notice";
import { AppShell, type AppNavItem } from "@/components/app-shell";

type ClubAdminLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

type NavMatchMode = "exact" | "prefix";

type ClubNavDef = Readonly<{
  id: string;
  routePath: string;
  labelKey:
    | "navOverview"
    | "navMembers"
    | "navLicenses"
    | "navPrintJobs"
    | "navOrders"
    | "navInvoices"
    | "navTransfers"
    | "navPrinterProfiles"
    | "navSettings";
  matchMode: NavMatchMode;
  icon: AppNavItem["icon"];
}>;

const CLUB_NAV_DEFINITIONS: readonly ClubNavDef[] = Object.freeze([
  Object.freeze({
    id: "overview",
    routePath: "dashboard/club",
    labelKey: "navOverview",
    matchMode: "exact",
    icon: LayoutDashboard,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "members",
    routePath: "dashboard/club/members",
    labelKey: "navMembers",
    matchMode: "prefix",
    icon: Users,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "licenses",
    routePath: "dashboard/club/licenses",
    labelKey: "navLicenses",
    matchMode: "prefix",
    icon: IdCard,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "print-jobs",
    routePath: "dashboard/club/print-jobs",
    labelKey: "navPrintJobs",
    matchMode: "prefix",
    icon: Printer,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "orders",
    routePath: "dashboard/club/orders",
    labelKey: "navOrders",
    matchMode: "prefix",
    icon: ShoppingCart,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "invoices",
    routePath: "dashboard/club/invoices",
    labelKey: "navInvoices",
    matchMode: "prefix",
    icon: FileText,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "transfers",
    routePath: "dashboard/club/transfers",
    labelKey: "navTransfers",
    matchMode: "prefix",
    icon: ArrowLeftRight,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "printer-profiles",
    routePath: "dashboard/club/printer-profiles",
    labelKey: "navPrinterProfiles",
    matchMode: "prefix",
    icon: CreditCard,
  } satisfies ClubNavDef),
  Object.freeze({
    id: "settings",
    routePath: "dashboard/club/settings",
    labelKey: "navSettings",
    matchMode: "prefix",
    icon: Settings,
  } satisfies ClubNavDef),
]);

export function ClubAdminLayout({ title, subtitle, children }: ClubAdminLayoutProps) {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  const navItems = useMemo<AppNavItem[]>(
    () =>
      CLUB_NAV_DEFINITIONS.map((def) => ({
        id: def.id,
        href: `/${locale}/${def.routePath}`,
        label: t(def.labelKey),
        icon: def.icon,
        matchMode: def.matchMode,
      })),
    [locale, t]
  );

  return (
    <AppShell title={title} subtitle={subtitle} navItems={navItems}>
      <IncomingTransferNotice />
      {children}
    </AppShell>
  );
}
