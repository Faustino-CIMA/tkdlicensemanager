"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, BadgeEuro, HandCoins, Receipt, ShoppingCart } from "lucide-react";

import { ActionQueue } from "@/components/club-admin/action-queue";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { StatBreakdown } from "@/components/club-admin/stat-breakdown";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/list-page-chrome";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  LtfFinanceOverviewResponse,
  getLtfFinanceOverview,
} from "@/lib/ltf-finance-api";

const AUTO_REFRESH_INTERVAL_MS = 30000;



function humanizeAuditAction(action: string) {
  return action
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function LtfFinanceDashboardPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
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

  const recentActivityActionLabel = (
    action: LtfFinanceOverviewResponse["recent_activity"][number]["action"]
  ) => {
    switch (action) {
      case "order.created":
        return t("auditActionOrderCreated");
      case "invoice.created":
        return t("auditActionInvoiceCreated");
      case "licenses.created":
        return t("auditActionLicensesCreated");
      case "licenses.activated":
        return t("auditActionLicensesActivated");
      case "order.paid":
        return t("auditActionOrderPaid");
      case "order.payment_blocked":
        return t("auditActionOrderPaymentBlocked");
      case "payconiq.created":
        return t("auditActionPayconiqCreated");
      case "expense.created":
        return t("auditActionExpenseCreated");
      case "expense.updated":
        return t("auditActionExpenseUpdated");
      case "expense.paid":
        return t("auditActionExpensePaid");
      case "expense.voided":
        return t("auditActionExpenseVoided");
      case "income.created":
        return t("auditActionIncomeCreated");
      case "income.updated":
        return t("auditActionIncomeUpdated");
      case "income.voided":
        return t("auditActionIncomeVoided");
      case "finance_opening.updated":
        return t("auditActionFinanceOpeningUpdated");
      default:
        return humanizeAuditAction(action);
    }
  };

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
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : !overview ? (
        <EmptyState title={t("overviewEmptyTitle")} description={t("overviewEmptySubtitle")} />
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
            <p className="text-meta">
              {lastRefreshAt
                ? t("lastRefreshLabel", { time: formatDisplayDateTime(lastRefreshAt) })
                : t("lastRefreshNever")}
            </p>
            <Button
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
              title={t("otherIncomeThisYearLabel")}
              value={`${overview.cards.other_income_this_year} ${overview.currency}`}
              icon={HandCoins}
              tone="accent"
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

          <section className="space-y-4">
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
                  {
                    key: "action",
                    header: t("actionLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      recentActivityActionLabel(row.action),
                  },
                  {
                    key: "club_name",
                    header: t("clubLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      row.club_name || "-",
                  },
                  {
                    key: "order_number",
                    header: t("orderLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      row.order_number || "-",
                  },
                  {
                    key: "invoice_number",
                    header: t("invoiceNumberLabel"),
                    render: (row: LtfFinanceOverviewResponse["recent_activity"][number]) =>
                      row.invoice_number || "-",
                  },
                ]}
                rows={overview.recent_activity}
                onRowClick={(row) => {
                  if (row.invoice_id) {
                    router.push(`/${locale}/dashboard/ltf-finance/invoices/${row.invoice_id}`);
                    return;
                  }
                  if (row.order_id) {
                    router.push(`/${locale}/dashboard/ltf-finance/orders/${row.order_id}`);
                  }
                }}
              />
            )}
          </section>
        </>
      )}
    </LtfFinanceLayout>
  );
}
