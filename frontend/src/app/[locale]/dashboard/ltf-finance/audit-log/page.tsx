"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  FinanceAuditLog,
  getFinanceAuditLogsList,
  getFinanceAuditLogsPage,
} from "@/lib/ltf-finance-api";

export default function LtfFinanceAuditLogPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const [logs, setLogs] = useState<FinanceAuditLog[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestAbortRef = useRef<AbortController | null>(null);

  const pageSizeOptions = ["10", "25", "50", "100", "150", "200", "all"];

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
            pageSize: Number(pageSize),
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

  const resolvedPageSize =
    pageSize === "all" ? Math.max(totalCount, 1) : Number(pageSize);
  const totalPages =
    pageSize === "all"
      ? 1
      : Math.max(1, Math.ceil(totalCount / resolvedPageSize));

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
    { key: "action", header: t("actionLabel") },
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
      render: (row: FinanceAuditLog) => row.club ?? "-",
    },
    {
      key: "order",
      header: t("orderLabel"),
      render: (row: FinanceAuditLog) => row.order ?? "-",
    },
  ];

  return (
    <LtfFinanceLayout title={t("auditLogTitle")} subtitle={t("auditLogSubtitle")}>
      <section className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-full max-w-sm"
          placeholder={t("searchAuditLogPlaceholder")}
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
      ) : logs.length === 0 ? (
        <EmptyState title={t("noAuditLogTitle")} description={t("noAuditLogSubtitle")} />
      ) : (
        <>
          <EntityTable columns={columns} rows={logs} />
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
    </LtfFinanceLayout>
  );
}
