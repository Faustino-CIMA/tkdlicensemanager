"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  ArrowLeftRight,
  Building2,
  CreditCard,
  IdCard,
  LayoutDashboard,
  Layers,
  Printer,
  Settings,
  Sparkles,
  UserCog,
  Users,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/app-shell";

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
    | "navClubAdmins"
    | "navMemberTransfers"
    | "navMembers"
    | "navLicenses"
    | "navLicenseCards"
    | "navLicenseCardPrintJobs"
    | "navLicenseTypes"
    | "navPrinterProfiles"
    | "navSettings";
  matchMode: NavMatchMode;
  icon: AppNavItem["icon"];
};

const LTF_NAV_DEFINITIONS: LtfNavDef[] = [
  { id: "overview", href: (l) => `/${l}/dashboard/ltf`, labelKey: "navOverview", matchMode: "exact", icon: LayoutDashboard },
  { id: "clubs", href: (l) => `/${l}/dashboard/ltf/clubs`, labelKey: "navClubs", matchMode: "prefix", icon: Building2 },
  { id: "club-admins", href: (l) => `/${l}/dashboard/ltf/club-admins`, labelKey: "navClubAdmins", matchMode: "prefix", icon: UserCog },
  { id: "member-transfers", href: (l) => `/${l}/dashboard/ltf/member-transfers`, labelKey: "navMemberTransfers", matchMode: "prefix", icon: ArrowLeftRight },
  { id: "members", href: (l) => `/${l}/dashboard/ltf/members`, labelKey: "navMembers", matchMode: "prefix", icon: Users },
  { id: "licenses", href: (l) => `/${l}/dashboard/ltf/licenses`, labelKey: "navLicenses", matchMode: "prefix", icon: IdCard },
  {
    id: "license-cards",
    href: (l) => `/${l}/dashboard/ltf/license-cards`,
    labelKey: "navLicenseCards",
    matchMode: "prefix",
    icon: Sparkles,
  },
  {
    id: "license-card-print-jobs",
    href: (l) => `/${l}/dashboard/ltf/license-cards/print-jobs`,
    labelKey: "navLicenseCardPrintJobs",
    matchMode: "prefix",
    icon: Printer,
  },
  {
    id: "license-types",
    href: (l) => `/${l}/dashboard/ltf/license-types`,
    labelKey: "navLicenseTypes",
    matchMode: "prefix",
    icon: Layers,
  },
  {
    id: "printer-profiles",
    href: (l) => `/${l}/dashboard/ltf/printer-profiles`,
    labelKey: "navPrinterProfiles",
    matchMode: "prefix",
    icon: CreditCard,
  },
  { id: "settings", href: (l) => `/${l}/dashboard/ltf/settings`, labelKey: "navSettings", matchMode: "prefix", icon: Settings },
];

export function LtfAdminLayout({ title, subtitle, children }: LtfAdminLayoutProps) {
  const t = useTranslations("LtfAdmin");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";
  const isDesignerWorkspace = /\/dashboard\/ltf\/license-cards\/[^/]+\/designer(?:\/|$)/.test(
    pathname || ""
  );

  const navItems = useMemo<AppNavItem[]>(
    () =>
      LTF_NAV_DEFINITIONS.map((def) => ({
        id: def.id,
        href: def.href(locale),
        label: t(def.labelKey),
        icon: def.icon,
        matchMode: def.matchMode,
      })),
    [locale, t]
  );

  return (
    <AppShell
      title={title}
      subtitle={subtitle}
      navItems={navItems}
      variant={isDesignerWorkspace ? "workspace" : "default"}
    >
      {children}
    </AppShell>
  );
}
