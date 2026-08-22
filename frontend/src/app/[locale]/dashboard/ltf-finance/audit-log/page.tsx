"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Input } from "@/components/ui/input";
import {
  LIST_PAGE_SIZE_CAP,
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  PageNotice,
  PageSizeSelect,
  resolveListPageSize,
} from "@/components/ui/list-page-chrome";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  Club,
  FinanceAuditLog,
  getFinanceAuditLogsList,
  getFinanceAuditLogsPage,
  getFinanceClubs,
} from "@/lib/ltf-finance-api";

function humanizeAuditAction(action: string) {
  return action
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function LtfFinanceAuditLogPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const [logs, setLogs] = useState<FinanceAuditLog[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const loadLogs = useCallback(async () => {
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const normalizedSearch = searchQuery || undefined;
      if (pageSize === "all") {
        const [response, clubsResponse] = await Promise.all([
          getFinanceAuditLogsList({ q: normalizedSearch }, { signal: controller.signal }),
          getFinanceClubs({ signal: controller.signal }),
        ]);
        if (requestAbortRef.current !== controller) {
          return;
        }
        setLogs(response);
        setTotalCount(response.length);
        setClubs(clubsResponse);
      } else {
        const [response, clubsResponse] = await Promise.all([
          getFinanceAuditLogsPage(
            {
              page: currentPage,
              pageSize: resolveListPageSize(pageSize, LIST_PAGE_SIZE_CAP),
              q: normalizedSearch,
            },
            { signal: controller.signal }
          ),
          getFinanceClubs({ signal: controller.signal }),
        ]);
        if (requestAbortRef.current !== controller) {
          return;
        }
        setLogs(response.results);
        setTotalCount(response.count);
        setClubs(clubsResponse);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : t("auditLogLoadError"));
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      setIsLoading(false);
    }
  }, [currentPage, pageSize, searchQuery, t]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    return () => {
      requestAbortRef.current?.abort();
    };
  }, []);

  const resolvedPageSize = resolveListPageSize(pageSize, totalCount);
  const totalPages =
    pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalCount / resolvedPageSize));

  const clubNameById = useMemo(() => {
    return clubs.reduce<Record<number, string>>((acc, club) => {
      acc[club.id] = club.name;
      return acc;
    }, {});
  }, [clubs]);

  const auditActionLabel = (action: string) => {
    switch (action) {
      case "order.created":
        return t("auditActionOrderCreated");
      case "invoice.created":
        return t("auditActionInvoiceCreated");
      case "licenses.created":
        return t("auditActionLicensesCreated");
      case "licenses.activated":
        return t("auditActionLicensesActivated");
      case "order.paid":
        return t("auditActionOrderPaid");
      case "order.payment_blocked":
        return t("auditActionOrderPaymentBlocked");
      case "payconiq.created":
        return t("auditActionPayconiqCreated");
      case "expense.created":
        return t("auditActionExpenseCreated");
      case "expense.updated":
        return t("auditActionExpenseUpdated");
      case "expense.paid":
        return t("auditActionExpensePaid");
      case "expense.voided":
        return t("auditActionExpenseVoided");
      case "income.created":
        return t("auditActionIncomeCreated");
      case "income.updated":
        return t("auditActionIncomeUpdated");
      case "income.voided":
        return t("auditActionIncomeVoided");
      case "finance_opening.updated":
        return t("auditActionFinanceOpeningUpdated");
      default:
        return humanizeAuditAction(action);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const columns = [
    {
      key: "created_at",
      header: t("createdAtLabel"),
      render: (row: FinanceAuditLog) => formatDisplayDateTime(row.created_at),
    },
    {
      key: "action",
      header: t("actionLabel"),
      render: (row: FinanceAuditLog) => auditActionLabel(row.action),
    },
    {
      key: "message",
      header: t("messageLabel"),
      render: (row: FinanceAuditLog) => row.message || "-",
    },
    {
      key: "actor",
      header: t("actorLabel"),
      render: (row: FinanceAuditLog) => row.actor ?? "-",
    },
    {
      key: "club",
      header: t("clubLabel"),
      render: (row: FinanceAuditLog) =>
        row.club ? clubNameById[row.club] ?? String(row.club) : "-",
    },
    {
      key: "order",
      header: t("orderLabel"),
      render: (row: FinanceAuditLog) => row.order ?? "-",
    },
  ];

  return (
    <LtfFinanceLayout title={t("auditLogTitle")} subtitle={t("auditLogSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          search={
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchAuditLogPlaceholder")}
              aria-label={t("searchAuditLogPlaceholder")}
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
      ) : logs.length === 0 ? (
        <EmptyState title={t("noAuditLogTitle")} description={t("noAuditLogSubtitle")} />
      ) : (
        <EntityTable columns={columns} rows={logs} />
      )}
    </LtfFinanceLayout>
  );
}
