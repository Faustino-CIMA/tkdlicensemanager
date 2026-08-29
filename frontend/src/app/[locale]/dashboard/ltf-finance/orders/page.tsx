"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { useClubSelection } from "@/components/club-selection-provider";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
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
import { FinanceOrder, getFinanceOrdersPage } from "@/lib/ltf-finance-api";

const AUTO_REFRESH_INTERVAL_MS = 30000;

type OrderStatusFilter = "all" | "received" | "delivered" | "cancelled";

function orderStatusQuery(filter: OrderStatusFilter) {
  switch (filter) {
    case "received":
      return "draft,pending";
    case "delivered":
      return "paid";
    case "cancelled":
      return "cancelled,refunded";
    default:
      return undefined;
  }
}

export default function LtfFinanceOrdersPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pendingLicenseIssue = searchParams.get("issue") === "paid_pending_licenses";
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("all");
  const [totalOrderCount, setTotalOrderCount] = useState(0);
  const [orderFacetCounts, setOrderFacetCounts] = useState({
    all: 0,
    received: 0,
    delivered: 0,
    cancelled: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isRefreshingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const { selectedClubId } = useClubSelection();

  const loadOrders = useCallback(
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
        const ordersPromise = getFinanceOrdersPage(
          {
            page: currentPage,
            pageSize: resolveListPageSize(pageSize, LIST_PAGE_SIZE_CAP),
            q: searchQuery || undefined,
            status: pendingLicenseIssue ? undefined : orderStatusQuery(statusFilter),
            clubId: selectedClubId ?? undefined,
            issue: pendingLicenseIssue ? "paid_pending_licenses" : undefined,
          },
          { signal: controller.signal }
        );
        if (includeStatic) {
          const [ordersResponse, allCountRes, receivedCountRes, deliveredCountRes, cancelledCountRes] =
            await Promise.all([
              ordersPromise,
              getFinanceOrdersPage({ page: 1, pageSize: 1, ...facetParams }, { signal: controller.signal }),
              getFinanceOrdersPage(
                { page: 1, pageSize: 1, ...facetParams, status: "draft,pending" },
                { signal: controller.signal }
              ),
              getFinanceOrdersPage(
                { page: 1, pageSize: 1, ...facetParams, status: "paid" },
                { signal: controller.signal }
              ),
              getFinanceOrdersPage(
                { page: 1, pageSize: 1, ...facetParams, status: "cancelled,refunded" },
                { signal: controller.signal }
              ),
            ]);
          setOrders(ordersResponse.results);
          setTotalOrderCount(ordersResponse.count);
          setOrderFacetCounts({
            all: allCountRes.count,
            received: receivedCountRes.count,
            delivered: deliveredCountRes.count,
            cancelled: cancelledCountRes.count,
          });
        } else {
          const ordersResponse = await ordersPromise;
          setOrders(ordersResponse.results);
          setTotalOrderCount(ordersResponse.count);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : t("ordersLoadError"));
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
    [currentPage, pageSize, pendingLicenseIssue, searchQuery, selectedClubId, statusFilter, t]
  );

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClubId, searchQuery, pageSize, statusFilter, pendingLicenseIssue]);

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
        void loadOrders({ silent: true, includeStatic: false });
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
  }, [loadOrders]);

  const getOrderStatusMeta = useCallback(
    (status: string) => {
      switch (status) {
        case "draft":
        case "pending":
          return { label: t("orderStatusReceived"), tone: "info" as const };
        case "paid":
          return { label: t("orderStatusDelivered"), tone: "success" as const };
        case "cancelled":
        case "refunded":
          return { label: t("orderStatusCancelled"), tone: "danger" as const };
        default:
          return { label: t("orderStatusReceived"), tone: "neutral" as const };
      }
    },
    [t]
  );

  const resolvedPageSize = resolveListPageSize(pageSize, totalOrderCount);
  const totalPages = Math.max(1, Math.ceil(totalOrderCount / resolvedPageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const columns = useMemo(
    () => [
      { key: "order_number", header: t("orderNumberLabel") },
      {
        key: "club",
        header: t("clubLabel"),
        render: (row: FinanceOrder) => row.club_name || String(row.club),
      },
      {
        key: "status",
        header: t("statusLabel"),
        render: (row: FinanceOrder) => {
          const meta = getOrderStatusMeta(row.status);
          return <StatusBadge label={meta.label} tone={meta.tone} />;
        },
      },
      {
        key: "quantity",
        header: common("qtyLabel"),
        render: (row: FinanceOrder) =>
          typeof row.item_quantity === "number"
            ? row.item_quantity
            : row.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
      },
      {
        key: "total",
        header: t("totalLabel"),
        render: (row: FinanceOrder) => `${row.total} ${row.currency}`,
      },
      {
        key: "created_at",
        header: t("createdAtLabel"),
        render: (row: FinanceOrder) => formatDisplayDateTime(row.created_at),
      },
    ],
    [common, getOrderStatusMeta, t]
  );

  return (
    <LtfFinanceLayout title={t("ordersTitle")} subtitle={t("ordersSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}
      {pendingLicenseIssue ? (
        <PageNotice tone="info">{t("paidOrdersPendingLicensesFilterMessage")}</PageNotice>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard title={t("ordersReceivedCountLabel")} value={String(orderFacetCounts.received)} />
        <SummaryCard
          title={t("ordersDeliveredCountLabel")}
          value={String(orderFacetCounts.delivered)}
        />
        <SummaryCard
          title={t("ordersCancelledCountLabel")}
          value={String(orderFacetCounts.cancelled)}
        />
      </section>

      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          search={
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchOrdersPlaceholder")}
              aria-label={t("searchOrdersPlaceholder")}
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
              ariaLabel={t("ordersStatusFilterAriaLabel")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", title: t("filterAllTitle"), count: orderFacetCounts.all },
                {
                  value: "received",
                  title: t("orderStatusReceived"),
                  count: orderFacetCounts.received,
                },
                {
                  value: "delivered",
                  title: t("orderStatusDelivered"),
                  count: orderFacetCounts.delivered,
                },
                {
                  value: "cancelled",
                  title: t("orderStatusCancelled"),
                  count: orderFacetCounts.cancelled,
                },
              ]}
            />
          }
        />
        <ListActionsRow
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
      ) : orders.length === 0 ? (
        <EmptyState title={t("noOrdersTitle")} description={t("noOrdersSubtitle")} />
      ) : (
        <EntityTable
          columns={columns}
          rows={orders}
          onRowClick={(order) => router.push(`/${locale}/dashboard/ltf-finance/orders/${order.id}`)}
        />
      )}
    </LtfFinanceLayout>
  );
}
