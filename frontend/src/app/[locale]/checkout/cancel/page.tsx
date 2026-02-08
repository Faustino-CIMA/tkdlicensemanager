"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export default function CheckoutCancelPage() {
  const t = useTranslations("Checkout");
  const locale = useLocale();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-xl rounded-3xl bg-white p-10 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">{t("cancelTitle")}</h1>
        <p className="mt-3 text-sm text-zinc-500">{t("cancelSubtitle")}</p>
        <div className="mt-6 flex justify-center">
          <Button variant="outline" asChild>
            <Link href={`/${locale}/dashboard`}>{t("cancelAction")}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
