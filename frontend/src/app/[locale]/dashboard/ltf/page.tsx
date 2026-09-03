"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  Building2,
  Clock3,
  IdCard,
  Users,
} from "lucide-react";

import { ActionQueue } from "@/components/club-admin/action-queue";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { formatDisplayDateTime } from "@/lib/date-display";
import { LtfAdminOverviewResponse, getLtfAdminOverview } from "@/lib/ltf-admin-api";

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
      case "paid_pending_transfers":
        return t("overviewActionPaidPendingTransfers");
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
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : !overview ? (
        <EmptyState title={t("overviewEmptyTitle")} description={t("overviewEmptySubtitle")} />
      ) : (
        <div className="space-y-6">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
            <p className="text-meta">
              {lastRefreshAt
                ? t("lastRefreshLabel", { time: formatDisplayDateTime(lastRefreshAt) })
                : t("lastRefreshNever")}
            </p>
            <Button variant="outline" onClick={() => loadOverview({ silent: true })} disabled={isRefreshing}>
              {isRefreshing ? t("refreshingAction") : t("refreshAction")}
            </Button>
          </section>

          <section className="grid gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-4">
            <SummaryCard title={t("totalClubs")} value={String(overview.cards.total_clubs)} icon={Building2} tone="accent" />
            <SummaryCard title={t("activeMembers")} value={String(overview.cards.active_members)} icon={Users} tone="success" />
            <SummaryCard title={t("activeLicenses")} value={String(overview.cards.active_licenses)} icon={IdCard} tone="success" />
            <SummaryCard title={t("pendingLicenses")} value={String(overview.cards.pending_licenses)} icon={Clock3} tone="warning" />
            <SummaryCard title={t("expiredLicenses")} value={String(overview.cards.expired_licenses)} icon={Clock3} tone="neutral" />
            <SummaryCard title={t("revokedLicenses")} value={String(overview.cards.revoked_licenses)} icon={AlertTriangle} tone="danger" />
            <SummaryCard title={t("expiringIn30Days")} value={String(overview.cards.expiring_in_30_days)} icon={AlertTriangle} tone="warning" />
            <SummaryCard
              title={t("membersWithoutValidLicense")}
              value={String(overview.cards.active_members_without_valid_license)}
              icon={Users}
              tone="danger"
            />
          </section>

          <ActionQueue
            title={t("actionQueueTitle")}
            emptyLabel={t("actionQueueAllClear")}
            countLabel={(count) => t("actionQueueCountLabel", { count })}
            openLabel={t("openAction")}
            items={queueWithFindings.map((item) => ({
              id: item.key,
              label: actionLabelByKey(item.key),
              count: item.count,
              severity: item.severity,
              href: `/${locale}${item.link.path}`,
            }))}
          />

          <section className="space-y-3">
            <h2 className="text-section text-foreground">{t("topClubsTitle")}</h2>
            {overview.top_clubs.length === 0 ? (
              <p className="text-sm text-muted">{t("topClubsEmpty")}</p>
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
