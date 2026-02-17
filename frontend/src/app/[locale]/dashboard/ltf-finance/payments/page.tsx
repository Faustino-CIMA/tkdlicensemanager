"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
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

const AUTO_REFRESH_INTERVAL_MS = 10000;

function getGroupYear(value: string | null, fallback: string | null, createdAt: string) {
  const candidate = value ?? fallback ?? createdAt;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getFullYear();
}

function getYearKey(clubId: number, year: number) {
  return `${clubId}:${year}`;
}

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
  const [expandedClubIds, setExpandedClubIds] = useState<number[]>([]);
  const [expandedYearKeys, setExpandedYearKeys] = useState<string[]>([]);
  const [expandedStateHydrated, setExpandedStateHydrated] = useState(false);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];
  const expandedClubStorageKey = "ltf_finance_payments_expanded_clubs";
  const expandedYearStorageKey = "ltf_finance_payments_expanded_years";
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

  const loadInvoices = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoading(true);
      setErrorMessage(null);
    }
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
      if (!silent) {
        setErrorMessage(error instanceof Error ? error.message : t("paymentsLoadError"));
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") {
        void loadInvoices({ silent: true });
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

  const getInvoiceQuantity = useCallback((invoice: FinanceInvoice) => {
    if (!invoice.order) {
      return "-";
    }
    return orderQuantityById[invoice.order] ?? 0;
  }, [orderQuantityById]);

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
  }, [filteredInvoices, searchQuery, clubNameById, getInvoiceQuantity]);

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

  const groupedClubRows = useMemo(() => {
    const grouped = new Map<
      number,
      {
        clubName: string;
        yearsMap: Map<number, FinanceInvoice[]>;
      }
    >();

    for (const invoice of searchedInvoices) {
      const year = getGroupYear(invoice.paid_at, invoice.issued_at, invoice.created_at);
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
              const leftTimestamp = left.paid_at ?? left.issued_at ?? left.created_at;
              const rightTimestamp = right.paid_at ?? right.issued_at ?? right.created_at;
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

  const resolvedPageSize =
    pageSize === "all" ? Math.max(groupedClubRows.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(groupedClubRows.length / resolvedPageSize));
  const pagedClubRows = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return groupedClubRows.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, groupedClubRows, resolvedPageSize]);

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
      ) : groupedClubRows.length === 0 ? (
        <EmptyState title={t("noPaymentsTitle")} description={t("noPaymentsSubtitle")} />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border border-zinc-100 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="w-10 px-4 py-3 font-medium" />
                  <th className="px-4 py-3 font-medium">{t("clubLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("totalLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("invoicesDraftCountLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("invoicesIssuedCountLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("invoicesPaidCountLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("invoicesVoidCountLabel")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {pagedClubRows.map((clubGroup) => {
                  const clubExpanded = expandedClubSet.has(clubGroup.clubId);
                  return (
                    <Fragment key={clubGroup.clubId}>
                      <tr
                        className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
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
                        <td className="px-4 py-3 text-zinc-500">
                          {clubExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">{clubGroup.clubName}</td>
                        <td className="px-4 py-3">{clubGroup.total}</td>
                        <td className="px-4 py-3">{clubGroup.draftCount}</td>
                        <td className="px-4 py-3">{clubGroup.issuedCount}</td>
                        <td className="px-4 py-3">{clubGroup.paidCount}</td>
                        <td className="px-4 py-3">{clubGroup.voidCount}</td>
                      </tr>
                      {clubExpanded ? (
                        <tr className="bg-zinc-50/60">
                          <td colSpan={7} className="px-6 py-3">
                            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
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
                                <tbody className="divide-y divide-zinc-100">
                                  {clubGroup.years.map((yearGroup) => {
                                    const yearKey = getYearKey(clubGroup.clubId, yearGroup.year);
                                    const yearExpanded = expandedYearSet.has(yearKey);
                                    return (
                                      <Fragment key={yearKey}>
                                        <tr
                                          className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
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
                                          <td className="px-4 py-2 text-zinc-500">
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
                                          <tr className="bg-zinc-50/50">
                                            <td colSpan={7} className="px-6 py-3">
                                              <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
                                                <table className="min-w-full text-left text-sm">
                                                  <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                                                    <tr>
                                                      <th className="px-4 py-2 font-medium">{t("invoiceNumberLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("statusLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{common("qtyLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("totalLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("paidAtLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{common("invoicePdfLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{common("paymentActionsLabel")}</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-zinc-100">
                                                    {yearGroup.invoices.map((invoice) => {
                                                      const meta = getInvoiceStatusMeta(invoice.status);
                                                      const canRecord =
                                                        invoice.status !== "paid" && invoice.status !== "void";
                                                      return (
                                                        <tr
                                                          key={invoice.id}
                                                          className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
                                                          onClick={() => {
                                                            router.push(
                                                              `/${locale}/dashboard/ltf-finance/payments/${invoice.id}`
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
                                                            {invoice.paid_at
                                                              ? new Date(invoice.paid_at).toLocaleString()
                                                              : "-"}
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
                                                          <td className="px-4 py-2">
                                                            {canRecord ? (
                                                              <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={(event) => {
                                                                  event.stopPropagation();
                                                                  openRecordModal(invoice);
                                                                }}
                                                                disabled={activeInvoiceId === invoice.id}
                                                              >
                                                                {activeInvoiceId === invoice.id
                                                                  ? common("paymentProcessing")
                                                                  : t("recordPaymentButton")}
                                                              </Button>
                                                            ) : null}
                                                          </td>
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                        ) : null}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
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
        </div>
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
