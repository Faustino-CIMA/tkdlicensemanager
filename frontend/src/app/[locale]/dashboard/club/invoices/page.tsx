"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  FinanceInvoice,
  createClubCheckoutSession,
  getClubInvoicesPage,
} from "@/lib/club-finance-api";
import { formatDisplayDateTime } from "@/lib/date-display";
import { openInvoicePdf } from "@/lib/invoice-pdf";

const AUTO_REFRESH_INTERVAL_MS = 30000;

export default function ClubAdminInvoicesPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const { selectedClubId } = useClubSelection();
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isRefreshingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);

  const pageSizeOptions = ["10", "25", "50", "100", "150", "200"];

  const loadData = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
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
        const invoiceResponse = await getClubInvoicesPage(
          {
            page: currentPage,
            pageSize: Number(pageSize),
            clubId: selectedClubId ?? undefined,
            q: searchQuery || undefined,
          },
          {
            signal: controller.signal,
          }
        );
        setInvoices(invoiceResponse.results);
        setTotalCount(invoiceResponse.count);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : t("invoicesLoadError"));
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
    [currentPage, pageSize, searchQuery, selectedClubId, t]
  );

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

  const getInvoiceQuantity = useCallback(
    (invoice: FinanceInvoice) => {
      return typeof invoice.item_quantity === "number" ? invoice.item_quantity : "-";
    },
    []
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / Number(pageSize)));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize, selectedClubId]);

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
      render: (row: FinanceInvoice) => formatDisplayDateTime(row.issued_at),
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
      ) : invoices.length === 0 ? (
        <EmptyState title={t("noInvoicesTitle")} description={t("noInvoicesSubtitle")} />
      ) : (
        <>
          <EntityTable
            columns={columns}
            rows={invoices}
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
