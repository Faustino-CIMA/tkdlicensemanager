"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Club,
  FinanceOrder,
  LicensePrice,
  createLicensePrice,
  getFinanceClubs,
  getFinanceOrders,
  getLicensePrices,
} from "@/lib/ltf-finance-api";

export default function LtfFinanceOrdersPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [priceMessage, setPriceMessage] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [prices, setPrices] = useState<LicensePrice[]>([]);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [priceAmount, setPriceAmount] = useState("");
  const [priceEffectiveFrom, setPriceEffectiveFrom] = useState("");
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];

  const loadOrders = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [ordersResponse, pricesResponse, clubsResponse] = await Promise.all([
        getFinanceOrders(),
        getLicensePrices(),
        getFinanceClubs(),
      ]);
      setOrders(ordersResponse);
      setPrices(pricesResponse);
      setClubs(clubsResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("ordersLoadError"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const clubNameById = useMemo(() => {
    return clubs.reduce<Record<number, string>>((acc, club) => {
      acc[club.id] = club.name;
      return acc;
    }, {});
  }, [clubs]);

  const getOrderQuantity = (order: FinanceOrder) => {
    return order.items.reduce((sum, item) => sum + item.quantity, 0);
  };

  const getOrderStatusMeta = (status: string) => {
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
  };

  const searchedOrders = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return orders;
    }
    return orders.filter((order) => {
      const orderNumber = order.order_number.toLowerCase();
      const statusText = getOrderStatusMeta(order.status).label.toLowerCase();
      const clubText = (clubNameById[order.club] ?? String(order.club)).toLowerCase();
      const quantityText = String(getOrderQuantity(order));
      const totalText = `${order.total} ${order.currency}`.toLowerCase();
      return (
        orderNumber.includes(normalizedQuery) ||
        statusText.includes(normalizedQuery) ||
        clubText.includes(normalizedQuery) ||
        quantityText.includes(normalizedQuery) ||
        totalText.includes(normalizedQuery)
      );
    });
  }, [orders, searchQuery, clubNameById]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedOrders.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedOrders.length / resolvedPageSize));
  const pagedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedOrders.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedOrders, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const currentPrice = useMemo(() => {
    if (prices.length === 0) {
      return null;
    }
    const sorted = [...prices].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return sorted[0];
  }, [prices]);

  const handleSavePrice = async () => {
    setPriceError(null);
    setPriceMessage(null);
    setIsSavingPrice(true);
    try {
      const effectiveFrom =
        priceEffectiveFrom || new Date().toISOString().slice(0, 10);
      await createLicensePrice({
        amount: priceAmount,
        currency: currentPrice?.currency ?? "EUR",
        effective_from: effectiveFrom,
      });
      setPriceAmount("");
      setPriceEffectiveFrom("");
      setIsPriceModalOpen(false);
      setPriceMessage(t("priceSaved"));
      await loadOrders();
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : t("priceSaveError"));
    } finally {
      setIsSavingPrice(false);
    }
  };

  const orderCounts = useMemo(() => {
    return orders.reduce<Record<string, number>>((acc, order) => {
      const bucket = getOrderStatusMeta(order.status).bucket;
      acc[bucket] = (acc[bucket] || 0) + 1;
      return acc;
    }, {});
  }, [orders]);

  const columns = [
    { key: "order_number", header: t("orderNumberLabel") },
    {
      key: "status",
      header: t("statusLabel"),
      render: (row: FinanceOrder) => {
        const meta = getOrderStatusMeta(row.status);
        return <StatusBadge label={meta.label} tone={meta.tone} />;
      },
    },
    {
      key: "club",
      header: t("clubLabel"),
      render: (row: FinanceOrder) => clubNameById[row.club] ?? String(row.club),
    },
    {
      key: "quantity",
      header: common("qtyLabel"),
      render: (row: FinanceOrder) => getOrderQuantity(row),
    },
    {
      key: "total",
      header: t("totalLabel"),
      render: (row: FinanceOrder) => `${row.total} ${row.currency}`,
    },
    {
      key: "created_at",
      header: t("createdAtLabel"),
      render: (row: FinanceOrder) => new Date(row.created_at).toLocaleString(),
    },
  ];

  return (
    <LtfFinanceLayout title={t("ordersTitle")} subtitle={t("ordersSubtitle")}>
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <SummaryCard
          title={t("ordersReceivedCountLabel")}
          value={String(orderCounts.received ?? 0)}
        />
        <SummaryCard
          title={t("ordersDeliveredCountLabel")}
          value={String(orderCounts.delivered ?? 0)}
        />
        <SummaryCard
          title={t("ordersCancelledCountLabel")}
          value={String(orderCounts.cancelled ?? 0)}
        />
        <SummaryCard
          title={t("licensePriceLabel")}
          value={
            currentPrice ? `${currentPrice.amount} ${currentPrice.currency}` : t("noPriceLabel")
          }
          helper={
            currentPrice
              ? t("priceEffectiveFrom", { date: currentPrice.effective_from })
              : undefined
          }
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">{t("priceHistoryTitle")}</h2>
          <Button variant="outline" onClick={() => setIsPriceModalOpen(true)}>
            {t("updatePriceButton")}
          </Button>
        </div>
        {prices.length === 0 ? (
          <EmptyState title={t("priceHistoryEmptyTitle")} description={t("priceHistoryEmptySubtitle")} />
        ) : (
          <EntityTable
            columns={[
              {
                key: "effective_from",
                header: t("priceEffectiveFromLabel"),
                render: (row: LicensePrice) => new Date(row.effective_from).toLocaleDateString(),
              },
              { key: "amount", header: t("priceAmountLabel") },
              { key: "currency", header: t("priceCurrencyLabel") },
              {
                key: "created_by",
                header: t("priceCreatedByLabel"),
                render: (row: LicensePrice) => row.created_by ?? "-",
              },
              {
                key: "created_at",
                header: t("priceCreatedAtLabel"),
                render: (row: LicensePrice) => new Date(row.created_at).toLocaleDateString(),
              },
            ]}
            rows={prices}
          />
        )}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-full max-w-sm"
          placeholder={t("searchOrdersPlaceholder")}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-600">{common("rowsPerPageLabel")}</span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? common("rowsPerPageAll") : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : searchedOrders.length === 0 ? (
        <EmptyState title={t("noOrdersTitle")} description={t("noOrdersSubtitle")} />
      ) : (
        <>
          <EntityTable
            columns={columns}
            rows={pagedOrders}
            onRowClick={(row) => {
              router.push(`/${locale}/dashboard/ltf-finance/orders/${row.id}`);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600">
            <span>{t("pageLabel", { current: currentPage, total: totalPages })}</span>
            <div className="flex gap-2">
              <button
                className="rounded-full border border-zinc-200 px-3 py-1"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                {t("previousPage")}
              </button>
              <button
                className="rounded-full border border-zinc-200 px-3 py-1"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                {t("nextPage")}
              </button>
            </div>
          </div>
        </>
      )}

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {priceError ? <p className="text-sm text-red-600">{priceError}</p> : null}
      {priceMessage ? <p className="text-sm text-emerald-600">{priceMessage}</p> : null}

      <Modal
        title={t("priceModalTitle")}
        description={t("priceModalSubtitle")}
        isOpen={isPriceModalOpen}
        onClose={() => setIsPriceModalOpen(false)}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("priceAmountLabel")}</label>
            <Input
              type="number"
              step="0.01"
              value={priceAmount}
              onChange={(event) => setPriceAmount(event.target.value)}
              placeholder="30.00"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("priceEffectiveFromLabel")}
            </label>
            <Input
              type="date"
              value={priceEffectiveFrom}
              onChange={(event) => setPriceEffectiveFrom(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSavePrice} disabled={isSavingPrice || !priceAmount}>
              {isSavingPrice ? t("priceSaving") : t("priceSaveButton")}
            </Button>
            <Button variant="outline" onClick={() => setIsPriceModalOpen(false)}>
              {t("priceCancelButton")}
            </Button>
          </div>
        </div>
      </Modal>
    </LtfFinanceLayout>
  );
}
