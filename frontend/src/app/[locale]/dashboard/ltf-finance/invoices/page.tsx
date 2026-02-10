"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { SummaryCard } from "@/components/club-admin/summary-card";
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
  Club,
  FinanceInvoice,
  FinanceOrder,
  getFinanceClubs,
  getFinanceInvoices,
  getFinanceOrders,
} from "@/lib/ltf-finance-api";
import { openInvoicePdf } from "@/lib/invoice-pdf";

export default function LtfFinanceInvoicesPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];

  const loadInvoices = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [invoiceResponse, orderResponse, clubResponse] = await Promise.all([
        getFinanceInvoices(),
        getFinanceOrders(),
        getFinanceClubs(),
      ]);
      setInvoices(invoiceResponse);
      setOrders(orderResponse);
      setClubs(clubResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("invoicesLoadError"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  const clubNameById = useMemo(() => {
    return clubs.reduce<Record<number, string>>((acc, club) => {
      acc[club.id] = club.name;
      return acc;
    }, {});
  }, [clubs]);

  const orderQuantityById = useMemo(() => {
    return orders.reduce<Record<number, number>>((acc, order) => {
      acc[order.id] = order.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      return acc;
    }, {});
  }, [orders]);

  const getInvoiceQuantity = (invoice: FinanceInvoice) => {
    if (!invoice.order) {
      return "-";
    }
    return orderQuantityById[invoice.order] ?? 0;
  };

  const searchedInvoices = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return invoices;
    }
    return invoices.filter((invoice) => {
      const numberText = invoice.invoice_number.toLowerCase();
      const statusText = invoice.status.toLowerCase();
      const clubText = (clubNameById[invoice.club] ?? String(invoice.club)).toLowerCase();
      const qtyText = String(getInvoiceQuantity(invoice));
      const totalText = `${invoice.total} ${invoice.currency}`.toLowerCase();
      return (
        numberText.includes(normalizedQuery) ||
        statusText.includes(normalizedQuery) ||
        clubText.includes(normalizedQuery) ||
        qtyText.includes(normalizedQuery) ||
        totalText.includes(normalizedQuery)
      );
    });
  }, [invoices, searchQuery, clubNameById, orderQuantityById]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedInvoices.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedInvoices.length / resolvedPageSize));
  const pagedInvoices = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedInvoices.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedInvoices, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const invoiceCounts = useMemo(() => {
    return invoices.reduce<Record<string, number>>((acc, invoice) => {
      acc[invoice.status] = (acc[invoice.status] || 0) + 1;
      return acc;
    }, {});
  }, [invoices]);

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
      key: "club",
      header: t("clubLabel"),
      render: (row: FinanceInvoice) => clubNameById[row.club] ?? String(row.club),
    },
    {
      key: "quantity",
      header: common("qtyLabel"),
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
      render: (row: FinanceInvoice) =>
        row.issued_at ? new Date(row.issued_at).toLocaleString() : "-",
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
  ];

  return (
    <LtfFinanceLayout title={t("invoicesTitle")} subtitle={t("invoicesSubtitle")}>
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t("invoicesDraftCountLabel")}
          value={String(invoiceCounts.draft ?? 0)}
        />
        <SummaryCard
          title={t("invoicesIssuedCountLabel")}
          value={String(invoiceCounts.issued ?? 0)}
        />
        <SummaryCard
          title={t("invoicesPaidCountLabel")}
          value={String(invoiceCounts.paid ?? 0)}
        />
        <SummaryCard
          title={t("invoicesVoidCountLabel")}
          value={String(invoiceCounts.void ?? 0)}
        />
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-full max-w-sm"
          placeholder={t("searchInvoicesPlaceholder")}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
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
      ) : searchedInvoices.length === 0 ? (
        <EmptyState title={t("noInvoicesTitle")} description={t("noInvoicesSubtitle")} />
      ) : (
        <>
          <EntityTable
            columns={columns}
            rows={pagedInvoices}
            onRowClick={(row) => router.push(`/${locale}/dashboard/ltf-finance/invoices/${row.id}`)}
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
    </LtfFinanceLayout>
  );
}
