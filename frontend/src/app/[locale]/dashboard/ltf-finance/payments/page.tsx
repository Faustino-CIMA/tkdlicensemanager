"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
  confirmOrderPayment,
  getFinanceClubs,
  getFinanceInvoices,
  getFinanceOrders,
} from "@/lib/ltf-finance-api";
import { openInvoicePdf } from "@/lib/invoice-pdf";

export default function LtfFinancePaymentsPage() {
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeInvoiceId, setActiveInvoiceId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [recordInvoice, setRecordInvoice] = useState<FinanceInvoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("offline");
  const [paymentProvider, setPaymentProvider] = useState("manual");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState("");

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];
  const statusOptions = ["all", "draft", "issued", "paid", "void"];
  const paymentMethodOptions = [
    { value: "card", label: t("paymentMethodCard") },
    { value: "bank_transfer", label: t("paymentMethodBankTransfer") },
    { value: "cash", label: t("paymentMethodCash") },
    { value: "offline", label: t("paymentMethodOffline") },
    { value: "other", label: t("paymentMethodOther") },
  ];
  const paymentProviderOptions = [
    { value: "stripe", label: t("paymentProviderStripe") },
    { value: "payconiq", label: t("paymentProviderPayconiq") },
    { value: "paypal", label: t("paymentProviderPaypal") },
    { value: "manual", label: t("paymentProviderManual") },
    { value: "other", label: t("paymentProviderOther") },
  ];

  const loadInvoices = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [invoiceResponse, ordersResponse, clubsResponse] = await Promise.all([
        getFinanceInvoices(),
        getFinanceOrders(),
        getFinanceClubs(),
      ]);
      setInvoices(invoiceResponse);
      setOrders(ordersResponse);
      setClubs(clubsResponse);
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
      return filteredInvoices;
    }
    return filteredInvoices.filter((invoice) => {
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
  }, [filteredInvoices, searchQuery, clubNameById, orderQuantityById]);

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

  const openRecordModal = (invoice: FinanceInvoice) => {
    setActionError(null);
    setRecordInvoice(invoice);
    setPaymentMethod("offline");
    setPaymentProvider("manual");
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentDate("");
    setIsRecordModalOpen(true);
  };

  const handleRecordPayment = async () => {
    if (!recordInvoice) {
      return;
    }
    if (!recordInvoice.order) {
      setActionError(common("paymentMissingOrder"));
      return;
    }
    setActionError(null);
    setActiveInvoiceId(recordInvoice.id);
    try {
      await confirmOrderPayment(recordInvoice.order, {
        payment_method: paymentMethod,
        payment_provider: paymentProvider,
        payment_reference: paymentReference || undefined,
        payment_notes: paymentNotes || undefined,
        paid_at: paymentDate ? new Date(paymentDate).toISOString() : undefined,
      });
      await loadInvoices();
      setIsRecordModalOpen(false);
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
      key: "paid_at",
      header: t("paidAtLabel"),
      render: (row: FinanceInvoice) =>
        row.paid_at ? new Date(row.paid_at).toLocaleString() : "-",
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
            onClick={() => openRecordModal(row)}
            disabled={activeInvoiceId === row.id}
          >
            {activeInvoiceId === row.id
              ? common("paymentProcessing")
              : t("recordPaymentButton")}
          </Button>
        ) : null;
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
          <EntityTable
            columns={columns}
            rows={pagedInvoices}
            onRowClick={(row) => router.push(`/${locale}/dashboard/ltf-finance/payments/${row.id}`)}
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

      <Modal
        title={t("recordPaymentTitle")}
        description={t("recordPaymentSubtitle")}
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("paymentMethodLabel")}
            </label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentMethodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("paymentProviderLabel")}
            </label>
            <Select value={paymentProvider} onValueChange={setPaymentProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentProviderOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("paymentReferenceLabel")}
            </label>
            <Input
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              placeholder={t("paymentReferencePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("paymentNotesLabel")}
            </label>
            <Input
              value={paymentNotes}
              onChange={(event) => setPaymentNotes(event.target.value)}
              placeholder={t("paymentNotesPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("paymentDateLabel")}
            </label>
            <Input
              type="datetime-local"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleRecordPayment} disabled={activeInvoiceId !== null}>
              {activeInvoiceId ? common("paymentProcessing") : t("recordPaymentButton")}
            </Button>
            <Button variant="outline" onClick={() => setIsRecordModalOpen(false)}>
              {t("paymentCancelButton")}
            </Button>
          </div>
        </div>
      </Modal>
    </LtfFinanceLayout>
  );
}
