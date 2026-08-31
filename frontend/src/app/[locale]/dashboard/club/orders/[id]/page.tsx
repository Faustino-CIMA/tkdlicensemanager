"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Member, getMembers } from "@/lib/club-admin-api";
import { formatDisplayDateTime } from "@/lib/date-display";
import { FinanceOrder, getClubOrder } from "@/lib/club-finance-api";
import { orderItemMemberDisplay } from "@/lib/ltf-finance-api";

type OrderItemRow = {
  id: number;
  memberName: string;
  ltfLicenseId: string;
  year: number;
  quantity: number;
};

export default function ClubOrderDetailPage() {
  const t = useTranslations("ClubAdmin");
  const locale = useLocale();
  const params = useParams();
  const [order, setOrder] = useState<FinanceOrder | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const orderId = useMemo(() => {
    const rawId = params?.id;
    if (Array.isArray(rawId)) {
      return Number(rawId[0]);
    }
    return Number(rawId);
  }, [params]);

  useEffect(() => {
    if (!orderId || Number.isNaN(orderId)) {
      setErrorMessage(t("ordersLoadError"));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    Promise.all([getClubOrder(orderId), getMembers()])
      .then(([orderResponse, membersResponse]) => {
        setOrder(orderResponse);
        setMembers(membersResponse);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : t("ordersLoadError"));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [orderId, t]);

  const statusMeta = useMemo(() => {
    const status = order?.status ?? "";
    switch (status) {
      case "draft":
      case "pending":
        return { label: t("orderStatusPlaced"), tone: "info" as const };
      case "paid":
        return { label: t("orderStatusDelivered"), tone: "success" as const };
      case "cancelled":
      case "refunded":
        return { label: t("orderStatusCancelled"), tone: "danger" as const };
      default:
        return { label: status || "-", tone: "neutral" as const };
    }
  }, [order?.status, t]);

  const items = useMemo<OrderItemRow[]>(() => {
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

  if (isLoading) {
    return (
      <ClubAdminLayout title={t("orderDetailTitle")} subtitle={t("orderDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </ClubAdminLayout>
    );
  }

  if (errorMessage || !order) {
    return (
      <ClubAdminLayout title={t("orderDetailTitle")} subtitle={t("orderDetailSubtitle")}>
        <EmptyState title={t("ordersLoadError")} description={errorMessage ?? ""} />
      </ClubAdminLayout>
    );
  }

  return (
    <ClubAdminLayout title={t("orderDetailTitle")} subtitle={t("orderDetailSubtitle")}>
      <div className="mb-6">
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard/club/orders`}>{t("backToOrders")}</Link>
        </Button>
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-4 text-sm text-foreground md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("orderNumberLabel")}</span>
            <span className="font-medium">{order.order_number}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("statusLabel")}</span>
            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("totalLabel")}</span>
            <span className="font-medium">{order.total} {order.currency}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("createdAtLabel")}</span>
            <span className="font-medium">{formatDisplayDateTime(order.created_at)}</span>
          </div>
          {order.invoice ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{t("invoiceNumberLabel")}</span>
              <span className="font-medium">{order.invoice.invoice_number}</span>
            </div>
          ) : null}
        </div>
        {order.invoice ? (
          <div className="mt-4">
            <Button asChild>
              <Link href={`/${locale}/dashboard/club/invoices/${order.invoice.id}`}>
                {t("openInvoiceAction")}
              </Link>
            </Button>
          </div>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t("orderItemsTitle")}</h2>
        <EntityTable columns={columns} rows={items} />
      </section>
    </ClubAdminLayout>
  );
}
