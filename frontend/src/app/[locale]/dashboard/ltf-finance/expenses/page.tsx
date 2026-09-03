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
import {
  FinanceExpense,
  getFinanceExpensesPage,
} from "@/lib/ltf-finance-api";
import { formatDisplayDate } from "@/lib/date-display";

type ExpenseStatusFilter = "all" | "recorded" | "paid" | "void";

export default function LtfFinanceExpensesPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [expenses, setExpenses] = useState<FinanceExpense[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [statusFilter, setStatusFilter] = useState<ExpenseStatusFilter>("all");
  const [totalCount, setTotalCount] = useState(0);
  const [facetCounts, setFacetCounts] = useState({ all: 0, recorded: 0, paid: 0, void: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const loadExpenses = useCallback(async () => {
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const query = { q: searchQuery || undefined };
      const [pageResponse, allRes, recordedRes, paidRes, voidRes] = await Promise.all([
        getFinanceExpensesPage(
          {
            page: currentPage,
            pageSize: resolveListPageSize(pageSize, LIST_PAGE_SIZE_CAP),
            q: searchQuery || undefined,
            status: statusFilter === "all" ? undefined : statusFilter,
          },
          { signal: controller.signal }
        ),
        getFinanceExpensesPage({ page: 1, pageSize: 1, ...query }, { signal: controller.signal }),
        getFinanceExpensesPage(
          { page: 1, pageSize: 1, ...query, status: "recorded" },
          { signal: controller.signal }
        ),
        getFinanceExpensesPage(
          { page: 1, pageSize: 1, ...query, status: "paid" },
          { signal: controller.signal }
        ),
        getFinanceExpensesPage(
          { page: 1, pageSize: 1, ...query, status: "void" },
          { signal: controller.signal }
        ),
      ]);
      if (requestAbortRef.current !== controller) {
        return;
      }
      setExpenses(pageResponse.results);
      setTotalCount(pageResponse.count);
      setFacetCounts({
        all: allRes.count,
        recorded: recordedRes.count,
        paid: paidRes.count,
        void: voidRes.count,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : t("expensesLoadError"));
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      setIsLoading(false);
    }
  }, [currentPage, pageSize, searchQuery, statusFilter, t]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

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
    () => (status: FinanceExpense["status"]) => {
      switch (status) {
        case "recorded":
          return { label: t("expenseStatusRecorded"), tone: "warning" as const };
        case "paid":
          return { label: common("statusPaid"), tone: "success" as const };
        case "void":
          return { label: common("statusVoid"), tone: "danger" as const };
        default:
          return { label: status, tone: "neutral" as const };
      }
    },
    [common, t]
  );

  return (
    <LtfFinanceLayout title={t("expensesTitle")} subtitle={t("expensesSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          search={
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchExpensesPlaceholder")}
              aria-label={t("searchExpensesPlaceholder")}
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
              ariaLabel={t("expensesStatusFilterAriaLabel")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", title: t("filterAllTitle"), count: facetCounts.all },
                { value: "recorded", title: t("expenseStatusRecorded"), count: facetCounts.recorded },
                { value: "paid", title: common("statusPaid"), count: facetCounts.paid },
                { value: "void", title: common("statusVoid"), count: facetCounts.void },
              ]}
            />
          }
        />
        <ListActionsRow
          actions={
            <Button variant="primary" onClick={() => router.push(`/${locale}/dashboard/ltf-finance/expenses/new`)}>
              {t("recordExpenseAction")}
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
      ) : expenses.length === 0 ? (
        <EmptyState title={t("noExpensesTitle")} description={t("noExpensesSubtitle")} />
      ) : (
        <EntityTable
          columns={[
            {
              key: "expense_date",
              header: t("expenseDateLabel"),
              render: (row: FinanceExpense) => formatDisplayDate(row.expense_date),
            },
            { key: "expense_number", header: t("expenseNumberLabel") },
            { key: "category_name", header: t("expenseCategoryLabel") },
            {
              key: "payee",
              header: t("expensePayeeLabel"),
              render: (row: FinanceExpense) => row.payee || "-",
            },
            { key: "description", header: t("expenseDescriptionLabel") },
            {
              key: "amount",
              header: t("expenseAmountLabel"),
              render: (row: FinanceExpense) => `${row.amount} ${row.currency}`,
            },
            {
              key: "status",
              header: t("statusLabel"),
              render: (row: FinanceExpense) => {
                const meta = statusMeta(row.status);
                return <StatusBadge label={meta.label} tone={meta.tone} />;
              },
            },
          ]}
          rows={expenses}
          onRowClick={(row) => router.push(`/${locale}/dashboard/ltf-finance/expenses/${row.id}`)}
        />
      )}
    </LtfFinanceLayout>
  );
}
