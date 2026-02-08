"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { apiRequest } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";

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
        if (response.role === "ltf_admin") {
          router.push(`/${locale}/dashboard/ltf`);
          return;
        }
        if (response.role === "ltf_finance") {
          router.push(`/${locale}/dashboard/ltf-finance`);
          return;
        }
        if (response.role === "club_admin") {
          router.push(`/${locale}/dashboard/club`);
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
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-3xl rounded-3xl bg-white p-10 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">{t("title")}</h1>
            <p className="mt-2 text-sm text-zinc-500">{t("subtitle")}</p>
          </div>
          <Button variant="outline" onClick={handleLogout}>
            Logout
          </Button>
        </div>

        {errorMessage ? <p className="mt-6 text-sm text-red-600">{errorMessage}</p> : null}

        {user ? (
          <div className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 p-6">
            <p className="text-sm text-zinc-500">Signed in as</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{user.username}</p>
            <p className="mt-2 text-sm text-zinc-600">Role: {user.role}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
