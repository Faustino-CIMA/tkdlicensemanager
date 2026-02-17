"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Member, getMembers } from "@/lib/club-admin-api";
import { formatDisplayDateTime } from "@/lib/date-display";
import { FinanceOrder, getClubOrders } from "@/lib/club-finance-api";

export default function ClubAdminOrdersPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const { selectedClubId } = useClubSelection();
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["10", "25", "50", "100", "150", "200", "all"];

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [ordersResponse, membersResponse] = await Promise.all([
        getClubOrders(selectedClubId),
        getMembers(),
      ]);
      setOrders(ordersResponse);
      setMembers(membersResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("ordersLoadError"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedClubId]);

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

  const getOrderQuantity = (order: FinanceOrder) =>
    order.items.reduce((total, item) => total + (item.quantity ?? 0), 0);

  const searchedOrders = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return orders;
    }
    return orders.filter((order) => {
      const orderNumber = order.order_number.toLowerCase();
      const statusText = order.status.toLowerCase();
      const itemMembers = order.items
        .map((item) => members.find((member) => member.id === item.license.member))
        .filter(Boolean)
        .map((member) => `${member!.first_name} ${member!.last_name}`.toLowerCase());
      const quantityText = String(getOrderQuantity(order));
      const totalText = `${order.total} ${order.currency}`.toLowerCase();
      return (
        orderNumber.includes(normalizedQuery) ||
        statusText.includes(normalizedQuery) ||
        itemMembers.some((name) => name.includes(normalizedQuery)) ||
        quantityText.includes(normalizedQuery) ||
        totalText.includes(normalizedQuery)
      );
    });
  }, [orders, members, searchQuery]);

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
              const meta = getOrderStatusMeta(row.status);
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
