"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { useClubSelection } from "@/components/club-selection-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
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

type InvoiceStatusFilter = "all" | "draft" | "issued" | "paid" | "void";

/** Matches backend `API_PAGINATION_MAX_PAGE_SIZE`. */
const INVOICES_LIST_PAGE_SIZE_CAP = 200;

export default function ClubAdminInvoicesPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const overdueIssue = searchParams.get("issue") === "overdue_7d";
  const { selectedClubId } = useClubSelection();
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [invoiceFacetCounts, setInvoiceFacetCounts] = useState({
    all: 0,
    draft: 0,
    issued: 0,
    paid: 0,
    void: 0,
  });
  const isRefreshingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);

  const pageSizeOptions = ["50", "150", "300", "all"];
  const statusFilterParam = overdueIssue
    ? "issued"
    : invoiceStatusFilter === "all"
      ? undefined
      : invoiceStatusFilter;

  const invoicesListPageSize = useMemo(() => {
    if (pageSize === "all") {
      return Math.min(Math.max(totalCount, 1), INVOICES_LIST_PAGE_SIZE_CAP);
    }
    const n = Number(pageSize);
    if (!Number.isFinite(n) || n <= 0) {
      return 50;
    }
    return Math.min(n, INVOICES_LIST_PAGE_SIZE_CAP);
  }, [pageSize, totalCount]);

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
      const q = searchQuery || undefined;
      const clubId = selectedClubId ?? undefined;
      try {
        const [invoiceResponse, allCountRes, draftCountRes, issuedCountRes, paidCountRes, voidCountRes] =
          await Promise.all([
            getClubInvoicesPage(
              {
                page: currentPage,
                pageSize: invoicesListPageSize,
                clubId,
                q,
                status: statusFilterParam,
                issue: overdueIssue ? "overdue_7d" : undefined,
              },
              { signal: controller.signal }
            ),
            getClubInvoicesPage({ page: 1, pageSize: 1, clubId, q }, { signal: controller.signal }),
            getClubInvoicesPage(
              { page: 1, pageSize: 1, clubId, q, status: "draft" },
              { signal: controller.signal }
            ),
            getClubInvoicesPage(
              { page: 1, pageSize: 1, clubId, q, status: "issued" },
              { signal: controller.signal }
            ),
            getClubInvoicesPage(
              { page: 1, pageSize: 1, clubId, q, status: "paid" },
              { signal: controller.signal }
            ),
            getClubInvoicesPage(
              { page: 1, pageSize: 1, clubId, q, status: "void" },
              { signal: controller.signal }
            ),
          ]);
        setInvoices(invoiceResponse.results);
        setTotalCount(invoiceResponse.count);
        setInvoiceFacetCounts({
          all: allCountRes.count,
          draft: draftCountRes.count,
          issued: issuedCountRes.count,
          paid: paidCountRes.count,
          void: voidCountRes.count,
        });
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
    [currentPage, invoicesListPageSize, overdueIssue, searchQuery, selectedClubId, statusFilterParam, t]
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

  const getInvoiceQuantity = useCallback((invoice: FinanceInvoice) => {
    return typeof invoice.item_quantity === "number" ? invoice.item_quantity : "-";
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / invoicesListPageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize, selectedClubId, invoiceStatusFilter, overdueIssue]);

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
            <Button variant="ghost" size="sm" onClick={() => handleInvoicePdf(row.id)}>
              {common("invoicePdfLabel")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleInvoicePdf(row.id)}>
              {common("invoicePdfLabel")}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <ClubAdminLayout title={t("invoicesTitle")} subtitle={t("invoicesSubtitle")}>
      <div className="space-y-6">
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
        {overdueIssue ? (
          <div className="flex items-start justify-between gap-3 rounded-[var(--radius-form)] border px-4 py-3 text-sm banner-info">
            <p className="min-w-0 flex-1">{t("issuedInvoicesOverdueFilterMessage")}</p>
            <button
              type="button"
              className="inline-flex h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0 items-center justify-center rounded-[var(--radius-form)]"
              aria-label={common("modalClose")}
              onClick={() => router.replace(`/${locale}/dashboard/club/invoices`)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex min-w-[12rem] flex-1 flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <Input
                  className="w-full max-w-xs"
                  placeholder={t("searchInvoicesPlaceholder")}
                  aria-label={t("searchInvoicesPlaceholder")}
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>
              <div>
                <Select value={pageSize} onValueChange={setPageSize}>
                  <SelectTrigger className="w-[150px]" aria-label={common("rowsPerPageLabel")}>
                    <SelectValue placeholder={common("rowsPerPageLabel")} />
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
            </div>

            <div className="min-w-0 flex-1 border-t border-[var(--border)] pt-4 sm:border-t-0 sm:pt-0">
              <FilterPills
                ariaLabel={t("invoicesStatusFilterAriaLabel")}
                value={overdueIssue ? "issued" : invoiceStatusFilter}
                onChange={setInvoiceStatusFilter}
                disabled={overdueIssue}
                options={[
                  { value: "all", title: t("filterAllTitle"), count: invoiceFacetCounts.all },
                  { value: "draft", title: common("statusDraft"), count: invoiceFacetCounts.draft },
                  { value: "issued", title: t("invoiceStatusDue"), count: invoiceFacetCounts.issued },
                  { value: "paid", title: common("statusPaid"), count: invoiceFacetCounts.paid },
                  { value: "void", title: common("statusVoid"), count: invoiceFacetCounts.void },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              <span>{t("pageLabel", { current: currentPage, total: totalPages })}</span>
              <Button
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              >
                {t("previousPage")}
              </Button>
              <Button
                variant="outline"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : invoices.length === 0 ? (
          <EmptyState title={t("noInvoicesTitle")} description={t("noInvoicesSubtitle")} />
        ) : (
          <EntityTable
            columns={columns}
            rows={invoices}
            onRowClick={(row) => router.push(`/${locale}/dashboard/club/invoices/${row.id}`)}
          />
        )}
      </div>
    </ClubAdminLayout>
  );
}
