"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Menu, X } from "lucide-react";

import { apiRequest } from "@/lib/api";
import { logout } from "@/lib/auth-api";
import { clearToken, getToken } from "@/lib/auth";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import {
  ALL_CLUBS_SELECT_VALUE,
  allowsAllClubsSelection,
  persistSelectedClubId,
  resolveAssignedClubId,
  shouldShowClubSelector,
  useClubSelection,
} from "@/components/club-selection-provider";
import { AppVersionLink } from "@/components/app-version-link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AppNavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  matchMode: "exact" | "prefix";
};

type AppShellProps = {
  title: string;
  subtitle?: string;
  navItems: AppNavItem[];
  children: React.ReactNode;
  variant?: "default" | "workspace";
};

type AuthMeResponse = {
  username: string;
  first_name: string;
  role: string;
  is_superuser?: boolean;
};

function pathMatches(pathname: string, href: string, matchMode: AppNavItem["matchMode"]) {
  if (matchMode === "exact") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolveActiveId(pathname: string | null, items: AppNavItem[]) {
  if (!pathname) {
    return null;
  }
  let best: AppNavItem | null = null;
  for (const item of items) {
    if (!pathMatches(pathname, item.href, item.matchMode)) {
      continue;
    }
    if (!best || item.href.length > best.href.length) {
      best = item;
    }
  }
  return best?.id ?? null;
}

export function AppShell({ title, subtitle, navItems, children, variant = "default" }: AppShellProps) {
  const t = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const { clubs, selectedClubId, setSelectedClubId } = useClubSelection();
  const allowAllClubs = allowsAllClubsSelection(pathname);
  const visibleClubId = resolveAssignedClubId(clubs, selectedClubId);
  const showClubSelector = clubs.length > 0 && shouldShowClubSelector(pathname);
  const clubSelectValue = allowAllClubs
    ? selectedClubId && clubs.some((club) => club.id === selectedClubId)
      ? String(selectedClubId)
      : ALL_CLUBS_SELECT_VALUE
    : visibleClubId
      ? String(visibleClubId)
      : undefined;

  const activeId = useMemo(() => resolveActiveId(pathname, navItems), [pathname, navItems]);

  useEffect(() => {
    if (allowAllClubs) {
      return;
    }
    if (visibleClubId && visibleClubId !== selectedClubId) {
      setSelectedClubId(visibleClubId);
    }
  }, [allowAllClubs, visibleClubId, selectedClubId, setSelectedClubId]);

  useEffect(() => {
    if (!getToken()) {
      return;
    }
    let cancelled = false;
    const loadMe = async () => {
      try {
        const response = await apiRequest<AuthMeResponse>("/api/auth/me/");
        if (!cancelled) {
          setMe(response);
        }
      } catch {
        if (!cancelled) {
          setMe(null);
        }
      }
    };
    void loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    await logout();
    clearToken();
    persistSelectedClubId(null);
    setMe(null);
    router.push(`/${locale}/login`);
  };

  const displayName = me?.first_name?.trim() || me?.username || t("welcomeFallbackName");
  const roleLabel = me
    ? me.is_superuser
      ? t("roleSuperuser")
      : ({
          ltf_admin: t("roleLtfAdmin"),
          ltf_finance: t("roleLtfFinance"),
          club_admin: t("roleClubAdmin"),
          coach: t("roleCoach"),
          member: t("roleMember"),
        }[me.role] ?? me.role)
    : "";
  const roleTone = me?.is_superuser
    ? "danger"
    : me?.role === "ltf_finance"
      ? "warning"
      : me?.role === "club_admin"
        ? "success"
        : "info";

  const isOpsDashboard = (pathname || "").includes("/dashboard/ops");
  const federationHref = me
    ? getDashboardRouteForRole(me.role, locale)
    : null;
  const showOpsConsoleButton = Boolean(me?.is_superuser && !isOpsDashboard);
  const showFederationDashboardButton = Boolean(
    me?.is_superuser &&
      isOpsDashboard &&
      federationHref &&
      !federationHref.includes("/dashboard/ops"),
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] bg-[oklch(22%_0.06_232)]">
          <Image src="/ltf-logo.svg" alt="LTF" width={88} height={28} className="h-6 w-auto" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">{t("appTitle")}</p>
          <p className="truncate text-meta">LTF</p>
        </div>
      </div>
      <nav aria-label={t("navigationLabel")} className="flex flex-1 flex-col gap-1 px-3 pb-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeId;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={() => setNavOpen(false)}
              className={cn(
                "flex min-h-[var(--control-height)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3">
        <AppVersionLink />
      </div>
    </div>
  );

  const isWorkspace = variant === "workspace";

  return (
    <div className={cn("bg-background", isWorkspace ? "flex h-screen overflow-hidden" : "min-h-screen lg:flex")}>
      {isWorkspace ? null : (
        <aside className="sticky top-0 hidden h-screen w-[var(--sidebar-width)] shrink-0 border-r border-border bg-surface lg:block">
          {sidebar}
        </aside>
      )}

      {navOpen && !isWorkspace ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--modal-backdrop)]"
            aria-label={t("navClose")}
            onClick={() => setNavOpen(false)}
          />
          <aside className="relative h-full w-[min(var(--sidebar-width),86vw)] bg-surface shadow-[var(--shadow-float)]">
            <button
              type="button"
              className="absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-secondary hover:text-foreground"
              onClick={() => setNavOpen(false)}
              aria-label={t("navClose")}
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-40 shrink-0 border-b border-border/80 bg-surface/90 backdrop-blur-md">
          <div
            className={cn(
              "flex min-h-[var(--topbar-height)] flex-wrap items-center justify-between gap-3",
              isWorkspace ? "px-3 py-2" : "px-4 py-3 lg:px-8"
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              {isWorkspace ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setNavOpen(true)}
                  aria-label={t("navOpen")}
                >
                  <Menu className="size-4" />
                </Button>
              )}
              <div className="min-w-0">
                <h1 className="text-title truncate text-foreground">{title}</h1>
                {subtitle && !isWorkspace ? <p className="mt-0.5 truncate text-meta">{subtitle}</p> : null}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
              {showClubSelector ? (
                <Select
                  value={clubSelectValue}
                  onValueChange={(value) =>
                    setSelectedClubId(value === ALL_CLUBS_SELECT_VALUE ? null : Number(value))
                  }
                >
                  <SelectTrigger className="min-w-[180px] sm:min-w-[240px]" aria-label={t("selectedClubLabel")}>
                    <SelectValue placeholder={t("selectedClubPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {allowAllClubs ? (
                      <SelectItem value={ALL_CLUBS_SELECT_VALUE}>{t("allClubsOption")}</SelectItem>
                    ) : null}
                    {clubs.map((club) => (
                      <SelectItem key={club.id} value={String(club.id)}>
                        {club.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {me ? (
                <div className="hidden items-center gap-2 sm:flex">
                  <div className="min-w-0 text-right">
                    <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                    <p className="truncate text-meta">{me.username}</p>
                  </div>
                  <StatusBadge label={roleLabel} tone={roleTone} />
                </div>
              ) : null}

              {showOpsConsoleButton ? (
                <Button asChild variant="outline">
                  <Link href={`/${locale}/dashboard/ops`}>{t("openOpsConsole")}</Link>
                </Button>
              ) : null}
              {showFederationDashboardButton && federationHref ? (
                <Button asChild variant="outline">
                  <Link href={federationHref}>{t("openFederationDashboard")}</Link>
                </Button>
              ) : null}
              <LanguageSwitcher compact />
              <Button variant="outline" onClick={handleSignOut}>
                {t("signOut")}
              </Button>
            </div>
          </div>
        </header>

        <main
          className={cn(
            "min-w-0 flex-1",
            isWorkspace
              ? "flex min-h-0 flex-col overflow-hidden p-0"
              : "px-4 py-6 lg:px-8 lg:py-8"
          )}
        >
          {isWorkspace ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}
