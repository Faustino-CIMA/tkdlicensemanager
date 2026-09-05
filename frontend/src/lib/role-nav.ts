import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  Building2,
  Camera,
  CircleDollarSign,
  CreditCard,
  Database,
  FileText,
  History,
  IdCard,
  Languages,
  Layers,
  LayoutDashboard,
  Printer,
  ScrollText,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  ArrowLeftRight,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

export type NavMatchMode = "exact" | "prefix";

export type RoleNavNamespace = "ClubAdmin" | "LtfAdmin" | "LtfFinance" | "Member" | "Ops";

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
    id: "transfers",
    href: (locale) => `/${locale}/dashboard/club/transfers`,
    labelKey: "navTransfers",
    namespace: "ClubAdmin",
    icon: ArrowLeftRight,
    matchMode: "prefix",
  },
  {
    id: "admins",
    href: (locale) => `/${locale}/dashboard/club/admins`,
    labelKey: "navAdmins",
    namespace: "ClubAdmin",
    icon: UserCog,
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
    id: "club-admins",
    href: (locale) => `/${locale}/dashboard/ltf/club-admins`,
    labelKey: "navClubAdmins",
    namespace: "LtfAdmin",
    icon: UserCog,
    matchMode: "prefix",
  },
  {
    id: "member-transfers",
    href: (locale) => `/${locale}/dashboard/ltf/member-transfers`,
    labelKey: "navMemberTransfers",
    namespace: "LtfAdmin",
    icon: ArrowLeftRight,
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
    icon: CircleDollarSign,
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

const OPS_NAV: RoleNavDef[] = [
  {
    id: "overview",
    href: (locale) => `/${locale}/dashboard/ops`,
    labelKey: "navOverview",
    namespace: "Ops",
    icon: LayoutDashboard,
    matchMode: "exact",
  },
  {
    id: "security",
    href: (locale) => `/${locale}/dashboard/ops/security`,
    labelKey: "navSecurity",
    namespace: "Ops",
    icon: ShieldAlert,
    matchMode: "prefix",
  },
  {
    id: "users",
    href: (locale) => `/${locale}/dashboard/ops/users`,
    labelKey: "navUsers",
    namespace: "Ops",
    icon: Users,
    matchMode: "prefix",
  },
  {
    id: "queries",
    href: (locale) => `/${locale}/dashboard/ops/queries`,
    labelKey: "navQueries",
    namespace: "Ops",
    icon: Database,
    matchMode: "prefix",
  },
  {
    id: "translations",
    href: (locale) => `/${locale}/dashboard/ops/translations`,
    labelKey: "navTranslations",
    namespace: "Ops",
    icon: Languages,
    matchMode: "prefix",
  },
  {
    id: "jobs",
    href: (locale) => `/${locale}/dashboard/ops/jobs`,
    labelKey: "navJobs",
    namespace: "Ops",
    icon: Printer,
    matchMode: "prefix",
  },
  {
    id: "audit",
    href: (locale) => `/${locale}/dashboard/ops/audit`,
    labelKey: "navAudit",
    namespace: "Ops",
    icon: ScrollText,
    matchMode: "prefix",
  },
];

export function getRoleNavDefs(role: string, options?: { isSuperuser?: boolean }): RoleNavDef[] {
  if (options?.isSuperuser) {
    return OPS_NAV;
  }
  if (role === "ltf_admin") {
    return LTF_ADMIN_NAV;
  }
  if (role === "ltf_finance") {
    return LTF_FINANCE_NAV;
  }
  if (role === "club_admin") {
    return CLUB_NAV;
  }
  if (role === "coach") {
    return CLUB_NAV.filter((item) => item.id !== "admins");
  }
  if (role === "member") {
    return MEMBER_NAV;
  }
  return [];
}
