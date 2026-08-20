"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { useClubSelection } from "@/components/club-selection-provider";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  ExpandableTable,
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
  FinanceInvoice,
  getFinanceClubs,
  getFinanceInvoicesPage,
} from "@/lib/ltf-finance-api";
import { formatDisplayDateTime } from "@/lib/date-display";
import { openInvoicePdf } from "@/lib/invoice-pdf";

const AUTO_REFRESH_INTERVAL_MS = 30000;

type InvoiceStatusFilter = "all" | "draft" | "issued" | "paid" | "void";

function getGroupYear(value: string | null, fallback: string) {
  const candidate = value ?? fallback;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getFullYear();
}

function getYearKey(clubId: number, year: number) {
  return `${clubId}:${year}`;
}

export default function LtfFinanceInvoicesPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [totalInvoiceCount, setTotalInvoiceCount] = useState(0);
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
  const [expandedClubIds, setExpandedClubIds] = useState<number[]>([]);
  const [expandedYearKeys, setExpandedYearKeys] = useState<string[]>([]);
  const [expandedStateHydrated, setExpandedStateHydrated] = useState(false);
  const isRefreshingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);

  const expandedClubStorageKey = "ltf_finance_invoices_expanded_clubs";
  const expandedYearStorageKey = "ltf_finance_invoices_expanded_years";
  const { selectedClubId } = useClubSelection();

  const loadInvoices = useCallback(async (options?: { silent?: boolean; includeStatic?: boolean }) => {
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
          status: statusFilter === "all" ? undefined : statusFilter,
          clubId: selectedClubId ?? undefined,
        },
        { signal: controller.signal }
      );
      if (includeStatic) {
        const [
          invoiceResponse,
          clubResponse,
          allCountRes,
          draftCountRes,
          issuedCountRes,
          paidCountRes,
          voidCountRes,
        ] = await Promise.all([
          invoicesPromise,
          getFinanceClubs({ signal: controller.signal }),
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
        setClubs(clubResponse);
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
  }, [currentPage, pageSize, searchQuery, selectedClubId, statusFilter, t]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

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

  const clubNameById = useMemo(() => {
    return clubs.reduce<Record<number, string>>((acc, club) => {
      acc[club.id] = club.name;
      return acc;
    }, {});
  }, [clubs]);

  const getInvoiceQuantity = useCallback((invoice: FinanceInvoice) => {
    return typeof invoice.item_quantity === "number" ? invoice.item_quantity : "-";
  }, []);

  const searchedInvoices = useMemo(() => {
    return invoices;
  }, [invoices]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize, statusFilter]);

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

  const groupedClubRows = useMemo(() => {
    const grouped = new Map<
      number,
      {
        clubName: string;
        yearsMap: Map<number, FinanceInvoice[]>;
      }
    >();

    for (const invoice of searchedInvoices) {
      const year = getGroupYear(invoice.issued_at, invoice.created_at);
      const clubName = clubNameById[invoice.club] ?? String(invoice.club);
      const clubEntry = grouped.get(invoice.club);
      if (!clubEntry) {
        grouped.set(invoice.club, {
          clubName,
          yearsMap: new Map([[year, [invoice]]]),
        });
        continue;
      }
      const yearEntry = clubEntry.yearsMap.get(year);
      if (yearEntry) {
        yearEntry.push(invoice);
      } else {
        clubEntry.yearsMap.set(year, [invoice]);
      }
    }

    return Array.from(grouped.entries())
      .map(([clubId, clubEntry]) => {
        const years = Array.from(clubEntry.yearsMap.entries())
          .map(([year, yearInvoices]) => {
            const invoicesForYear = [...yearInvoices].sort((left, right) => {
              const leftTimestamp = left.issued_at ?? left.created_at;
              const rightTimestamp = right.issued_at ?? right.created_at;
              return rightTimestamp.localeCompare(leftTimestamp);
            });
            const counts = invoicesForYear.reduce(
              (acc, invoice) => {
                if (invoice.status === "draft") {
                  acc.draftCount += 1;
                } else if (invoice.status === "issued") {
                  acc.issuedCount += 1;
                } else if (invoice.status === "paid") {
                  acc.paidCount += 1;
                } else if (invoice.status === "void") {
                  acc.voidCount += 1;
                }
                return acc;
              },
              { draftCount: 0, issuedCount: 0, paidCount: 0, voidCount: 0 }
            );
            return {
              year,
              invoices: invoicesForYear,
              total: invoicesForYear.length,
              ...counts,
            };
          })
          .sort((left, right) => right.year - left.year);

        const total = years.reduce((sum, year) => sum + year.total, 0);
        const draftCount = years.reduce((sum, year) => sum + year.draftCount, 0);
        const issuedCount = years.reduce((sum, year) => sum + year.issuedCount, 0);
        const paidCount = years.reduce((sum, year) => sum + year.paidCount, 0);
        const voidCount = years.reduce((sum, year) => sum + year.voidCount, 0);

        return {
          clubId,
          clubName: clubEntry.clubName,
          years,
          total,
          draftCount,
          issuedCount,
          paidCount,
          voidCount,
        };
      })
      .sort((left, right) => left.clubName.localeCompare(right.clubName));
  }, [clubNameById, searchedInvoices]);

  const resolvedPageSize = resolveListPageSize(pageSize, totalInvoiceCount);
  const totalPages = Math.max(1, Math.ceil(totalInvoiceCount / resolvedPageSize));

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
    <LtfFinanceLayout title={t("invoicesTitle")} subtitle={t("invoicesSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}
      {actionError ? <PageNotice tone="danger">{actionError}</PageNotice> : null}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t("invoicesDraftCountLabel")}
          value={String(invoiceFacetCounts.draft)}
        />
        <SummaryCard
          title={t("invoicesIssuedCountLabel")}
          value={String(invoiceFacetCounts.issued)}
        />
        <SummaryCard
          title={t("invoicesPaidCountLabel")}
          value={String(invoiceFacetCounts.paid)}
        />
        <SummaryCard
          title={t("invoicesVoidCountLabel")}
          value={String(invoiceFacetCounts.void)}
        />
      </section>

      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          filtersPlacement="below"
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
              layout="wrap"
              ariaLabel={t("invoicesStatusFilterAriaLabel")}
              value={statusFilter}
              onChange={setStatusFilter}
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
      ) : groupedClubRows.length === 0 ? (
        <EmptyState title={t("noInvoicesTitle")} description={t("noInvoicesSubtitle")} />
      ) : (
        <ExpandableTable>
            <table className={dataTableClass}>
              <thead className={dataTheadClass}>
                <tr>
                  <th className={`w-10 ${dataThClass}`} />
                  <th className={dataThClass}>{t("clubLabel")}</th>
                  <th className={dataThClass}>{t("totalLabel")}</th>
                  <th className={dataThClass}>{t("invoicesDraftCountLabel")}</th>
                  <th className={dataThClass}>{t("invoicesIssuedCountLabel")}</th>
                  <th className={dataThClass}>{t("invoicesPaidCountLabel")}</th>
                  <th className={dataThClass}>{t("invoicesVoidCountLabel")}</th>
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
                        <td className={dataTdClass}>{clubGroup.draftCount}</td>
                        <td className={dataTdClass}>{clubGroup.issuedCount}</td>
                        <td className={dataTdClass}>{clubGroup.paidCount}</td>
                        <td className={dataTdClass}>{clubGroup.voidCount}</td>
                      </tr>
                      {clubExpanded ? (
                        <tr className="bg-secondary/60">
                          <td colSpan={7} className="px-6 py-3">
                            <NestedTable>
                              <table className={dataTableClass}>
                                <thead className={dataTheadClass}>
                                  <tr>
                                    <th className="w-10 px-4 py-2 font-medium" />
                                    <th className="px-4 py-2 font-medium">{t("yearLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("totalLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("invoicesDraftCountLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("invoicesIssuedCountLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("invoicesPaidCountLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("invoicesVoidCountLabel")}</th>
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
                                          <td className="px-4 py-2">{yearGroup.draftCount}</td>
                                          <td className="px-4 py-2">{yearGroup.issuedCount}</td>
                                          <td className="px-4 py-2">{yearGroup.paidCount}</td>
                                          <td className="px-4 py-2">{yearGroup.voidCount}</td>
                                        </tr>
                                        {yearExpanded ? (
                                          <tr className="bg-secondary/50">
                                            <td colSpan={7} className="px-6 py-3">
                                              <NestedTable>
                                                <table className={dataTableClass}>
                                                  <thead className={dataTheadClass}>
                                                    <tr>
                                                      <th className="px-4 py-2 font-medium">{t("invoiceNumberLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("statusLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{common("qtyLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("totalLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("issuedAtLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{common("invoicePdfLabel")}</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-border/80">
                                                    {yearGroup.invoices.map((invoice) => {
                                                      const meta = getInvoiceStatusMeta(invoice.status);
                                                      return (
                                                        <tr
                                                          key={invoice.id}
                                                          className={dataRowClickableClass}
                                                          onClick={() => {
                                                            router.push(
                                                              `/${locale}/dashboard/ltf-finance/invoices/${invoice.id}`
                                                            );
                                                          }}
                                                        >
                                                          <td className="px-4 py-2 font-medium">
                                                            {invoice.invoice_number}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            <StatusBadge label={meta.label} tone={meta.tone} />
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {getInvoiceQuantity(invoice)}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {`${invoice.total} ${invoice.currency}`}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {formatDisplayDateTime(invoice.issued_at)}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            <Button
                                                              variant="ghost"
                                                              size="sm"
                                                              onClick={async (event) => {
                                                                event.stopPropagation();
                                                                setActionError(null);
                                                                try {
                                                                  await openInvoicePdf(invoice.id);
                                                                } catch (error) {
                                                                  setActionError(
                                                                    error instanceof Error
                                                                      ? error.message
                                                                      : common("pdfDownloadFailed")
                                                                  );
                                                                }
                                                              }}
                                                            >
                                                              {common("invoicePdfLabel")}
                                                            </Button>
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
