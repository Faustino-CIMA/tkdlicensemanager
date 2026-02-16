"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import {
  LtfFinanceOverviewResponse,
  getLtfFinanceOverview,
} from "@/lib/ltf-finance-api";

function getSeverityClasses(severity: "info" | "warning" | "critical") {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export default function LtfFinanceDashboardPage() {
  const t = useTranslations("LtfFinance");
  const locale = useLocale();
  const [overview, setOverview] = useState<LtfFinanceOverviewResponse | null>(null);
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
        const response = await getLtfFinanceOverview();
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

  const actionLabelByKey = (key: LtfFinanceOverviewResponse["action_queue"][number]["key"]) => {
    switch (key) {
      case "issued_invoices_overdue_7d":
        return t("overviewActionIssuedInvoicesOverdue7d");
      case "license_types_without_active_price":
        return t("overviewActionMissingActivePrice");
      case "paid_orders_with_pending_licenses":
        return t("overviewActionPaidOrdersPendingLicenses");
      case "failed_or_cancelled_payments_30d":
        return t("overviewActionFailedOrCancelledPayments30d");
      default:
        return key;
    }
  };

  return (
    <LtfFinanceLayout title={t("overviewTitle")} subtitle={t("overviewSubtitle")}>
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
                ? t("lastRefreshLabel", { time: formatDateTime(lastRefreshAt) })
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
            <SummaryCard title={t("ordersReceivedCountLabel")} value={String(overview.cards.received_orders)} />
            <SummaryCard title={t("ordersDeliveredCountLabel")} value={String(overview.cards.delivered_orders)} />
            <SummaryCard title={t("ordersCancelledCountLabel")} value={String(overview.cards.cancelled_orders)} />
            <SummaryCard title={t("invoicesIssuedCountLabel")} value={String(overview.cards.issued_invoices_open)} />
            <SummaryCard title={t("invoicesPaidCountLabel")} value={String(overview.cards.paid_invoices)} />
            <SummaryCard
              title={t("outstandingAmountLabel")}
              value={`${overview.cards.outstanding_amount} ${overview.currency}`}
            />
            <SummaryCard
              title={t("collectedThisMonthLabel")}
              value={`${overview.cards.collected_this_month_amount} ${overview.currency}`}
            />
            <SummaryCard
              title={t("pricingCoverageLabel")}
              value={`${overview.cards.pricing_coverage.with_active_price}/${overview.cards.pricing_coverage.total_license_types}`}
              helper={t("pricingCoverageHelper", {
                missing: overview.cards.pricing_coverage.missing_active_price,
              })}
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

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-zinc-900">{t("ordersDistributionTitle")}</h3>
              <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                <p>{t("statusDraftLabel", { count: overview.distributions.orders_by_status.draft })}</p>
                <p>{t("statusPendingLabel", { count: overview.distributions.orders_by_status.pending })}</p>
                <p>{t("statusPaidLabel", { count: overview.distributions.orders_by_status.paid })}</p>
                <p>
                  {t("statusCancelledCombinedLabel", {
                    count:
                      overview.distributions.orders_by_status.cancelled +
                      overview.distributions.orders_by_status.refunded,
                  })}
                </p>
              </div>
            </article>
            <article className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-zinc-900">{t("invoicesDistributionTitle")}</h3>
              <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                <p>{t("statusDraftLabel", { count: overview.distributions.invoices_by_status.draft })}</p>
                <p>{t("statusIssuedLabel", { count: overview.distributions.invoices_by_status.issued })}</p>
                <p>{t("statusPaidLabel", { count: overview.distributions.invoices_by_status.paid })}</p>
                <p>{t("statusVoidLabel", { count: overview.distributions.invoices_by_status.void })}</p>
              </div>
            </article>
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("recentActivityTitle")}</h2>
            {overview.recent_activity.length === 0 ? (
              <p className="text-sm text-zinc-600">{t("recentActivityEmpty")}</p>
            ) : (
              <EntityTable
                columns={[
                  {
                    key: "created_at",
                    header: t("createdAtLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      formatDateTime(row.created_at),
                  },
                  { key: "action", header: t("actionLabel") },
                  { key: "message", header: t("messageLabel") },
                  {
                    key: "club_id",
                    header: t("clubLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      row.club_id ?? "-",
                  },
                  {
                    key: "order_id",
                    header: t("orderLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      row.order_id ?? "-",
                  },
                  {
                    key: "invoice_id",
                    header: t("invoiceNumberLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      row.invoice_id ?? "-",
                  },
                ]}
                rows={overview.recent_activity}
              />
            )}
          </section>
        </div>
      )}
    </LtfFinanceLayout>
  );
}
