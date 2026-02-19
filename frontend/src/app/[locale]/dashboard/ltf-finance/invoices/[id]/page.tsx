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
  Member,
  getFinanceInvoice,
  getFinanceMembers,
  getFinanceOrder,
} from "@/lib/ltf-finance-api";

type InvoiceItemRow = {
  id: number;
  memberName: string;
  ltfLicenseId: string;
  year: number;
  quantity: number;
};

export default function LtfFinanceInvoiceDetailPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const params = useParams();
  const [invoice, setInvoice] = useState<FinanceInvoice | null>(null);
  const [order, setOrder] = useState<FinanceOrder | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
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
        const invoiceResponse = await getFinanceInvoice(invoiceId);
        if (!isMounted) {
          return;
        }
        setInvoice(invoiceResponse);
        if (invoiceResponse.order) {
          const [orderResponse, membersResponse] = await Promise.all([
            getFinanceOrder(invoiceResponse.order),
            getFinanceMembers(),
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

  const memberById = useMemo(() => {
    return members.reduce<Record<number, Member>>((acc, member) => {
      acc[member.id] = member;
      return acc;
    }, {});
  }, [members]);

  const items = useMemo<InvoiceItemRow[]>(() => {
    if (!order) {
      return [];
    }
    return (order.items ?? []).map((item) => ({
      id: item.id,
      memberName: item.license.member
        ? `${memberById[item.license.member]?.first_name ?? ""} ${
            memberById[item.license.member]?.last_name ?? ""
          }`.trim() || "-"
        : "-",
      ltfLicenseId:
        (item.license.member
          ? memberById[item.license.member]?.ltf_licenseid?.trim()
          : "") || "-",
      year: item.license.year,
      quantity: item.quantity,
    }));
  }, [order, memberById]);

  const totalQuantity = useMemo(() => {
    if (!order) {
      return 0;
    }
    return (order.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  }, [order]);

  const columns = [
    { key: "memberName", header: t("memberLabel") },
    { key: "ltfLicenseId", header: t("ltfLicenseLabel") },
    { key: "year", header: t("yearLabel") },
    { key: "quantity", header: common("qtyLabel") },
  ];

  if (isLoading) {
    return (
      <LtfFinanceLayout title={t("invoiceDetailTitle")} subtitle={t("invoiceDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </LtfFinanceLayout>
    );
  }

  if (errorMessage || !invoice) {
    return (
      <LtfFinanceLayout title={t("invoiceDetailTitle")} subtitle={t("invoiceDetailSubtitle")}>
        <EmptyState title={t("invoicesLoadError")} description={errorMessage ?? ""} />
      </LtfFinanceLayout>
    );
  }

  return (
    <LtfFinanceLayout title={t("invoiceDetailTitle")} subtitle={t("invoiceDetailSubtitle")}>
      <div className="mb-6">
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard/ltf-finance/invoices`}>{t("backToInvoices")}</Link>
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
            <span className="font-medium">
              {formatDisplayDateTime(invoice.issued_at)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("paidAtLabel")}</span>
            <span className="font-medium">
              {formatDisplayDateTime(invoice.paid_at)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("totalLicensesLabel")}</span>
            <span className="font-medium">{totalQuantity}</span>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">{t("invoiceItemsTitle")}</h2>
        <EntityTable columns={columns} rows={items} />
      </section>
    </LtfFinanceLayout>
  );
}
