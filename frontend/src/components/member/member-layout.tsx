"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Camera, History } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/app-shell";

type MemberLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function MemberLayout({ title, subtitle, children }: MemberLayoutProps) {
  const t = useTranslations("Member");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  const navItems = useMemo<AppNavItem[]>(
    () => [
      {
        id: "overview",
        href: `/${locale}/dashboard/member`,
        label: t("navOverview"),
        icon: History,
        matchMode: "exact",
      },
      {
        id: "photo",
        href: `/${locale}/dashboard/member/photo`,
        label: t("navPhoto"),
        icon: Camera,
        matchMode: "prefix",
      },
    ],
    [locale, t]
  );

  return (
    <AppShell title={title} subtitle={subtitle} navItems={navItems}>
      {children}
    </AppShell>
  );
}
