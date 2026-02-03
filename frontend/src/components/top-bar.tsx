"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { clearToken, getToken } from "@/lib/auth";
import { useClubSelection } from "@/components/club-selection-provider";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TopBar() {
  const t = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [hasToken, setHasToken] = useState(false);
  const { clubs, selectedClubId, setSelectedClubId } = useClubSelection();
  const showClubSelector = pathname?.includes("/dashboard") && clubs.length > 0;

  useEffect(() => {
    const refreshAuthState = () => {
      setHasToken(Boolean(getToken()));
    };

    refreshAuthState();
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
    setHasToken(Boolean(getToken()));
  }, [pathname]);

  const handleAuthClick = () => {
    if (hasToken) {
      clearToken();
      setHasToken(false);
    }
    router.push(`/${locale}/login`);
  };

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
  );
}
