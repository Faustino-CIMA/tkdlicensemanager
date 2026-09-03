"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Button } from "@/components/ui/button";
import {
  FormPanel,
  ActionNotices
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  Club,
  FinanceOrder,
  Member,
  getFinanceClubs,
  getFinanceMembers,
  getFinanceOrder,
  orderItemMemberDisplay,
  orderItemsAreClubFees,
  orderItemYearLabel,
} from "@/lib/ltf-finance-api";

type OrderItemRow = {
  id: number;
  memberName: string;
  ltfLicenseId: string;
  year: string;
  quantity: number;
};

export default function LtfFinanceOrderDetailPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const params = useParams();
  const [order, setOrder] = useState<FinanceOrder | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
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
  const hasValidOrderId = Number.isFinite(orderId) && orderId > 0;

  useEffect(() => {
    if (!hasValidOrderId) {
      return;
    }
    Promise.all([getFinanceOrder(orderId), getFinanceClubs(), getFinanceMembers()])
      .then(([orderResponse, clubsResponse, membersResponse]) => {
        setErrorMessage(null);
        setOrder(orderResponse);
        setClubs(clubsResponse);
        setMembers(membersResponse);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : t("ordersLoadError"));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [hasValidOrderId, orderId, t]);

  const clubNameById = useMemo(() => {
    return clubs.reduce<Record<number, string>>((acc, club) => {
      acc[club.id] = club.name;
      return acc;
    }, {});
  }, [clubs]);

  const memberById = useMemo(() => {
    const map = members.reduce<Record<number, Member>>((acc, member) => {
      acc[member.id] = member;
      return acc;
    }, {});
    return map;
  }, [members]);

  const statusMeta = useMemo(() => {
    const status = order?.status ?? "";
    switch (status) {
      case "draft":
      case "pending":
        return { label: t("orderStatusReceived"), tone: "info" as const };
      case "paid":
        return { label: t("orderStatusDelivered"), tone: "success" as const };
      case "cancelled":
      case "refunded":
        return { label: t("orderStatusCancelled"), tone: "danger" as const };
      default:
        return { label: t("orderStatusReceived"), tone: "neutral" as const };
    }
  }, [order?.status, t]);

  const items = useMemo<OrderItemRow[]>(() => {
    if (!order) {
      return [];
    }
    return (order.items ?? []).map((item) => {
      const display = orderItemMemberDisplay(item, memberById, "-");
      return {
        id: item.id,
        memberName: display.name,
        ltfLicenseId: display.ltfLicenseId,
        year: orderItemYearLabel(item),
        quantity: item.quantity,
      };
    });
  }, [order, memberById]);

  const totalQuantity = useMemo(() => {
    if (!order) {
      return 0;
    }
    return (order.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  }, [order]);

  const feeOnly = orderItemsAreClubFees(order?.items);
  const columns = feeOnly
    ? [
        { key: "memberName", header: t("orderItemDescriptionLabel") },
        { key: "quantity", header: common("qtyLabel") },
      ]
    : [
        { key: "memberName", header: t("memberLabel") },
        { key: "ltfLicenseId", header: t("ltfLicenseLabel") },
        { key: "year", header: t("yearLabel") },
        { key: "quantity", header: common("qtyLabel") },
      ];

  if (isLoading) {
    return (
      <LtfFinanceLayout title={t("ordersTitle")} subtitle={t("ordersSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </LtfFinanceLayout>
    );
  }

  if (!hasValidOrderId || errorMessage || !order) {
    return (
      <LtfFinanceLayout title={t("ordersTitle")} subtitle={t("ordersSubtitle")}>
        <EmptyState
          title={t("ordersLoadError")}
          description={!hasValidOrderId ? t("ordersLoadError") : errorMessage ?? ""}
        />
      </LtfFinanceLayout>
    );
  }

  return (
    <LtfFinanceLayout title={t("ordersTitle")} subtitle={t("ordersSubtitle")}>
      <Button asChild variant="outline" className="w-fit">
        <Link href={`/${locale}/dashboard/ltf-finance/orders`}>{t("backToOrders")}</Link>
      </Button>

      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <FormPanel>
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
            <span className="text-xs text-muted">{t("clubLabel")}</span>
            <span className="font-medium">
              {clubNameById[order.club] ?? String(order.club)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("totalLabel")}</span>
            <span className="font-medium">
              {order.total} {order.currency}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("createdAtLabel")}</span>
            <span className="font-medium">{formatDisplayDateTime(order.created_at)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{feeOnly ? t("totalItemsLabel") : t("totalLicensesLabel")}</span>
            <span className="font-medium">{totalQuantity}</span>
          </div>
        </div>
      </FormPanel>

      <section className="space-y-3">
        <h2 className="text-section text-foreground">{t("orderItemsTitle")}</h2>
        <EntityTable columns={columns} rows={items} />
      </section>
    </LtfFinanceLayout>
  );
}
