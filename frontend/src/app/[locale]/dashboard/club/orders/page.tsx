"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { useClubSelection } from "@/components/club-selection-provider";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDisplayDateTime } from "@/lib/date-display";
import { FinanceOrder, getClubOrdersPage } from "@/lib/club-finance-api";

export default function ClubAdminOrdersPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const { selectedClubId } = useClubSelection();
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["10", "25", "50", "100", "150", "200"];

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const ordersResponse = await getClubOrdersPage({
        page: currentPage,
        pageSize: Number(pageSize),
        clubId: selectedClubId ?? undefined,
        q: searchQuery || undefined,
      });
      setOrders(ordersResponse.results);
      setTotalCount(ordersResponse.count);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("ordersLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, searchQuery, selectedClubId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const getOrderStatusMeta = (status: string) => {
    switch (status) {
      case "draft":
      case "pending":
        return { label: t("orderStatusPlaced"), tone: "info" as const };
      case "cancelled":
      case "refunded":
        return { label: t("orderStatusCancelled"), tone: "danger" as const };
      case "paid":
        return { label: t("orderStatusDelivered"), tone: "success" as const };
      default:
        return { label: status, tone: "neutral" as const };
    }
  };

  const getOrderQuantity = (order: FinanceOrder) => {
    if (typeof order.item_quantity === "number") {
      return order.item_quantity;
    }
    return order.items?.reduce((total, item) => total + (item.quantity ?? 0), 0) ?? 0;
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / Number(pageSize)));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize, selectedClubId]);

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
    { key: "quantity", header: t("qtyLabel"), render: (row: FinanceOrder) => getOrderQuantity(row) },
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
  ];

  return (
    <ClubAdminLayout title={t("ordersTitle")} subtitle={t("ordersSubtitle")}>
      <section className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-full max-w-sm"
          placeholder={t("searchOrdersPlaceholder")}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
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
      ) : orders.length === 0 ? (
        <EmptyState title={t("noOrdersTitle")} description={t("noOrdersSubtitle")} />
      ) : (
        <>
          <EntityTable
            columns={columns}
            rows={orders}
            onRowClick={(row) => {
              router.push(`/${locale}/dashboard/club/orders/${row.id}`);
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

    </ClubAdminLayout>
  );
}
