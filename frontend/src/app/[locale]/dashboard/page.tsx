"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { apiRequest } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";

type MeResponse = {
  id: number;
  username: string;
  email: string;
  role: string;
};

export default function DashboardPage() {
  const t = useTranslations("Dashboard");
  const router = useRouter();
  const locale = useLocale();
  const [user, setUser] = useState<MeResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const response = await apiRequest<MeResponse>("/api/auth/me/");
        setUser(response);
        const targetRoute = getDashboardRouteForRole(response.role, locale);
        if (targetRoute) {
          router.push(targetRoute);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load user";
        setErrorMessage(message);
      }
    };

    loadUser();
  }, [locale, router]);

  const handleLogout = () => {
    clearToken();
    router.push(`/${locale}/login`);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="app-panel w-full max-w-xl p-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
            <p className="mt-2 text-sm text-muted">{t("subtitle")}</p>
          </div>
          <Button variant="outline" onClick={handleLogout}>
            Logout
          </Button>
        </div>

        <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

        {user ? (
          <div className="mt-6 rounded-[var(--radius-card)] border border-border bg-[var(--surface-secondary)] p-6">
            <p className="text-sm text-muted">Signed in as</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{user.username}</p>
            <p className="mt-2 text-sm text-muted">Role: {user.role}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
