"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

export default function LtfFinanceDashboardPage() {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    router.replace(`/${locale}/dashboard/ltf-finance/orders`);
  }, [locale, router]);

  return null;
}
