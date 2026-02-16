"use client";

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
  }, [token, isDashboardRoute, pathname]);

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

  if (pathname?.endsWith("/login")) {
    return (
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <img src="/ltf-logo.svg" alt="LTF Logo" className="h-9 w-auto" />
          <span className="text-base font-semibold text-zinc-900">{t("appTitle")}</span>
        </div>
        <LanguageSwitcher />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-6 py-4">
      <div className="flex items-center gap-5">
        <img src="/ltf-logo.svg" alt="LTF Logo" className="h-9 w-auto" />
        <span className="text-3xl font-semibold text-zinc-900">{t("appTitle")}</span>
      </div>
      <div className="flex flex-col items-end gap-2">
        {hasToken && isDashboardRoute && me ? (
          <div className="flex max-w-full items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-right">
              <p className="text-xs text-zinc-500">{t("welcomeUser", { name: displayName })}</p>
              <p className="text-xs text-zinc-600">{t("loginAsLabel", { username: me.username })}</p>
            </div>
            <StatusBadge label={roleLabel} tone={roleTone} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-4">
          {showClubSelector ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-500">{t("selectedClubLabel")}</span>
              <Select
                value={selectedClubId ? String(selectedClubId) : ""}
                onValueChange={(value) => setSelectedClubId(Number(value))}
              >
                <SelectTrigger className="min-w-[420px]">
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
    </div>
  );
}
