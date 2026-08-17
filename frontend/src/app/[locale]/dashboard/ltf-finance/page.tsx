"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, BadgeEuro, Receipt, ShoppingCart } from "lucide-react";

import { ActionQueue } from "@/components/club-admin/action-queue";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { StatBreakdown } from "@/components/club-admin/stat-breakdown";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  LtfFinanceOverviewResponse,
  getLtfFinanceOverview,
} from "@/lib/ltf-finance-api";

const AUTO_REFRESH_INTERVAL_MS = 30000;



export default function LtfFinanceDashboardPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const [overview, setOverview] = useState<LtfFinanceOverviewResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const isRequestInFlightRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);

  const loadOverview = useCallback(
    async (options?: { mode?: "initial" | "manual" | "background" }) => {
      const mode = options?.mode ?? "initial";
      if (isRequestInFlightRef.current) {
        return;
      }
      const controller = new AbortController();
      isRequestInFlightRef.current = true;
      requestAbortRef.current = controller;
      if (mode === "manual") {
        setIsRefreshing(true);
      } else if (mode === "initial") {
        setIsLoading(true);
      }
      if (mode !== "background") {
        setErrorMessage(null);
      }
      try {
        const response = await getLtfFinanceOverview({ signal: controller.signal });
        setOverview(response);
        setLastRefreshAt(response.meta.generated_at || new Date().toISOString());
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (mode !== "background") {
          setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
        }
      } finally {
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
        }
        isRequestInFlightRef.current = false;
        if (mode === "manual") {
          setIsRefreshing(false);
        } else if (mode === "initial") {
          setIsLoading(false);
        }
      }
    },
    [t]
  );

  useEffect(() => {
    void loadOverview({ mode: "initial" });
  }, [loadOverview]);

  useEffect(() => {
    return () => {
      requestAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") {
        void loadOverview({ mode: "background" });
      }
    };
    const intervalId = window.setInterval(refreshInBackground, AUTO_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
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
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : !overview ? (
        <EmptyState title={t("overviewEmptyTitle")} description={t("overviewEmptySubtitle")} />
      ) : (
        <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-meta">
              {lastRefreshAt
                ? t("lastRefreshLabel", { time: formatDisplayDateTime(lastRefreshAt) })
                : t("lastRefreshNever")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadOverview({ mode: "manual" })}
              disabled={isRefreshing}
            >
              {isRefreshing ? t("refreshingAction") : t("refreshAction")}
            </Button>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard title={t("ordersReceivedCountLabel")} value={String(overview.cards.received_orders)} icon={ShoppingCart} tone="accent" />
            <SummaryCard title={t("ordersDeliveredCountLabel")} value={String(overview.cards.delivered_orders)} icon={ShoppingCart} tone="success" />
            <SummaryCard title={t("ordersCancelledCountLabel")} value={String(overview.cards.cancelled_orders)} icon={AlertTriangle} tone="danger" />
            <SummaryCard title={t("invoicesIssuedCountLabel")} value={String(overview.cards.issued_invoices_open)} icon={Receipt} tone="warning" />
            <SummaryCard title={t("invoicesPaidCountLabel")} value={String(overview.cards.paid_invoices)} icon={Receipt} tone="success" />
            <SummaryCard
              title={t("outstandingAmountLabel")}
              value={`${overview.cards.outstanding_amount} ${overview.currency}`}
              icon={BadgeEuro}
              tone="danger"
            />
            <SummaryCard
              title={t("collectedThisMonthLabel")}
              value={`${overview.cards.collected_this_month_amount} ${overview.currency}`}
              icon={BadgeEuro}
              tone="success"
            />
            <SummaryCard
              title={t("pricingCoverageLabel")}
              value={`${overview.cards.pricing_coverage.with_active_price}/${overview.cards.pricing_coverage.total_license_types}`}
              helper={t("pricingCoverageHelper", {
                missing: overview.cards.pricing_coverage.missing_active_price,
              })}
              icon={Receipt}
              tone={overview.cards.pricing_coverage.missing_active_price > 0 ? "warning" : "success"}
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

          <section className="grid gap-4 lg:grid-cols-2">
            <StatBreakdown
              title={t("ordersDistributionTitle")}
              items={[
                { label: common("statusDraft"), value: overview.distributions.orders_by_status.draft, tone: "neutral" },
                { label: common("statusPending"), value: overview.distributions.orders_by_status.pending, tone: "warning" },
                { label: common("statusPaid"), value: overview.distributions.orders_by_status.paid, tone: "success" },
                {
                  label: common("statusCancelled"),
                  value:
                    overview.distributions.orders_by_status.cancelled +
                    overview.distributions.orders_by_status.refunded,
                  tone: "danger",
                },
              ]}
            />
            <StatBreakdown
              title={t("invoicesDistributionTitle")}
              items={[
                { label: common("statusDraft"), value: overview.distributions.invoices_by_status.draft, tone: "neutral" },
                { label: common("statusIssued"), value: overview.distributions.invoices_by_status.issued, tone: "warning" },
                { label: common("statusPaid"), value: overview.distributions.invoices_by_status.paid, tone: "success" },
                { label: common("statusVoid"), value: overview.distributions.invoices_by_status.void, tone: "danger" },
              ]}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-section text-foreground">{t("recentActivityTitle")}</h2>
            {overview.recent_activity.length === 0 ? (
              <p className="text-sm text-muted">{t("recentActivityEmpty")}</p>
            ) : (
              <EntityTable
                columns={[
                  {
                    key: "created_at",
                    header: t("createdAtLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      formatDisplayDateTime(row.created_at),
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
