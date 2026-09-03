"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  LIST_PAGE_SIZE_CAP,
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  PageSizeSelect,
  resolveListPageSize,
  ActionNotices
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { FinanceIncome, getFinanceIncomesPage } from "@/lib/ltf-finance-api";
import { formatDisplayDate } from "@/lib/date-display";

type IncomeStatusFilter = "all" | "received" | "void";

export default function LtfFinanceIncomePage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [incomes, setIncomes] = useState<FinanceIncome[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [statusFilter, setStatusFilter] = useState<IncomeStatusFilter>("all");
  const [totalCount, setTotalCount] = useState(0);
  const [facetCounts, setFacetCounts] = useState({ all: 0, received: 0, void: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const loadIncomes = useCallback(async () => {
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const query = { q: searchQuery || undefined };
      const [pageResponse, allRes, receivedRes, voidRes] = await Promise.all([
        getFinanceIncomesPage(
          {
            page: currentPage,
            pageSize: resolveListPageSize(pageSize, LIST_PAGE_SIZE_CAP),
            q: searchQuery || undefined,
            status: statusFilter === "all" ? undefined : statusFilter,
          },
          { signal: controller.signal }
        ),
        getFinanceIncomesPage({ page: 1, pageSize: 1, ...query }, { signal: controller.signal }),
        getFinanceIncomesPage(
          { page: 1, pageSize: 1, ...query, status: "received" },
          { signal: controller.signal }
        ),
        getFinanceIncomesPage(
          { page: 1, pageSize: 1, ...query, status: "void" },
          { signal: controller.signal }
        ),
      ]);
      if (requestAbortRef.current !== controller) {
        return;
      }
      setIncomes(pageResponse.results);
      setTotalCount(pageResponse.count);
      setFacetCounts({
        all: allRes.count,
        received: receivedRes.count,
        void: voidRes.count,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : t("incomeLoadError"));
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      setIsLoading(false);
    }
  }, [currentPage, pageSize, searchQuery, statusFilter, t]);

  useEffect(() => {
    void loadIncomes();
  }, [loadIncomes]);

  useEffect(() => {
    return () => requestAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize, statusFilter]);

  const resolvedPageSize = resolveListPageSize(pageSize, totalCount);
  const totalPages = Math.max(1, Math.ceil(totalCount / resolvedPageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const statusMeta = useMemo(
    () => (status: FinanceIncome["status"]) => {
      switch (status) {
        case "received":
          return { label: t("incomeStatusReceived"), tone: "success" as const };
        case "void":
          return { label: common("statusVoid"), tone: "danger" as const };
        default:
          return { label: status, tone: "neutral" as const };
      }
    },
    [common, t]
  );

  return (
    <LtfFinanceLayout title={t("incomeTitle")} subtitle={t("incomeSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          search={
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchIncomePlaceholder")}
              aria-label={t("searchIncomePlaceholder")}
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
              ariaLabel={t("incomeStatusFilterAriaLabel")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", title: t("filterAllTitle"), count: facetCounts.all },
                { value: "received", title: t("incomeStatusReceived"), count: facetCounts.received },
                { value: "void", title: common("statusVoid"), count: facetCounts.void },
              ]}
            />
          }
        />
        <ListActionsRow
          actions={
            <Button variant="primary" onClick={() => router.push(`/${locale}/dashboard/ltf-finance/income/new`)}>
              {t("recordIncomeAction")}
            </Button>
          }
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
      ) : incomes.length === 0 ? (
        <EmptyState title={t("noIncomeTitle")} description={t("noIncomeSubtitle")} />
      ) : (
        <EntityTable
          columns={[
            {
              key: "income_date",
              header: t("incomeDateLabel"),
              render: (row: FinanceIncome) => formatDisplayDate(row.income_date),
            },
            { key: "income_number", header: t("incomeNumberLabel") },
            { key: "category_name", header: t("incomeCategoryLabel") },
            {
              key: "payer",
              header: t("incomePayerLabel"),
              render: (row: FinanceIncome) => row.payer || "-",
            },
            { key: "description", header: t("incomeDescriptionLabel") },
            {
              key: "amount",
              header: t("incomeAmountLabel"),
              render: (row: FinanceIncome) => `${row.amount} ${row.currency}`,
            },
            {
              key: "status",
              header: t("statusLabel"),
              render: (row: FinanceIncome) => {
                const meta = statusMeta(row.status);
                return <StatusBadge label={meta.label} tone={meta.tone} />;
              },
            },
          ]}
          rows={incomes}
          onRowClick={(row) => router.push(`/${locale}/dashboard/ltf-finance/income/${row.id}`)}
        />
      )}
    </LtfFinanceLayout>
  );
}
