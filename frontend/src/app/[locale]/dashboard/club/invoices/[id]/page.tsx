"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Check, Copy } from "lucide-react";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { PayconiqPaymentCard } from "@/components/club-admin/payconiq-payment-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Member, getMembers } from "@/lib/club-admin-api";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  FinanceInvoice,
  FinanceOrder,
  PayconiqPayment,
  createClubCheckoutSession,
  createPayconiqPayment,
  getClubInvoice,
  getClubOrder,
  getPayconiqPaymentStatus,
} from "@/lib/club-finance-api";
import { orderItemMemberDisplay } from "@/lib/ltf-finance-api";

type InvoiceItemRow = {
  id: number;
  memberName: string;
  ltfLicenseId: string;
  year: number;
  quantity: number;
};

export default function ClubInvoiceDetailPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const params = useParams();
  const [invoice, setInvoice] = useState<FinanceInvoice | null>(null);
  const [order, setOrder] = useState<FinanceOrder | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [payconiqPayment, setPayconiqPayment] = useState<PayconiqPayment | null>(null);
  const [payconiqError, setPayconiqError] = useState<string | null>(null);
  const [isPayconiqBusy, setIsPayconiqBusy] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [invoiceNumberCopied, setInvoiceNumberCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invoiceId = useMemo(() => {
    const rawId = params?.id;
    if (Array.isArray(rawId)) {
      return Number(rawId[0]);
    }
    return Number(rawId);
  }, [params]);

  useEffect(() => {
    if (!invoiceId || Number.isNaN(invoiceId)) {
      setErrorMessage(t("invoicesLoadError"));
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const invoiceResponse = await getClubInvoice(invoiceId);
        if (!isMounted) {
          return;
        }
        setInvoice(invoiceResponse);
        if (invoiceResponse.order) {
          const [orderResponse, membersResponse] = await Promise.all([
            getClubOrder(invoiceResponse.order),
            getMembers(),
          ]);
          if (!isMounted) {
            return;
          }
          setOrder(orderResponse);
          setMembers(membersResponse);
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : t("invoicesLoadError"));
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

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const statusMeta = useMemo(() => {
    const status = invoice?.status ?? "";
    switch (status) {
      case "draft":
        return { label: t("invoiceStatusDraft"), tone: "neutral" as const };
      case "issued":
        return { label: t("invoiceStatusDue"), tone: "warning" as const };
      case "paid":
        return { label: t("invoiceStatusPaid"), tone: "success" as const };
      case "void":
        return { label: t("invoiceStatusVoid"), tone: "danger" as const };
      default:
        return { label: status || "-", tone: "neutral" as const };
    }
  }, [invoice?.status, t]);

  const items = useMemo<InvoiceItemRow[]>(() => {
    if (!order) {
      return [];
    }
    const membersById = Object.fromEntries(members.map((member) => [member.id, member]));
    return (order.items ?? []).map((item) => {
      const display = orderItemMemberDisplay(item, membersById, t("unknownMember"));
      return {
        id: item.id,
        memberName: display.name,
        ltfLicenseId: display.ltfLicenseId,
        year: item.license.year,
        quantity: item.quantity,
      };
    });
  }, [order, members, t]);

  const columns = [
    { key: "memberName", header: t("memberLabel") },
    { key: "ltfLicenseId", header: t("ltfLicenseTableLabel") },
    { key: "year", header: t("yearLabel") },
    { key: "quantity", header: t("qtyLabel") },
  ];

  const isPayable = invoice ? ["draft", "issued"].includes(invoice.status) : false;
  const linkedOrderId = invoice?.order ?? order?.id ?? null;

  const handleCopyInvoiceNumber = async () => {
    if (!invoice?.invoice_number) {
      return;
    }
    try {
      await navigator.clipboard.writeText(invoice.invoice_number);
      setInvoiceNumberCopied(true);
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setInvoiceNumberCopied(false);
        copyResetTimeoutRef.current = null;
      }, 1600);
    } catch {
      setInvoiceNumberCopied(false);
    }
  };

  const handlePayNow = async () => {
    if (!linkedOrderId) {
      setPaymentError(common("paymentMissingOrder"));
      return;
    }
    setPaymentError(null);
    setIsPaying(true);
    try {
      const response = await createClubCheckoutSession(linkedOrderId);
      if (response.url) {
        window.location.href = response.url;
        return;
      }
      setPaymentError(common("paymentFailed"));
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : common("paymentFailed"));
    } finally {
      setIsPaying(false);
    }
  };

  const handleCreatePayconiqPayment = async () => {
    if (!invoice) {
      return;
    }
    setIsPayconiqBusy(true);
    setPayconiqError(null);
    try {
      const payment = await createPayconiqPayment(invoice.id);
      setPayconiqPayment(payment);
    } catch (error) {
      setPayconiqError(error instanceof Error ? error.message : t("payconiqError"));
    } finally {
      setIsPayconiqBusy(false);
    }
  };

  const handleRefreshPayconiqPayment = async () => {
    if (!payconiqPayment) {
      return;
    }
    setIsPayconiqBusy(true);
    setPayconiqError(null);
    try {
      const payment = await getPayconiqPaymentStatus(payconiqPayment.id);
      setPayconiqPayment(payment);
    } catch (error) {
      setPayconiqError(error instanceof Error ? error.message : t("payconiqError"));
    } finally {
      setIsPayconiqBusy(false);
    }
  };

  if (isLoading) {
    return (
      <ClubAdminLayout title={t("invoiceDetailTitle")} subtitle={t("invoiceDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </ClubAdminLayout>
    );
  }

  if (errorMessage || !invoice) {
    return (
      <ClubAdminLayout title={t("invoiceDetailTitle")} subtitle={t("invoiceDetailSubtitle")}>
        <EmptyState title={t("invoicesLoadError")} description={errorMessage ?? ""} />
      </ClubAdminLayout>
    );
  }

  return (
    <ClubAdminLayout title={t("invoiceDetailTitle")} subtitle={t("invoiceDetailSubtitle")}>
      <div className="mb-6">
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard/club/invoices`}>{t("backToInvoices")}</Link>
        </Button>
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-4 text-sm text-foreground md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("invoiceNumberLabel")}</span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{invoice.invoice_number}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted hover:text-foreground"
                onClick={() => void handleCopyInvoiceNumber()}
                aria-label={t("copyInvoiceNumberAction")}
                title={invoiceNumberCopied ? t("invoiceNumberCopied") : t("copyInvoiceNumberAction")}
              >
                {invoiceNumberCopied ? <Check /> : <Copy />}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("statusLabel")}</span>
            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("orderNumberLabel")}</span>
            <span className="font-medium">{order?.order_number ?? "-"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("totalLabel")}</span>
            <span className="font-medium">
              {invoice.total} {invoice.currency}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("issuedAtLabel")}</span>
            <span className="font-medium">{formatDisplayDateTime(invoice.issued_at)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("paidAtLabel")}</span>
            <span className="font-medium">{formatDisplayDateTime(invoice.paid_at)}</span>
          </div>
        </div>
        {paymentError ? <p className="mt-4 text-sm text-destructive">{paymentError}</p> : null}
        {order || isPayable ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {isPayable ? (
              <Button type="button" onClick={() => void handlePayNow()} disabled={isPaying}>
                {isPaying ? common("paymentProcessing") : common("payNow")}
              </Button>
            ) : null}
            {order ? (
              <Button asChild variant="outline">
                <Link href={`/${locale}/dashboard/club/orders/${order.id}`}>{t("openOrderAction")}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t("invoiceItemsTitle")}</h2>
        <EntityTable columns={columns} rows={items} />
      </section>

      <PayconiqPaymentCard
        payment={payconiqPayment}
        errorMessage={payconiqError}
        isBusy={isPayconiqBusy}
        onCreate={handleCreatePayconiqPayment}
        onRefresh={handleRefreshPayconiqPayment}
      />
    </ClubAdminLayout>
  );
}
