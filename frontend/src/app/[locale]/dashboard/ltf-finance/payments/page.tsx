"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { useClubSelection } from "@/components/club-selection-provider";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  LIST_PAGE_SIZE_CAP,
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  PageNotice,
  PageSizeSelect,
  resolveListPageSize,
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDisplayDateTime } from "@/lib/date-display";
import { Payment, getFinancePaymentsPage } from "@/lib/ltf-finance-api";

const AUTO_REFRESH_INTERVAL_MS = 30000;

type PaymentStatusFilter = "all" | "pending" | "paid" | "failed" | "cancelled";

export default function LtfFinancePaymentsPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const failedPaymentIssue = searchParams.get("issue") === "failed_or_cancelled_30d";
  const [payments, setPayments] = useState<Payment[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [statusFilter, setStatusFilter] = useState<PaymentStatusFilter>("all");
  const [totalPaymentCount, setTotalPaymentCount] = useState(0);
  const [paymentFacetCounts, setPaymentFacetCounts] = useState({
    all: 0,
    pending: 0,
    paid: 0,
    failed: 0,
    cancelled: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isRefreshingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const { selectedClubId } = useClubSelection();

  const loadPayments = useCallback(
    async (options?: { silent?: boolean; includeStatic?: boolean }) => {
      const silent = options?.silent ?? false;
      const includeStatic = options?.includeStatic ?? true;
      if (isRefreshingRef.current) {
        return;
      }
      const controller = new AbortController();
      isRefreshingRef.current = true;
      requestAbortRef.current = controller;
      if (!silent) {
        setIsLoading(true);
        setErrorMessage(null);
      }
      try {
        const facetParams = {
          q: searchQuery || undefined,
          clubId: selectedClubId ?? undefined,
        };
        const paymentsPromise = getFinancePaymentsPage(
          {
            page: currentPage,
            pageSize: resolveListPageSize(pageSize, LIST_PAGE_SIZE_CAP),
            q: searchQuery || undefined,
            status: failedPaymentIssue ? undefined : statusFilter === "all" ? undefined : statusFilter,
            clubId: selectedClubId ?? undefined,
            issue: failedPaymentIssue ? "failed_or_cancelled_30d" : undefined,
          },
          { signal: controller.signal }
        );
        if (includeStatic) {
          const [
            paymentsResponse,
            allCountRes,
            pendingCountRes,
            paidCountRes,
            failedCountRes,
            cancelledCountRes,
          ] = await Promise.all([
            paymentsPromise,
            getFinancePaymentsPage({ page: 1, pageSize: 1, ...facetParams }, { signal: controller.signal }),
            getFinancePaymentsPage(
              { page: 1, pageSize: 1, ...facetParams, status: "pending" },
              { signal: controller.signal }
            ),
            getFinancePaymentsPage(
              { page: 1, pageSize: 1, ...facetParams, status: "paid" },
              { signal: controller.signal }
            ),
            getFinancePaymentsPage(
              { page: 1, pageSize: 1, ...facetParams, status: "failed" },
              { signal: controller.signal }
            ),
            getFinancePaymentsPage(
              { page: 1, pageSize: 1, ...facetParams, status: "cancelled" },
              { signal: controller.signal }
            ),
          ]);
          setPayments(paymentsResponse.results);
          setTotalPaymentCount(paymentsResponse.count);
          setPaymentFacetCounts({
            all: allCountRes.count,
            pending: pendingCountRes.count,
            paid: paidCountRes.count,
            failed: failedCountRes.count,
            cancelled: cancelledCountRes.count,
          });
        } else {
          const paymentsResponse = await paymentsPromise;
          setPayments(paymentsResponse.results);
          setTotalPaymentCount(paymentsResponse.count);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : t("paymentsLoadError"));
        }
      } finally {
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
        }
        isRefreshingRef.current = false;
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [currentPage, failedPaymentIssue, pageSize, searchQuery, selectedClubId, statusFilter, t]
  );

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClubId, searchQuery, pageSize, statusFilter, failedPaymentIssue]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

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
        void loadPayments({ silent: true, includeStatic: false });
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
  }, [loadPayments]);

  const resolvedPageSize = resolveListPageSize(pageSize, totalPaymentCount);
  const totalPages = Math.max(1, Math.ceil(totalPaymentCount / resolvedPageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const getPaymentStatusMeta = useCallback(
    (status: string) => {
      switch (status) {
        case "pending":
          return { label: common("statusPending"), tone: "warning" as const };
        case "paid":
          return { label: common("statusPaid"), tone: "success" as const };
        case "failed":
          return { label: common("statusFailed"), tone: "danger" as const };
        case "cancelled":
          return { label: common("statusCancelled"), tone: "neutral" as const };
        default:
          return { label: status, tone: "neutral" as const };
      }
    },
    [common, t]
  );

  const getMethodLabel = useCallback(
    (method: string) => {
      switch (method) {
        case "card":
          return t("paymentMethodCard");
        case "bank_transfer":
          return t("paymentMethodBankTransfer");
        case "cash":
          return t("paymentMethodCash");
        case "offline":
          return t("paymentMethodOffline");
        default:
          return t("paymentMethodOther");
      }
    },
    [t]
  );

  const columns = useMemo(
    () => [
      {
        key: "paid_at",
        header: t("paidAtLabel"),
        render: (row: Payment) => formatDisplayDateTime(row.paid_at || row.created_at),
      },
      {
        key: "invoice_number",
        header: t("invoiceNumberLabel"),
        render: (row: Payment) => row.invoice_number || String(row.invoice),
      },
      {
        key: "club",
        header: t("clubLabel"),
        render: (row: Payment) => row.club_name || (row.club ? String(row.club) : "-"),
      },
      {
        key: "amount",
        header: t("paymentAmountLabel"),
        render: (row: Payment) => `${row.amount} ${row.currency}`,
      },
      {
        key: "method",
        header: t("paymentMethodLabel"),
        render: (row: Payment) => getMethodLabel(row.method),
      },
      {
        key: "reference",
        header: t("paymentReferenceLabel"),
        render: (row: Payment) => row.reference || "-",
      },
      {
        key: "status",
        header: t("statusLabel"),
        render: (row: Payment) => {
          const meta = getPaymentStatusMeta(row.status);
          return <StatusBadge label={meta.label} tone={meta.tone} />;
        },
      },
    ],
    [getMethodLabel, getPaymentStatusMeta, t]
  );

  return (
    <LtfFinanceLayout title={t("paymentsTitle")} subtitle={t("paymentsSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}
      {failedPaymentIssue ? (
        <PageNotice tone="info">{t("failedOrCancelledPaymentsFilterMessage")}</PageNotice>
      ) : null}

      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          search={
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchPaymentsPlaceholder")}
              aria-label={t("searchPaymentsPlaceholder")}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          }
          pageSize={
            <PageSizeSelect
              value={pageSize}
              onChange={setPageSize}
              ariaLabel={common("rowsPerPageLabel")}
              allLabel={common("rowsPerPageAll")}
            />
          }
          filters={
            <FilterPills
              ariaLabel={t("paymentsStatusFilterAriaLabel")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", title: t("filterAllTitle"), count: paymentFacetCounts.all },
                {
                  value: "pending",
                  title: common("statusPending"),
                  count: paymentFacetCounts.pending,
                },
                { value: "paid", title: common("statusPaid"), count: paymentFacetCounts.paid },
                {
                  value: "failed",
                  title: common("statusFailed"),
                  count: paymentFacetCounts.failed,
                },
                {
                  value: "cancelled",
                  title: common("statusCancelled"),
                  count: paymentFacetCounts.cancelled,
                },
              ]}
            />
          }
        />
        <ListActionsRow
          actions={
            <Button
              variant="outline"
              onClick={() => router.push(`/${locale}/dashboard/ltf-finance/invoices`)}
            >
              {t("recordPaymentFromInvoiceAction")}
            </Button>
          }
          pagination={
            <ListPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPrevious={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              pageLabel={t("pageLabel", { current: currentPage, total: totalPages })}
              previousLabel={t("previousPage")}
              nextLabel={t("nextPage")}
            />
          }
        />
      </div>

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : payments.length === 0 ? (
        <EmptyState title={t("noPaymentsTitle")} description={t("noPaymentsSubtitle")} />
      ) : (
        <EntityTable
          columns={columns}
          rows={payments}
          onRowClick={(payment) =>
            router.push(`/${locale}/dashboard/ltf-finance/payments/${payment.invoice}`)
          }
        />
      )}
    </LtfFinanceLayout>
  );
}
