"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { clearToken, getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";

export function TopBar() {
  const t = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [hasToken, setHasToken] = useState(false);

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
      <div className="flex items-center justify-end gap-3 px-6 py-4">
        <LanguageSwitcher />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-3 px-6 py-4">
      <LanguageSwitcher />
      <Button variant="outline" onClick={handleAuthClick}>
        {hasToken ? t("signOut") : t("signIn")}
      </Button>
    </div>
  );
}
