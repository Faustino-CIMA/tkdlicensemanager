"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { clearToken, getToken } from "@/lib/auth";
import { apiRequest } from "@/lib/api";
import { useClubSelection } from "@/components/club-selection-provider";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuthMeResponse = {
  username: string;
  first_name: string;
  role: string;
};

export function TopBar() {
  const t = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [token, setToken] = useState<string | null>(() => getToken());
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const { clubs, selectedClubId, setSelectedClubId } = useClubSelection();
  const isDashboardRoute = pathname?.includes("/dashboard");
  const showClubSelector = isDashboardRoute && clubs.length > 0;
  const hasToken = Boolean(token);

  useEffect(() => {
    const refreshAuthState = () => {
      setToken(getToken());
    };

    window.addEventListener("storage", refreshAuthState);
    window.addEventListener("focus", refreshAuthState);
    window.addEventListener("auth-changed", refreshAuthState);

    return () => {
      window.removeEventListener("storage", refreshAuthState);
      window.removeEventListener("focus", refreshAuthState);
      window.removeEventListener("auth-changed", refreshAuthState);
    };
  }, []);

  useEffect(() => {
    if (!token || !isDashboardRoute) {
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
    loadMe();
    return () => {
      cancelled = true;
    };
  }, [token, isDashboardRoute]);

  const handleAuthClick = () => {
    if (hasToken) {
      clearToken();
      setToken(null);
      setMe(null);
    }
    router.push(`/${locale}/login`);
  };

  const displayName = me?.first_name?.trim() || me?.username || t("welcomeFallbackName");
  const roleLabel = me
    ? ({
        ltf_admin: t("roleLtfAdmin"),
        ltf_finance: t("roleLtfFinance"),
        club_admin: t("roleClubAdmin"),
        coach: t("roleCoach"),
        member: t("roleMember"),
      }[me.role] ?? me.role)
    : "";
  const roleTone = me?.role === "ltf_finance" ? "warning" : me?.role === "club_admin" ? "success" : "info";

  const titleClass = "text-xl font-semibold tracking-tight text-[var(--foreground)]";

  if (pathname?.endsWith("/login")) {
    return (
      <div className="sticky top-0 z-50 mx-6 mt-4 flex min-h-[3.25rem] items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/ltf-logo.svg" alt="LTF" width={120} height={36} className="h-9 w-auto shrink-0" />
          <span className={titleClass}>{t("appTitle")}</span>
        </div>
        <LanguageSwitcher />
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-50 mx-6 mt-4 flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-4">
        <Image src="/ltf-logo.svg" alt="LTF" width={120} height={36} className="h-9 w-auto shrink-0" />
        <span className={titleClass}>{t("appTitle")}</span>
      </div>

      <div className="flex w-full min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-x-4 gap-y-3 sm:w-auto sm:basis-auto lg:flex-nowrap">
        {hasToken && isDashboardRoute && me ? (
          <>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:gap-3">
              <div className="min-w-0 text-right">
                <p className="truncate text-xs text-[var(--muted)]">{t("welcomeUser", { name: displayName })}</p>
                <p className="truncate text-xs text-[var(--muted)]">{t("loginAsLabel", { username: me.username })}</p>
              </div>
              <StatusBadge label={roleLabel} tone={roleTone} />
            </div>
            <div
              className="hidden h-9 w-px shrink-0 bg-[var(--border)] sm:block"
              aria-hidden
            />
          </>
        ) : null}

        {showClubSelector ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-sm font-medium text-[var(--muted)]">{t("selectedClubLabel")}</span>
            <Select
              value={selectedClubId ? String(selectedClubId) : ""}
              onValueChange={(value) => setSelectedClubId(Number(value))}
            >
              <SelectTrigger className="min-w-[220px] sm:min-w-[280px] lg:min-w-[360px]">
                <SelectValue placeholder={t("selectedClubPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {clubs.map((club) => (
                  <SelectItem key={club.id} value={String(club.id)}>
                    {club.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <LanguageSwitcher />
        <Button variant="outline" onClick={handleAuthClick}>
          {hasToken ? t("signOut") : t("signIn")}
        </Button>
      </div>
    </div>
  );
}
