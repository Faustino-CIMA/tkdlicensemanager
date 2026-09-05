"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Database,
  Languages,
  LayoutDashboard,
  Printer,
  ScrollText,
  ShieldAlert,
  Users,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/app-shell";
import { apiRequest } from "@/lib/api";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import { Spinner } from "@/components/ui/spinner";

type OpsLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

type MeResponse = {
  role: string;
  is_superuser?: boolean;
};

const OPS_NAV: Array<{
  id: string;
  href: (locale: string) => string;
  labelKey:
    | "navOverview"
    | "navSecurity"
    | "navUsers"
    | "navQueries"
    | "navTranslations"
    | "navJobs"
    | "navAudit";
  matchMode: AppNavItem["matchMode"];
  icon: AppNavItem["icon"];
}> = [
  { id: "overview", href: (l) => `/${l}/dashboard/ops`, labelKey: "navOverview", matchMode: "exact", icon: LayoutDashboard },
  { id: "security", href: (l) => `/${l}/dashboard/ops/security`, labelKey: "navSecurity", matchMode: "prefix", icon: ShieldAlert },
  { id: "users", href: (l) => `/${l}/dashboard/ops/users`, labelKey: "navUsers", matchMode: "prefix", icon: Users },
  { id: "queries", href: (l) => `/${l}/dashboard/ops/queries`, labelKey: "navQueries", matchMode: "prefix", icon: Database },
  { id: "translations", href: (l) => `/${l}/dashboard/ops/translations`, labelKey: "navTranslations", matchMode: "prefix", icon: Languages },
  { id: "jobs", href: (l) => `/${l}/dashboard/ops/jobs`, labelKey: "navJobs", matchMode: "prefix", icon: Printer },
  { id: "audit", href: (l) => `/${l}/dashboard/ops/audit`, labelKey: "navAudit", matchMode: "prefix", icon: ScrollText },
];

export function OpsLayout({ title, subtitle, children }: OpsLayoutProps) {
  const t = useTranslations("Ops");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const me = await apiRequest<MeResponse>("/api/auth/me/");
        if (cancelled) return;
        if (!me.is_superuser) {
          const fallback = getDashboardRouteForRole(me.role, locale) ?? `/${locale}/dashboard`;
          router.replace(fallback);
          setAllowed(false);
          return;
        }
        setAllowed(true);
      } catch {
        if (!cancelled) {
          router.replace(`/${locale}/login`);
          setAllowed(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [locale, router]);

  const navItems = useMemo<AppNavItem[]>(
    () =>
      OPS_NAV.map((def) => ({
        id: def.id,
        href: def.href(locale),
        label: t(def.labelKey),
        icon: def.icon,
        matchMode: def.matchMode,
      })),
    [locale, t],
  );

  if (allowed !== true) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted" role="status">
          <Spinner />
          {common("loadingLabel")}
        </div>
      </main>
    );
  }

  return (
    <AppShell title={title} subtitle={subtitle} navItems={navItems}>
      {children}
    </AppShell>
  );
}
