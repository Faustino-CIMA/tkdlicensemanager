"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Input } from "@/components/ui/input";
import {
  LIST_PAGE_SIZE_CAP,
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  PageSizeSelect,
  resolveListPageSize,
  ActionNotices,
} from "@/components/ui/list-page-chrome";
import { auditActionLabel } from "@/lib/audit-log";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  FinanceAuditLog,
  getFinanceAuditLogsList,
  getFinanceAuditLogsPage,
} from "@/lib/ltf-finance-api";

export default function LtfFinanceAuditLogPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [logs, setLogs] = useState<FinanceAuditLog[]>([]);
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
        const response = await getFinanceAuditLogsList(
          { q: normalizedSearch },
          { signal: controller.signal }
        );
        if (requestAbortRef.current !== controller) {
          return;
        }
        setLogs(response);
        setTotalCount(response.length);
      } else {
        const response = await getFinanceAuditLogsPage(
          {
            page: currentPage,
            pageSize: resolveListPageSize(pageSize, LIST_PAGE_SIZE_CAP),
            q: normalizedSearch,
          },
          { signal: controller.signal }
        );
        if (requestAbortRef.current !== controller) {
          return;
        }
        setLogs(response.results);
        setTotalCount(response.count);
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
      render: (row: FinanceAuditLog) => auditActionLabel(row.action, t),
    },
    {
      key: "message",
      header: t("messageLabel"),
      render: (row: FinanceAuditLog) => row.message || "-",
    },
  ];

  return (
    <LtfFinanceLayout title={t("auditLogTitle")} subtitle={t("auditLogSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

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
        <EntityTable
          columns={columns}
          rows={logs}
          onRowClick={(row) => router.push(`/${locale}/dashboard/ltf-finance/audit-log/${row.id}`)}
        />
      )}
    </LtfFinanceLayout>
  );
}
