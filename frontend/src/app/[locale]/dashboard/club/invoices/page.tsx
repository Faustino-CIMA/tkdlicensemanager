"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { useClubSelection } from "@/components/club-selection-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FinanceInvoice, FinanceOrder, createClubCheckoutSession, getClubInvoices, getClubOrders } from "@/lib/club-finance-api";
import { openInvoicePdf } from "@/lib/invoice-pdf";

const AUTO_REFRESH_INTERVAL_MS = 10000;

export default function ClubAdminInvoicesPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const { selectedClubId } = useClubSelection();
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];

  const loadData = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setIsLoading(true);
        setErrorMessage(null);
      }
      try {
        const [invoiceResponse, ordersResponse] = await Promise.all([
          getClubInvoices(selectedClubId),
          getClubOrders(selectedClubId),
        ]);
        setInvoices(invoiceResponse);
        setOrders(ordersResponse);
      } catch (error) {
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : t("invoicesLoadError"));
        }
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [selectedClubId, t]
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") {
        void loadData({ silent: true });
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
  }, [loadData]);

  const handlePayNow = async (invoice: FinanceInvoice) => {
    if (!invoice.order) {
      setActionError(common("paymentMissingOrder"));
      return;
    }
    setActionError(null);
    setActiveOrderId(invoice.order);
    try {
      const response = await createClubCheckoutSession(invoice.order);
      if (response.url) {
        window.location.href = response.url;
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error.message : String(error);
      setActionError(normalizedError || common("paymentFailed"));
    } finally {
      setActiveOrderId(null);
    }
  };

  const handleInvoicePdf = async (invoiceId: number) => {
    setActionError(null);
    try {
      await openInvoicePdf(invoiceId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : common("pdfDownloadFailed"));
    }
  };

  const getInvoiceStatusMeta = (status: string) => {
    switch (status) {
      case "draft":
        return { label: common("statusDraft"), tone: "neutral" as const };
      case "issued":
        return { label: t("invoiceStatusDue"), tone: "warning" as const };
      case "paid":
        return { label: common("statusPaid"), tone: "success" as const };
      case "void":
        return { label: common("statusVoid"), tone: "danger" as const };
      default:
        return { label: status, tone: "neutral" as const };
    }
  };

  const orderQuantityById = useMemo(() => {
    const map = new Map<number, number>();
    orders.forEach((order) => {
      map.set(
        order.id,
        order.items.reduce((total, item) => total + (item.quantity ?? 0), 0)
      );
    });
    return map;
  }, [orders]);

  const getInvoiceQuantity = useCallback(
    (invoice: FinanceInvoice) => {
      if (!invoice.order) {
        return "-";
      }
      return orderQuantityById.get(invoice.order) ?? 0;
    },
    [orderQuantityById]
  );

  const searchedInvoices = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return invoices;
    }
    return invoices.filter((invoice) => {
      const numberText = invoice.invoice_number.toLowerCase();
      const statusText = invoice.status.toLowerCase();
      const qtyText = String(getInvoiceQuantity(invoice));
      const totalText = `${invoice.total} ${invoice.currency}`.toLowerCase();
      return (
        numberText.includes(normalizedQuery) ||
        statusText.includes(normalizedQuery) ||
        qtyText.includes(normalizedQuery) ||
        totalText.includes(normalizedQuery)
      );
    });
  }, [invoices, searchQuery, getInvoiceQuantity]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedInvoices.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedInvoices.length / resolvedPageSize));
  const pagedInvoices = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedInvoices.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedInvoices, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const columns = [
    { key: "invoice_number", header: t("invoiceNumberLabel") },
    {
      key: "status",
      header: t("statusLabel"),
      render: (row: FinanceInvoice) => {
        const meta = getInvoiceStatusMeta(row.status);
        return <StatusBadge label={meta.label} tone={meta.tone} />;
      },
    },
    {
      key: "quantity",
      header: t("qtyLabel"),
      render: (row: FinanceInvoice) => getInvoiceQuantity(row),
    },
    {
      key: "total",
      header: t("totalLabel"),
      render: (row: FinanceInvoice) => `${row.total} ${row.currency}`,
    },
    {
      key: "issued_at",
      header: t("issuedAtLabel"),
      render: (row: FinanceInvoice) =>
        row.issued_at ? new Date(row.issued_at).toLocaleString() : "-",
    },
    {
      key: "actions",
      header: common("paymentActionsLabel"),
      render: (row: FinanceInvoice) => {
        const isPayable = ["draft", "issued"].includes(row.status);
        return isPayable ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePayNow(row)}
              disabled={activeOrderId === row.order}
            >
              {activeOrderId === row.order ? common("paymentProcessing") : common("payNow")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleInvoicePdf(row.id)}
            >
              {common("invoicePdfLabel")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleInvoicePdf(row.id)}
            >
              {common("invoicePdfLabel")}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <ClubAdminLayout title={t("invoicesTitle")} subtitle={t("invoicesSubtitle")}>
      <section className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-full max-w-sm"
          placeholder={t("searchInvoicesPlaceholder")}
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
      ) : searchedInvoices.length === 0 ? (
        <EmptyState title={t("noInvoicesTitle")} description={t("noInvoicesSubtitle")} />
      ) : (
        <>
          <EntityTable
            columns={columns}
            rows={pagedInvoices}
            onRowClick={(row) => router.push(`/${locale}/dashboard/club/invoices/${row.id}`)}
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
      {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}

    </ClubAdminLayout>
  );
}
