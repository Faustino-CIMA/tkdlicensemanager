"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { clearToken, getToken } from "@/lib/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("Common");
  const [hasToken, setHasToken] = useState(false);
  const isDashboard = pathname.includes("/dashboard");
  const isAuthPage = /\/(login|register|verify-email|reset-password)(\/|$)/.test(pathname);

  useEffect(() => {
    const refresh = () => setHasToken(Boolean(getToken()));
    refresh();
    window.addEventListener("auth-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("auth-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (isDashboard) {
    return <>{children}</>;
  }

  if (isAuthPage) {
    return (
      <>
        <div className="fixed right-4 top-4 z-50">
          <LanguageSwitcher compact />
        </div>
        {children}
      </>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex min-h-[var(--topbar-height)] w-full max-w-[1440px] items-center justify-between gap-4 px-4 lg:px-8">
          <Link href={`/${locale}`} className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-[var(--radius-control)] bg-[oklch(22%_0.06_232)]">
              <Image src="/ltf-logo.svg" alt="LTF" width={80} height={24} className="h-5 w-auto" />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">{t("appTitle")}</span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            {hasToken ? (
              <Button
                variant="outline"
                onClick={() => {
                  clearToken();
                  router.push(`/${locale}/login`);
                }}
              >
                {t("signOut")}
              </Button>
            ) : (
              <Button asChild>
                <Link href={`/${locale}/login`}>{t("signIn")}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
