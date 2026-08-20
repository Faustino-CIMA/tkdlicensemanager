"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { APP_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";

export function AppVersionLink({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("About");

  return (
    <Link
      href={`/${locale}/about`}
      className={cn(
        "inline-flex min-h-[var(--control-height)] items-center rounded-[var(--radius-form)] px-2 text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline",
        className
      )}
      aria-label={t("versionLinkAriaLabel", { version: APP_VERSION })}
    >
      {t("versionLabel", { version: APP_VERSION })}
    </Link>
  );
}
