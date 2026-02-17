"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  FinanceInvoice,
  FinanceOrder,
  Payment,
  getFinanceInvoice,
  getFinanceOrder,
  getFinancePayments,
} from "@/lib/ltf-finance-api";

type PaymentRow = {
  id: number;
  methodLabel: string;
  providerLabel: string;
  reference: string;
  cardLabel: string;
  amount: string;
  paidAt: string;
  recordedBy: string;
  notes: string;
};

export default function LtfFinancePaymentDetailPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const params = useParams();
  const [invoice, setInvoice] = useState<FinanceInvoice | null>(null);
  const [order, setOrder] = useState<FinanceOrder | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const invoiceId = useMemo(() => {
    const rawId = params?.id;
    if (Array.isArray(rawId)) {
      return Number(rawId[0]);
    }
    return Number(rawId);
  }, [params]);

  useEffect(() => {
    if (!invoiceId || Number.isNaN(invoiceId)) {
      setErrorMessage(t("paymentsLoadError"));
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const invoiceResponse = await getFinanceInvoice(invoiceId);
        if (!isMounted) {
          return;
        }
        setInvoice(invoiceResponse);
        const [paymentsResponse, orderResponse] = await Promise.all([
          getFinancePayments({ invoiceId }),
          invoiceResponse.order ? getFinanceOrder(invoiceResponse.order) : Promise.resolve(null),
        ]);
        if (!isMounted) {
          return;
        }
        setPayments(paymentsResponse);
        setOrder(orderResponse);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : t("paymentsLoadError"));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, [invoiceId, t]);

  const statusMeta = useMemo(() => {
    const status = invoice?.status ?? "";
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
        return { label: status || "-", tone: "neutral" as const };
    }
  }, [invoice?.status, common]);

  const paymentRows = useMemo<PaymentRow[]>(() => {
    const methodLabels: Record<string, string> = {
      card: t("paymentMethodCard"),
      bank_transfer: t("paymentMethodBankTransfer"),
      cash: t("paymentMethodCash"),
      offline: t("paymentMethodOffline"),
      other: t("paymentMethodOther"),
    };
    const providerLabels: Record<string, string> = {
      stripe: t("paymentProviderStripe"),
      payconiq: t("paymentProviderPayconiq"),
      paypal: t("paymentProviderPaypal"),
      manual: t("paymentProviderManual"),
      other: t("paymentProviderOther"),
    };
    return payments.map((payment) => ({
      id: payment.id,
      methodLabel: methodLabels[payment.method] ?? payment.method,
      providerLabel: providerLabels[payment.provider] ?? payment.provider,
      reference: payment.reference || "-",
      cardLabel:
        payment.card_brand && payment.card_last4
          ? `${payment.card_brand.toUpperCase()} •••• ${payment.card_last4}`
          : "-",
      amount: `${payment.amount} ${payment.currency}`,
      paidAt: formatDisplayDateTime(payment.paid_at),
      recordedBy: payment.created_by ? String(payment.created_by) : "-",
      notes: payment.notes || "-",
    }));
  }, [payments, t]);

  const columns = [
    { key: "methodLabel", header: t("paymentMethodLabel") },
    { key: "providerLabel", header: t("paymentProviderLabel") },
    { key: "reference", header: t("paymentReferenceLabel") },
    { key: "cardLabel", header: t("paymentCardLabel") },
    { key: "amount", header: t("paymentAmountLabel") },
    { key: "paidAt", header: t("paidAtLabel") },
    { key: "recordedBy", header: t("paymentRecordedByLabel") },
    { key: "notes", header: t("paymentNotesLabel") },
  ];

  if (isLoading) {
    return (
      <LtfFinanceLayout title={t("paymentDetailTitle")} subtitle={t("paymentDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </LtfFinanceLayout>
    );
  }

  if (errorMessage || !invoice) {
    return (
      <LtfFinanceLayout title={t("paymentDetailTitle")} subtitle={t("paymentDetailSubtitle")}>
        <EmptyState title={t("paymentsLoadError")} description={errorMessage ?? ""} />
      </LtfFinanceLayout>
    );
  }

  return (
    <LtfFinanceLayout title={t("paymentDetailTitle")} subtitle={t("paymentDetailSubtitle")}>
      <div className="mb-6">
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard/ltf-finance/payments`}>{t("backToPayments")}</Link>
        </Button>
      </div>

      <section className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div className="grid gap-4 text-sm text-zinc-700 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("invoiceNumberLabel")}</span>
            <span className="font-medium">{invoice.invoice_number}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("statusLabel")}</span>
            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("orderNumberLabel")}</span>
            <span className="font-medium">{order?.order_number ?? "-"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("totalLabel")}</span>
            <span className="font-medium">
              {invoice.total} {invoice.currency}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("paidAtLabel")}</span>
            <span className="font-medium">
              {formatDisplayDateTime(invoice.paid_at)}
            </span>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          {t("paymentHistoryTitle")}
        </h2>
        {paymentRows.length === 0 ? (
          <EmptyState
            title={t("paymentHistoryEmptyTitle")}
            description={t("paymentHistoryEmptySubtitle")}
          />
        ) : (
          <EntityTable columns={columns} rows={paymentRows} />
        )}
      </section>
    </LtfFinanceLayout>
  );
}
