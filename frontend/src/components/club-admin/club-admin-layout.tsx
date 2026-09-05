"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/api";
import {
  ArrowLeftRight,
  CreditCard,
  FileText,
  IdCard,
  LayoutDashboard,
  Printer,
  Settings,
  ShoppingCart,
  UserCog,
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
    | "navAdmins"
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
    id: "admins",
    routePath: "dashboard/club/admins",
    labelKey: "navAdmins",
    matchMode: "prefix",
    icon: UserCog,
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
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ role: string }>("/api/auth/me/")
      .then((me) => {
        if (!cancelled) setRole(me.role);
      })
      .catch(() => {
        if (!cancelled) setRole(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const navItems = useMemo<AppNavItem[]>(
    () =>
      CLUB_NAV_DEFINITIONS.filter((def) => def.id !== "admins" || role === "club_admin").map((def) => ({
        id: def.id,
        href: `/${locale}/${def.routePath}`,
        label: t(def.labelKey),
        icon: def.icon,
        matchMode: def.matchMode,
      })),
    [locale, role, t]
  );

  return (
    <AppShell title={title} subtitle={subtitle} navItems={navItems}>
      <IncomingTransferNotice />
      {children}
    </AppShell>
  );
}
