"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { useClubSelection } from "@/components/club-selection-provider";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { SummaryCard } from "@/components/club-admin/summary-card";
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
  ActionNotices,
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDisplayDateTime } from "@/lib/date-display";
import { openInvoicePdf } from "@/lib/invoice-pdf";
import {
  FinanceInvoice,
  getFinanceInvoiceTotals,
  getFinanceInvoicesPage,
} from "@/lib/ltf-finance-api";

const AUTO_REFRESH_INTERVAL_MS = 30000;

type InvoiceStatusFilter = "all" | "draft" | "issued" | "paid" | "void";

export default function LtfFinanceInvoicesPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const overdueIssue = searchParams.get("issue") === "overdue_7d";
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [totalInvoiceCount, setTotalInvoiceCount] = useState(0);
  const [outstandingAmount, setOutstandingAmount] = useState("0.00");
  const [outstandingCurrency, setOutstandingCurrency] = useState("EUR");
  const [invoiceFacetCounts, setInvoiceFacetCounts] = useState({
    all: 0,
    draft: 0,
    issued: 0,
    paid: 0,
    void: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isRefreshingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const { selectedClubId } = useClubSelection();

  const loadInvoices = useCallback(
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
        const invoicesPromise = getFinanceInvoicesPage(
          {
            page: currentPage,
            pageSize: resolveListPageSize(pageSize, LIST_PAGE_SIZE_CAP),
            q: searchQuery || undefined,
            status: overdueIssue ? "issued" : statusFilter === "all" ? undefined : statusFilter,
            clubId: selectedClubId ?? undefined,
            issue: overdueIssue ? "overdue_7d" : undefined,
          },
          { signal: controller.signal }
        );
        if (includeStatic) {
          const [
            invoiceResponse,
            totalsResponse,
            allCountRes,
            draftCountRes,
            issuedCountRes,
            paidCountRes,
            voidCountRes,
          ] = await Promise.all([
            invoicesPromise,
            getFinanceInvoiceTotals(facetParams, { signal: controller.signal }),
            getFinanceInvoicesPage({ page: 1, pageSize: 1, ...facetParams }, { signal: controller.signal }),
            getFinanceInvoicesPage(
              { page: 1, pageSize: 1, ...facetParams, status: "draft" },
              { signal: controller.signal }
            ),
            getFinanceInvoicesPage(
              { page: 1, pageSize: 1, ...facetParams, status: "issued" },
              { signal: controller.signal }
            ),
            getFinanceInvoicesPage(
              { page: 1, pageSize: 1, ...facetParams, status: "paid" },
              { signal: controller.signal }
            ),
            getFinanceInvoicesPage(
              { page: 1, pageSize: 1, ...facetParams, status: "void" },
              { signal: controller.signal }
            ),
          ]);
          setInvoices(invoiceResponse.results);
          setTotalInvoiceCount(invoiceResponse.count);
          setOutstandingAmount(totalsResponse.outstanding_amount);
          setOutstandingCurrency(totalsResponse.currency);
          setInvoiceFacetCounts({
            all: allCountRes.count,
            draft: draftCountRes.count,
            issued: issuedCountRes.count,
            paid: paidCountRes.count,
            void: voidCountRes.count,
          });
        } else {
          const invoiceResponse = await invoicesPromise;
          setInvoices(invoiceResponse.results);
          setTotalInvoiceCount(invoiceResponse.count);
        }
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
    [currentPage, overdueIssue, pageSize, searchQuery, selectedClubId, statusFilter, t]
  );

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClubId, searchQuery, pageSize, statusFilter, overdueIssue]);

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
        void loadInvoices({ silent: true, includeStatic: false });
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
  }, [loadInvoices]);

  const resolvedPageSize = resolveListPageSize(pageSize, totalInvoiceCount);
  const totalPages = Math.max(1, Math.ceil(totalInvoiceCount / resolvedPageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const getInvoiceStatusMeta = (status: string) => {
    switch (status) {
      case "draft":
        return { label: common("statusDraft"), tone: "neutral" as const };
      case "issued":
        return { label: common("statusIssued"), tone: "warning" as const };
      case "paid":
        return { label: common("statusPaid"), tone: "success" as const };
      case "void":
        return { label: common("statusVoid"), tone: "danger" as const };
      default:
        return { label: status, tone: "neutral" as const };
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

  const columns = useMemo(
    () => [
      { key: "invoice_number", header: t("invoiceNumberLabel") },
      {
        key: "club",
        header: t("clubLabel"),
        render: (row: FinanceInvoice) => row.club_name || String(row.club),
      },
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
        header: common("qtyLabel"),
        render: (row: FinanceInvoice) =>
          typeof row.item_quantity === "number" ? row.item_quantity : "-",
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
        header: t("actionLabel"),
        render: (row: FinanceInvoice) => {
          const canRecord = row.status !== "paid" && row.status !== "void";
          return (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleInvoicePdf(row.id)}>
                {common("invoicePdfLabel")}
              </Button>
              {canRecord ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(`/${locale}/dashboard/ltf-finance/payments/${row.id}/record`)
                  }
                >
                  {t("recordPaymentButton")}
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [common, locale, router, t]
  );

  return (
    <LtfFinanceLayout title={t("invoicesTitle")} subtitle={t("invoicesSubtitle")}>
      <ActionNotices
        error={errorMessage || actionError}
        onDismiss={() => {
          setErrorMessage(null);
          setActionError(null);
        }}
      />
      {overdueIssue ? (
        <PageNotice tone="info">
          <span className="flex items-start justify-between gap-3">
            <span>{t("issuedInvoicesOverdueFilterMessage")}</span>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-form)]"
              aria-label={common("modalClose")}
              onClick={() => router.replace(`/${locale}/dashboard/ltf-finance/invoices`)}
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </PageNotice>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title={t("outstandingAmountLabel")}
          value={`${outstandingAmount} ${outstandingCurrency}`}
        />
        <SummaryCard title={t("invoicesIssuedCountLabel")} value={String(invoiceFacetCounts.issued)} />
        <SummaryCard title={t("invoicesPaidCountLabel")} value={String(invoiceFacetCounts.paid)} />
      </section>

      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          search={
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchInvoicesPlaceholder")}
              aria-label={t("searchInvoicesPlaceholder")}
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
              ariaLabel={t("invoicesStatusFilterAriaLabel")}
              value={overdueIssue ? "issued" : statusFilter}
              onChange={setStatusFilter}
              disabled={overdueIssue}
              options={[
                { value: "all", title: t("filterAllTitle"), count: invoiceFacetCounts.all },
                { value: "draft", title: common("statusDraft"), count: invoiceFacetCounts.draft },
                { value: "issued", title: common("statusIssued"), count: invoiceFacetCounts.issued },
                { value: "paid", title: common("statusPaid"), count: invoiceFacetCounts.paid },
                { value: "void", title: common("statusVoid"), count: invoiceFacetCounts.void },
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
      ) : invoices.length === 0 ? (
        <EmptyState title={t("noInvoicesTitle")} description={t("noInvoicesSubtitle")} />
      ) : (
        <EntityTable
          columns={columns}
          rows={invoices}
          onRowClick={(invoice) =>
            router.push(`/${locale}/dashboard/ltf-finance/invoices/${invoice.id}`)
          }
        />
      )}
    </LtfFinanceLayout>
  );
}
