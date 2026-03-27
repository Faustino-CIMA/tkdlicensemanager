"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api";

type AuthMeResponse = { role: string };

type ClubAdminLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function ClubAdminLayout({ title, subtitle, children }: ClubAdminLayoutProps) {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadRole = async () => {
      try {
        const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
        if (isMounted) setCurrentRole(me.role);
      } catch {
        if (isMounted) setCurrentRole(null);
      }
    };
    void loadRole();
    return () => {
      isMounted = false;
    };
  }, []);

  const navItems = useMemo(() => {
    const base = [
      { href: `/${locale}/dashboard/club`, label: t("navOverview"), matchChildren: false },
      { href: `/${locale}/dashboard/club/members`, label: t("navMembers"), matchChildren: true },
      { href: `/${locale}/dashboard/club/licenses`, label: t("navLicenses"), matchChildren: true },
      { href: `/${locale}/dashboard/club/print-jobs`, label: t("navPrintJobs"), matchChildren: true },
      { href: `/${locale}/dashboard/club/orders`, label: t("navOrders"), matchChildren: true },
      { href: `/${locale}/dashboard/club/invoices`, label: t("navInvoices"), matchChildren: true },
    ];
    if (currentRole === "club_admin") {
      base.push({
        href: `/${locale}/dashboard/club/printer-profiles`,
        label: t("navPrinterProfiles"),
        matchChildren: true,
      });
    }
    base.push({ href: `/${locale}/dashboard/club/settings`, label: t("navSettings"), matchChildren: true });
    return base;
  }, [locale, t, currentRole]);

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
          <nav className="mt-6 flex flex-wrap gap-2">
            {navItems.map((item) => {
              const isActive = item.matchChildren
                ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-[var(--radius-form)] px-4 py-2 text-sm font-medium ${
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
