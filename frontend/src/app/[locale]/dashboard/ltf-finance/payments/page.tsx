"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
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
import { FinanceInvoice, confirmOrderPayment, getFinanceInvoices } from "@/lib/ltf-finance-api";
import { openInvoicePdf } from "@/lib/invoice-pdf";

export default function LtfFinancePaymentsPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [statusFilter, setStatusFilter] = useState("all");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeInvoiceId, setActiveInvoiceId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];
  const statusOptions = ["all", "draft", "issued", "paid", "void"];

  const loadInvoices = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await getFinanceInvoices();
      setInvoices(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("paymentsLoadError"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  const filteredInvoices = useMemo(() => {
    if (statusFilter === "all") {
      return invoices;
    }
    return invoices.filter((invoice) => invoice.status === statusFilter);
  }, [invoices, statusFilter]);

  const searchedInvoices = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return filteredInvoices;
    }
    return filteredInvoices.filter((invoice) => {
      const numberText = invoice.invoice_number.toLowerCase();
      const statusText = invoice.status.toLowerCase();
      const clubText = String(invoice.club);
      const memberText = invoice.member ? String(invoice.member) : "";
      const totalText = `${invoice.total} ${invoice.currency}`.toLowerCase();
      return (
        numberText.includes(normalizedQuery) ||
        statusText.includes(normalizedQuery) ||
        clubText.includes(normalizedQuery) ||
        memberText.includes(normalizedQuery) ||
        totalText.includes(normalizedQuery)
      );
    });
  }, [filteredInvoices, searchQuery]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedInvoices.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedInvoices.length / resolvedPageSize));
  const pagedInvoices = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedInvoices.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedInvoices, resolvedPageSize]);

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

  const handleRecordPayment = async (invoice: FinanceInvoice) => {
    if (!invoice.order) {
      setActionError(common("paymentMissingOrder"));
      return;
    }
    setActionError(null);
    setActiveInvoiceId(invoice.id);
    try {
      await confirmOrderPayment(invoice.order);
      await loadInvoices();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : common("paymentFailed")
      );
    } finally {
      setActiveInvoiceId(null);
    }
  };

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
    { key: "club", header: t("clubLabel") },
    {
      key: "member",
      header: t("memberLabel"),
      render: (row: FinanceInvoice) => row.member ?? "-",
    },
    {
      key: "total",
      header: t("totalLabel"),
      render: (row: FinanceInvoice) => `${row.total} ${row.currency}`,
    },
    {
      key: "paid_at",
      header: t("paidAtLabel"),
      render: (row: FinanceInvoice) =>
        row.paid_at ? new Date(row.paid_at).toLocaleDateString() : "-",
    },
    {
      key: "pdf",
      header: common("invoicePdfLabel"),
      render: (row: FinanceInvoice) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            setActionError(null);
            try {
              await openInvoicePdf(row.id);
            } catch (error) {
              setActionError(
                error instanceof Error ? error.message : common("pdfDownloadFailed")
              );
            }
          }}
        >
          {common("invoicePdfLabel")}
        </Button>
      ),
    },
    {
      key: "actions",
      header: common("paymentActionsLabel"),
      render: (row: FinanceInvoice) => {
        const canRecord = row.status !== "paid" && row.status !== "void";
        return canRecord ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRecordPayment(row)}
            disabled={activeInvoiceId === row.id}
          >
            {activeInvoiceId === row.id
              ? common("paymentProcessing")
              : t("recordPaymentButton")}
          </Button>
        ) : (
          <span className="text-xs text-zinc-500">{common("paymentNotAvailable")}</span>
        );
      },
    },
  ];

  return (
    <LtfFinanceLayout title={t("paymentsTitle")} subtitle={t("paymentsSubtitle")}>
      <section className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-full max-w-sm"
          placeholder={t("searchPaymentsPlaceholder")}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t("statusFilterLabel")} />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? t("statusFilterAll") : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <EmptyState title={t("noPaymentsTitle")} description={t("noPaymentsSubtitle")} />
      ) : (
        <>
          <EntityTable columns={columns} rows={pagedInvoices} />
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
    </LtfFinanceLayout>
  );
}
