"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

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
  createPayconiqPayment,
  getClubInvoice,
  getClubOrder,
  getPayconiqPaymentStatus,
} from "@/lib/club-finance-api";

type InvoiceItemRow = {
  id: number;
  memberName: string;
  ltfLicenseId: string;
  year: number;
  quantity: number;
};

export default function ClubInvoiceDetailPage() {
  const t = useTranslations("ClubAdmin");
  const locale = useLocale();
  const params = useParams();
  const [invoice, setInvoice] = useState<FinanceInvoice | null>(null);
  const [order, setOrder] = useState<FinanceOrder | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [payconiqPayment, setPayconiqPayment] = useState<PayconiqPayment | null>(null);
  const [payconiqError, setPayconiqError] = useState<string | null>(null);
  const [isPayconiqBusy, setIsPayconiqBusy] = useState(false);
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
    return (order.items ?? []).map((item) => {
      const member = members.find((record) => record.id === item.license.member);
      const memberName = member
        ? `${member.first_name} ${member.last_name}`
        : t("unknownMember");
      const ltfLicenseId = member?.ltf_licenseid?.trim() || "-";
      return {
        id: item.id,
        memberName,
        ltfLicenseId,
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
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
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
            <span className="text-xs text-zinc-500">{t("issuedAtLabel")}</span>
            <span className="font-medium">{formatDisplayDateTime(invoice.issued_at)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("paidAtLabel")}</span>
            <span className="font-medium">{formatDisplayDateTime(invoice.paid_at)}</span>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">{t("invoiceItemsTitle")}</h2>
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
