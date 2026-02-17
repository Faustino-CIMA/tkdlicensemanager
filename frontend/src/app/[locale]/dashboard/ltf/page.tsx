"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { Button } from "@/components/ui/button";
import { formatDisplayDateTime } from "@/lib/date-display";
import { LtfAdminOverviewResponse, getLtfAdminOverview } from "@/lib/ltf-admin-api";

function getSeverityClasses(severity: "info" | "warning" | "critical") {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

export default function LtfAdminOverviewPage() {
  const t = useTranslations("LtfAdmin");
  const locale = useLocale();
  const [overview, setOverview] = useState<LtfAdminOverviewResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const loadOverview = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorMessage(null);
      try {
        const response = await getLtfAdminOverview();
        setOverview(response);
        setLastRefreshAt(response.meta.generated_at || new Date().toISOString());
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
      } finally {
        if (silent) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [t]
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const queueWithFindings = useMemo(
    () => (overview ? overview.action_queue.filter((item) => item.count > 0) : []),
    [overview]
  );

  const actionLabelByKey = (key: LtfAdminOverviewResponse["action_queue"][number]["key"]) => {
    switch (key) {
      case "clubs_without_admin":
        return t("overviewActionClubsWithoutAdmin");
      case "members_missing_ltf_licenseid":
        return t("overviewActionMissingLtfLicenseId");
      case "members_without_active_or_pending_license":
        return t("overviewActionMembersWithoutValidLicense");
      default:
        return key;
    }
  };

  return (
    <LtfAdminLayout title={t("overviewTitle")} subtitle={t("overviewSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : !overview ? (
        <EmptyState title={t("overviewEmptyTitle")} description={t("overviewEmptySubtitle")} />
      ) : (
        <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-zinc-500">
              {lastRefreshAt
                ? t("lastRefreshLabel", { time: formatDisplayDateTime(lastRefreshAt) })
                : t("lastRefreshNever")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadOverview({ silent: true })}
              disabled={isRefreshing}
            >
              {isRefreshing ? t("refreshingAction") : t("refreshAction")}
            </Button>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard title={t("totalClubs")} value={String(overview.cards.total_clubs)} />
            <SummaryCard title={t("activeMembers")} value={String(overview.cards.active_members)} />
            <SummaryCard title={t("activeLicenses")} value={String(overview.cards.active_licenses)} />
            <SummaryCard title={t("pendingLicenses")} value={String(overview.cards.pending_licenses)} />
            <SummaryCard title={t("expiredLicenses")} value={String(overview.cards.expired_licenses)} />
            <SummaryCard title={t("revokedLicenses")} value={String(overview.cards.revoked_licenses)} />
            <SummaryCard title={t("expiringIn30Days")} value={String(overview.cards.expiring_in_30_days)} />
            <SummaryCard
              title={t("membersWithoutValidLicense")}
              value={String(overview.cards.active_members_without_valid_license)}
            />
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("actionQueueTitle")}</h2>
            {queueWithFindings.length === 0 ? (
              <p className="text-sm text-zinc-600">{t("actionQueueAllClear")}</p>
            ) : (
              <div className="space-y-2">
                {queueWithFindings.map((item) => (
                  <div
                    key={item.key}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3 ${getSeverityClasses(item.severity)}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{actionLabelByKey(item.key)}</p>
                      <p className="text-xs opacity-90">{t("actionQueueCountLabel", { count: item.count })}</p>
                    </div>
                    <Link
                      className="rounded-full border border-current px-3 py-1 text-xs font-medium"
                      href={`/${locale}${item.link.path}`}
                    >
                      {t("openAction")}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("topClubsTitle")}</h2>
            {overview.top_clubs.length === 0 ? (
              <p className="text-sm text-zinc-600">{t("topClubsEmpty")}</p>
            ) : (
              <EntityTable
                columns={[
                  { key: "club_name", header: t("clubLabel") },
                  { key: "active_members", header: t("activeMembers") },
                  { key: "active_licenses", header: t("activeLicenses") },
                  { key: "pending_licenses", header: t("pendingLicenses") },
                ]}
                rows={overview.top_clubs.map((row) => ({
                  id: row.club_id,
                  ...row,
                }))}
              />
            )}
          </section>
        </div>
      )}
    </LtfAdminLayout>
  );
}
