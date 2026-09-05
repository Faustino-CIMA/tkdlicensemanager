"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { FormPanel } from "@/components/ui/list-page-chrome";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiRequest } from "@/lib/api";
import { APP_RELEASES, APP_VERSION, GITHUB_RELEASES_URL } from "@/lib/app-version";
import { getToken } from "@/lib/auth";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import { formatDisplayDate } from "@/lib/date-display";

type MeResponse = {
  role: string;
  is_superuser?: boolean;
};

export default function AboutPage() {
  const t = useTranslations("About");
  const locale = useLocale();
  const [dashboardHref, setDashboardHref] = useState(`/${locale}`);

  useEffect(() => {
    if (!getToken()) {
      setDashboardHref(`/${locale}`);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const me = await apiRequest<MeResponse>("/api/auth/me/");
        const target = getDashboardRouteForRole(me.role, locale, {
          isSuperuser: Boolean(me.is_superuser),
        });
        if (!cancelled) {
          setDashboardHref(target ?? `/${locale}/dashboard`);
        }
      } catch {
        if (!cancelled) {
          setDashboardHref(`/${locale}`);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <main className="bg-background px-4 py-10 lg:px-8 lg:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">{t("kicker")}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted">{t("subtitle")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <StatusBadge label={t("versionLabel", { version: APP_VERSION })} tone="info" />
            <Button asChild variant="outline">
              <Link href={dashboardHref}>{t("backToApp")}</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
                {t("githubReleasesLink")}
              </a>
            </Button>
          </div>
        </div>

        {APP_RELEASES.map((release) => {
          const isCurrent = release.version === APP_VERSION;
          return (
            <FormPanel key={release.version} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-section text-foreground">
                    {t("versionLabel", { version: release.version })}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {t(release.titleKey as "release050Title")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isCurrent ? <StatusBadge label={t("currentBadge")} tone="success" /> : null}
                  <p className="text-sm text-muted">{formatDisplayDate(release.date)}</p>
                </div>
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
                {release.itemKeys.map((itemKey) => (
                  <li key={itemKey}>{t(itemKey as "release050UiConsistency")}</li>
                ))}
              </ul>
            </FormPanel>
          );
        })}
      </div>
    </main>
  );
}
