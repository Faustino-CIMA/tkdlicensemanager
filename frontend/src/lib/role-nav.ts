import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  Building2,
  Camera,
  CreditCard,
  FileText,
  History,
  IdCard,
  Layers,
  LayoutDashboard,
  Printer,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

export type NavMatchMode = "exact" | "prefix";

export type RoleNavNamespace = "ClubAdmin" | "LtfAdmin" | "LtfFinance" | "Member";

export type RoleNavDef = {
  id: string;
  href: (locale: string) => string;
  labelKey: string;
  namespace: RoleNavNamespace;
  icon: LucideIcon;
  matchMode: NavMatchMode;
};

const CLUB_NAV: RoleNavDef[] = [
  {
    id: "overview",
    href: (locale) => `/${locale}/dashboard/club`,
    labelKey: "navOverview",
    namespace: "ClubAdmin",
    icon: LayoutDashboard,
    matchMode: "exact",
  },
  {
    id: "members",
    href: (locale) => `/${locale}/dashboard/club/members`,
    labelKey: "navMembers",
    namespace: "ClubAdmin",
    icon: Users,
    matchMode: "prefix",
  },
  {
    id: "licenses",
    href: (locale) => `/${locale}/dashboard/club/licenses`,
    labelKey: "navLicenses",
    namespace: "ClubAdmin",
    icon: IdCard,
    matchMode: "prefix",
  },
  {
    id: "print-jobs",
    href: (locale) => `/${locale}/dashboard/club/print-jobs`,
    labelKey: "navPrintJobs",
    namespace: "ClubAdmin",
    icon: Printer,
    matchMode: "prefix",
  },
  {
    id: "orders",
    href: (locale) => `/${locale}/dashboard/club/orders`,
    labelKey: "navOrders",
    namespace: "ClubAdmin",
    icon: ShoppingCart,
    matchMode: "prefix",
  },
  {
    id: "invoices",
    href: (locale) => `/${locale}/dashboard/club/invoices`,
    labelKey: "navInvoices",
    namespace: "ClubAdmin",
    icon: FileText,
    matchMode: "prefix",
  },
  {
    id: "printer-profiles",
    href: (locale) => `/${locale}/dashboard/club/printer-profiles`,
    labelKey: "navPrinterProfiles",
    namespace: "ClubAdmin",
    icon: CreditCard,
    matchMode: "prefix",
  },
  {
    id: "settings",
    href: (locale) => `/${locale}/dashboard/club/settings`,
    labelKey: "navSettings",
    namespace: "ClubAdmin",
    icon: Settings,
    matchMode: "prefix",
  },
];

const LTF_ADMIN_NAV: RoleNavDef[] = [
  {
    id: "overview",
    href: (locale) => `/${locale}/dashboard/ltf`,
    labelKey: "navOverview",
    namespace: "LtfAdmin",
    icon: LayoutDashboard,
    matchMode: "exact",
  },
  {
    id: "clubs",
    href: (locale) => `/${locale}/dashboard/ltf/clubs`,
    labelKey: "navClubs",
    namespace: "LtfAdmin",
    icon: Building2,
    matchMode: "prefix",
  },
  {
    id: "members",
    href: (locale) => `/${locale}/dashboard/ltf/members`,
    labelKey: "navMembers",
    namespace: "LtfAdmin",
    icon: Users,
    matchMode: "prefix",
  },
  {
    id: "licenses",
    href: (locale) => `/${locale}/dashboard/ltf/licenses`,
    labelKey: "navLicenses",
    namespace: "LtfAdmin",
    icon: IdCard,
    matchMode: "prefix",
  },
  {
    id: "license-cards",
    href: (locale) => `/${locale}/dashboard/ltf/license-cards`,
    labelKey: "navLicenseCards",
    namespace: "LtfAdmin",
    icon: Sparkles,
    matchMode: "prefix",
  },
  {
    id: "license-card-print-jobs",
    href: (locale) => `/${locale}/dashboard/ltf/license-cards/print-jobs`,
    labelKey: "navLicenseCardPrintJobs",
    namespace: "LtfAdmin",
    icon: Printer,
    matchMode: "prefix",
  },
  {
    id: "license-types",
    href: (locale) => `/${locale}/dashboard/ltf/license-types`,
    labelKey: "navLicenseTypes",
    namespace: "LtfAdmin",
    icon: Layers,
    matchMode: "prefix",
  },
  {
    id: "printer-profiles",
    href: (locale) => `/${locale}/dashboard/ltf/printer-profiles`,
    labelKey: "navPrinterProfiles",
    namespace: "LtfAdmin",
    icon: CreditCard,
    matchMode: "prefix",
  },
  {
    id: "settings",
    href: (locale) => `/${locale}/dashboard/ltf/settings`,
    labelKey: "navSettings",
    namespace: "LtfAdmin",
    icon: Settings,
    matchMode: "prefix",
  },
];

const LTF_FINANCE_NAV: RoleNavDef[] = [
  {
    id: "overview",
    href: (locale) => `/${locale}/dashboard/ltf-finance`,
    labelKey: "navOverview",
    namespace: "LtfFinance",
    icon: LayoutDashboard,
    matchMode: "exact",
  },
  {
    id: "orders",
    href: (locale) => `/${locale}/dashboard/ltf-finance/orders`,
    labelKey: "navOrders",
    namespace: "LtfFinance",
    icon: Wallet,
    matchMode: "prefix",
  },
  {
    id: "invoices",
    href: (locale) => `/${locale}/dashboard/ltf-finance/invoices`,
    labelKey: "navInvoices",
    namespace: "LtfFinance",
    icon: FileText,
    matchMode: "prefix",
  },
  {
    id: "payments",
    href: (locale) => `/${locale}/dashboard/ltf-finance/payments`,
    labelKey: "navPayments",
    namespace: "LtfFinance",
    icon: BadgeDollarSign,
    matchMode: "prefix",
  },
  {
    id: "audit-log",
    href: (locale) => `/${locale}/dashboard/ltf-finance/audit-log`,
    labelKey: "navAuditLog",
    namespace: "LtfFinance",
    icon: ScrollText,
    matchMode: "prefix",
  },
  {
    id: "license-settings",
    href: (locale) => `/${locale}/dashboard/ltf-finance/license-settings`,
    labelKey: "navLicenseSettings",
    namespace: "LtfFinance",
    icon: Receipt,
    matchMode: "prefix",
  },
];

const MEMBER_NAV: RoleNavDef[] = [
  {
    id: "overview",
    href: (locale) => `/${locale}/dashboard/member`,
    labelKey: "navOverview",
    namespace: "Member",
    icon: History,
    matchMode: "exact",
  },
  {
    id: "photo",
    href: (locale) => `/${locale}/dashboard/member/photo`,
    labelKey: "navPhoto",
    namespace: "Member",
    icon: Camera,
    matchMode: "prefix",
  },
];

export function getRoleNavDefs(role: string): RoleNavDef[] {
  if (role === "ltf_admin") {
    return LTF_ADMIN_NAV;
  }
  if (role === "ltf_finance") {
    return LTF_FINANCE_NAV;
  }
  if (role === "club_admin" || role === "coach") {
    return CLUB_NAV;
  }
  if (role === "member") {
    return MEMBER_NAV;
  }
  return [];
}
