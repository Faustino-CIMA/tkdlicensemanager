"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { useClubSelection } from "@/components/club-selection-provider";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  ExpandableTable,
  FormPanel,
  LIST_PAGE_SIZE_CAP,
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  NestedTable,
  PageNotice,
  PageSizeSelect,
  dataRowClickableClass,
  dataTableClass,
  dataTdClass,
  dataThClass,
  dataTheadClass,
  resolveListPageSize,
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Club,
  FinanceLicenseType,
  FinanceOrder,
  LicensePrice,
  getFinanceClubs,
  getFinanceLicenseTypes,
  getFinanceOrdersPage,
  getLicensePrices,
} from "@/lib/ltf-finance-api";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-display";

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

function getGroupYear(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getFullYear();
}

function getYearKey(clubId: number, year: number) {
  return `${clubId}:${year}`;
}

export default function LtfFinanceOrdersPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [licenseTypes, setLicenseTypes] = useState<FinanceLicenseType[]>([]);
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
  const [prices, setPrices] = useState<LicensePrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedClubIds, setExpandedClubIds] = useState<number[]>([]);
  const [expandedYearKeys, setExpandedYearKeys] = useState<string[]>([]);
  const [expandedStateHydrated, setExpandedStateHydrated] = useState(false);
  const isRefreshingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);

  const expandedClubStorageKey = "ltf_finance_orders_expanded_clubs";
  const expandedYearStorageKey = "ltf_finance_orders_expanded_years";
  const { selectedClubId } = useClubSelection();

  const loadOrders = useCallback(async (options?: { silent?: boolean; includeStatic?: boolean }) => {
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
          status: orderStatusQuery(statusFilter),
          clubId: selectedClubId ?? undefined,
        },
        { signal: controller.signal }
      );
      if (includeStatic) {
        const [
          ordersResponse,
          pricesResponse,
          clubsResponse,
          licenseTypesResponse,
          allCountRes,
          receivedCountRes,
          deliveredCountRes,
          cancelledCountRes,
        ] = await Promise.all([
          ordersPromise,
          getLicensePrices(undefined, { signal: controller.signal }),
          getFinanceClubs({ signal: controller.signal }),
          getFinanceLicenseTypes({ signal: controller.signal }),
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
        setPrices(pricesResponse);
        setClubs(clubsResponse);
        setLicenseTypes(licenseTypesResponse);
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
  }, [currentPage, pageSize, searchQuery, selectedClubId, statusFilter, t]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClubId]);

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

  const clubNameById = useMemo(() => {
    return clubs.reduce<Record<number, string>>((acc, club) => {
      acc[club.id] = club.name;
      return acc;
    }, {});
  }, [clubs]);

  const getOrderQuantity = (order: FinanceOrder) => {
    if (typeof order.item_quantity === "number") {
      return order.item_quantity;
    }
    return order.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  };

  const getOrderStatusMeta = useCallback((status: string) => {
    switch (status) {
      case "draft":
      case "pending":
        return { label: t("orderStatusReceived"), tone: "info" as const, bucket: "received" };
      case "paid":
        return { label: t("orderStatusDelivered"), tone: "success" as const, bucket: "delivered" };
      case "cancelled":
      case "refunded":
        return { label: t("orderStatusCancelled"), tone: "danger" as const, bucket: "cancelled" };
      default:
        return { label: t("orderStatusReceived"), tone: "neutral" as const, bucket: "received" };
    }
  }, [t]);

  const searchedOrders = useMemo(() => {
    return orders;
  }, [orders]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize, statusFilter]);

  const latestPriceByLicenseType = useMemo(() => {
    const sorted = [...prices].sort((left, right) => {
      const byEffective = right.effective_from.localeCompare(left.effective_from);
      if (byEffective !== 0) {
        return byEffective;
      }
      return right.created_at.localeCompare(left.created_at);
    });
    return sorted.reduce<Record<number, LicensePrice>>((accumulator, price) => {
      if (!accumulator[price.license_type]) {
        accumulator[price.license_type] = price;
      }
      return accumulator;
    }, {});
  }, [prices]);

  const priceCardRows = useMemo(() => {
    return [...licenseTypes]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((licenseType) => {
        const latestPrice = latestPriceByLicenseType[licenseType.id];
        return {
          id: licenseType.id,
          name: licenseType.name,
          price: latestPrice ? `${latestPrice.amount} ${latestPrice.currency}` : t("noPriceLabel"),
          effectiveFrom: latestPrice
            ? t("priceEffectiveFrom", { date: formatDisplayDate(latestPrice.effective_from) })
            : null,
        };
      });
  }, [licenseTypes, latestPriceByLicenseType, t]);

  const groupedClubRows = useMemo(() => {
    const grouped = new Map<
      number,
      {
        clubName: string;
        yearsMap: Map<number, FinanceOrder[]>;
      }
    >();

    for (const order of searchedOrders) {
      const year = getGroupYear(order.created_at);
      const clubName = clubNameById[order.club] ?? String(order.club);
      const clubEntry = grouped.get(order.club);
      if (!clubEntry) {
        grouped.set(order.club, {
          clubName,
          yearsMap: new Map([[year, [order]]]),
        });
        continue;
      }
      const yearEntry = clubEntry.yearsMap.get(year);
      if (yearEntry) {
        yearEntry.push(order);
      } else {
        clubEntry.yearsMap.set(year, [order]);
      }
    }

    return Array.from(grouped.entries())
      .map(([clubId, clubEntry]) => {
        const years = Array.from(clubEntry.yearsMap.entries())
          .map(([year, yearOrders]) => {
            const ordersForYear = [...yearOrders].sort((left, right) =>
              right.created_at.localeCompare(left.created_at)
            );
            const counts = ordersForYear.reduce(
              (acc, order) => {
                const bucket = getOrderStatusMeta(order.status).bucket;
                if (bucket === "received") {
                  acc.receivedCount += 1;
                } else if (bucket === "delivered") {
                  acc.deliveredCount += 1;
                } else {
                  acc.cancelledCount += 1;
                }
                return acc;
              },
              { receivedCount: 0, deliveredCount: 0, cancelledCount: 0 }
            );
            return {
              year,
              orders: ordersForYear,
              total: ordersForYear.length,
              ...counts,
            };
          })
          .sort((left, right) => right.year - left.year);

        const total = years.reduce((sum, year) => sum + year.total, 0);
        const receivedCount = years.reduce((sum, year) => sum + year.receivedCount, 0);
        const deliveredCount = years.reduce((sum, year) => sum + year.deliveredCount, 0);
        const cancelledCount = years.reduce((sum, year) => sum + year.cancelledCount, 0);

        return {
          clubId,
          clubName: clubEntry.clubName,
          years,
          total,
          receivedCount,
          deliveredCount,
          cancelledCount,
        };
      })
      .sort((left, right) => left.clubName.localeCompare(right.clubName));
  }, [clubNameById, searchedOrders, getOrderStatusMeta]);

  const resolvedPageSize = resolveListPageSize(pageSize, totalOrderCount);
  const totalPages = Math.max(1, Math.ceil(totalOrderCount / resolvedPageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    const validClubIds = new Set(groupedClubRows.map((clubGroup) => clubGroup.clubId));
    setExpandedClubIds((previous) => previous.filter((clubId) => validClubIds.has(clubId)));
    const validYearKeys = new Set(
      groupedClubRows.flatMap((clubGroup) =>
        clubGroup.years.map((yearGroup) => getYearKey(clubGroup.clubId, yearGroup.year))
      )
    );
    setExpandedYearKeys((previous) => previous.filter((yearKey) => validYearKeys.has(yearKey)));
  }, [groupedClubRows]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setExpandedStateHydrated(true);
      return;
    }
    try {
      const storedClubIds = window.localStorage.getItem(expandedClubStorageKey);
      const storedYearKeys = window.localStorage.getItem(expandedYearStorageKey);
      if (storedClubIds) {
        const parsed = JSON.parse(storedClubIds);
        if (Array.isArray(parsed)) {
          setExpandedClubIds(
            parsed
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value > 0)
          );
        }
      }
      if (storedYearKeys) {
        const parsed = JSON.parse(storedYearKeys);
        if (Array.isArray(parsed)) {
          setExpandedYearKeys(parsed.filter((value) => typeof value === "string"));
        }
      }
    } catch {
      setExpandedClubIds([]);
      setExpandedYearKeys([]);
    } finally {
      setExpandedStateHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!expandedStateHydrated || typeof window === "undefined") {
      return;
    }
    if (expandedClubIds.length > 0) {
      window.localStorage.setItem(expandedClubStorageKey, JSON.stringify(expandedClubIds));
    } else {
      window.localStorage.removeItem(expandedClubStorageKey);
    }
    if (expandedYearKeys.length > 0) {
      window.localStorage.setItem(expandedYearStorageKey, JSON.stringify(expandedYearKeys));
    } else {
      window.localStorage.removeItem(expandedYearStorageKey);
    }
  }, [
    expandedClubIds,
    expandedYearKeys,
    expandedStateHydrated,
    expandedClubStorageKey,
    expandedYearStorageKey,
  ]);

  const expandedClubSet = useMemo(() => new Set(expandedClubIds), [expandedClubIds]);
  const expandedYearSet = useMemo(() => new Set(expandedYearKeys), [expandedYearKeys]);

  const toggleClubExpanded = (clubId: number) => {
    setExpandedClubIds((previous) =>
      previous.includes(clubId)
        ? previous.filter((id) => id !== clubId)
        : [...previous, clubId]
    );
  };

  const toggleYearExpanded = (clubId: number, year: number) => {
    const key = getYearKey(clubId, year);
    setExpandedYearKeys((previous) =>
      previous.includes(key) ? previous.filter((id) => id !== key) : [...previous, key]
    );
  };

  return (
    <LtfFinanceLayout title={t("ordersTitle")} subtitle={t("ordersSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title={t("ordersReceivedCountLabel")}
          value={String(orderFacetCounts.received)}
        />
        <SummaryCard
          title={t("ordersDeliveredCountLabel")}
          value={String(orderFacetCounts.delivered)}
        />
        <SummaryCard
          title={t("ordersCancelledCountLabel")}
          value={String(orderFacetCounts.cancelled)}
        />
        <FormPanel className="p-5">
          <p className="text-sm text-muted">{t("licensePriceLabel")}</p>
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
            {priceCardRows.length === 0 ? (
              <p className="text-sm text-muted">{t("noLicenseTypesSubtitle")}</p>
            ) : (
              priceCardRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-3 rounded-[var(--radius-form)] border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                    {row.effectiveFrom ? (
                      <p className="text-xs text-muted">{row.effectiveFrom}</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-foreground">{row.price}</p>
                </div>
              ))
            )}
          </div>
        </FormPanel>
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
      ) : groupedClubRows.length === 0 ? (
        <EmptyState title={t("noOrdersTitle")} description={t("noOrdersSubtitle")} />
      ) : (
        <ExpandableTable>
            <table className={dataTableClass}>
              <thead className={dataTheadClass}>
                <tr>
                  <th className={`w-10 ${dataThClass}`} />
                  <th className={dataThClass}>{t("clubLabel")}</th>
                  <th className={dataThClass}>{t("totalLabel")}</th>
                  <th className={dataThClass}>{t("ordersReceivedCountLabel")}</th>
                  <th className={dataThClass}>{t("ordersDeliveredCountLabel")}</th>
                  <th className={dataThClass}>{t("ordersCancelledCountLabel")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {groupedClubRows.map((clubGroup) => {
                  const clubExpanded = expandedClubSet.has(clubGroup.clubId);
                  return (
                    <Fragment key={clubGroup.clubId}>
                      <tr
                        className={dataRowClickableClass}
                        onClick={() => toggleClubExpanded(clubGroup.clubId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleClubExpanded(clubGroup.clubId);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={clubExpanded}
                      >
                        <td className={`${dataTdClass} text-muted`}>
                          {clubExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className={`${dataTdClass} font-medium`}>{clubGroup.clubName}</td>
                        <td className={dataTdClass}>{clubGroup.total}</td>
                        <td className={dataTdClass}>{clubGroup.receivedCount}</td>
                        <td className={dataTdClass}>{clubGroup.deliveredCount}</td>
                        <td className={dataTdClass}>{clubGroup.cancelledCount}</td>
                      </tr>
                      {clubExpanded ? (
                        <tr className="bg-secondary/60">
                          <td colSpan={6} className="px-6 py-3">
                            <NestedTable>
                              <table className={dataTableClass}>
                                <thead className={dataTheadClass}>
                                  <tr>
                                    <th className="w-10 px-4 py-2 font-medium" />
                                    <th className="px-4 py-2 font-medium">{t("yearLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("totalLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("ordersReceivedCountLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("ordersDeliveredCountLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("ordersCancelledCountLabel")}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/80">
                                  {clubGroup.years.map((yearGroup) => {
                                    const yearKey = getYearKey(clubGroup.clubId, yearGroup.year);
                                    const yearExpanded = expandedYearSet.has(yearKey);
                                    return (
                                      <Fragment key={yearKey}>
                                        <tr
                                          className={dataRowClickableClass}
                                          onClick={() => toggleYearExpanded(clubGroup.clubId, yearGroup.year)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              toggleYearExpanded(clubGroup.clubId, yearGroup.year);
                                            }
                                          }}
                                          tabIndex={0}
                                          role="button"
                                          aria-expanded={yearExpanded}
                                        >
                                          <td className="px-4 py-2 text-muted">
                                            {yearExpanded ? (
                                              <ChevronDown className="h-4 w-4" />
                                            ) : (
                                              <ChevronRight className="h-4 w-4" />
                                            )}
                                          </td>
                                          <td className="px-4 py-2 font-medium">
                                            {yearGroup.year > 0 ? yearGroup.year : "—"}
                                          </td>
                                          <td className="px-4 py-2">{yearGroup.total}</td>
                                          <td className="px-4 py-2">{yearGroup.receivedCount}</td>
                                          <td className="px-4 py-2">{yearGroup.deliveredCount}</td>
                                          <td className="px-4 py-2">{yearGroup.cancelledCount}</td>
                                        </tr>
                                        {yearExpanded ? (
                                          <tr className="bg-secondary/50">
                                            <td colSpan={6} className="px-6 py-3">
                                              <NestedTable>
                                                <table className={dataTableClass}>
                                                  <thead className={dataTheadClass}>
                                                    <tr>
                                                      <th className="px-4 py-2 font-medium">{t("orderNumberLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("statusLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{common("qtyLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("totalLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("createdAtLabel")}</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-border/80">
                                                    {yearGroup.orders.map((order) => {
                                                      const meta = getOrderStatusMeta(order.status);
                                                      return (
                                                        <tr
                                                          key={order.id}
                                                          className={dataRowClickableClass}
                                                          onClick={() => {
                                                            router.push(
                                                              `/${locale}/dashboard/ltf-finance/orders/${order.id}`
                                                            );
                                                          }}
                                                        >
                                                          <td className="px-4 py-2 font-medium">
                                                            {order.order_number}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            <StatusBadge label={meta.label} tone={meta.tone} />
                                                          </td>
                                                          <td className="px-4 py-2">{getOrderQuantity(order)}</td>
                                                          <td className="px-4 py-2">
                                                            {`${order.total} ${order.currency}`}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {formatDisplayDateTime(order.created_at)}
                                                          </td>
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                              </NestedTable>
                                            </td>
                                          </tr>
                                        ) : null}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </NestedTable>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
        </ExpandableTable>
      )}
    </LtfFinanceLayout>
  );
}
