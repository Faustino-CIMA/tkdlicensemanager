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
import {
  FinanceOrder,
  PayconiqPayment,
  createPayconiqPayment,
  getClubOrder,
  getPayconiqPaymentStatus,
} from "@/lib/club-finance-api";

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
  const [payconiqPayment, setPayconiqPayment] = useState<PayconiqPayment | null>(null);
  const [payconiqError, setPayconiqError] = useState<string | null>(null);
  const [isPayconiqBusy, setIsPayconiqBusy] = useState(false);
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

  if (isLoading) {
    return (
      <ClubAdminLayout title={t("orderDetailTitle")} subtitle={t("orderDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
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

      <section className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div className="grid gap-4 text-sm text-zinc-700 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("orderNumberLabel")}</span>
            <span className="font-medium">{order.order_number}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("statusLabel")}</span>
            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("totalLabel")}</span>
            <span className="font-medium">{order.total} {order.currency}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{t("createdAtLabel")}</span>
            <span className="font-medium">{formatDisplayDateTime(order.created_at)}</span>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">{t("orderItemsTitle")}</h2>
        <EntityTable columns={columns} rows={items} />
      </section>

      {order.invoice ? (
        <section className="mt-6 rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-zinc-700">{t("payconiqTitle")}</h2>
            <p className="text-sm text-zinc-600">{t("payconiqHint")}</p>
            {payconiqError ? (
              <p className="text-sm text-red-600">{payconiqError}</p>
            ) : null}
            {payconiqPayment ? (
              <div className="flex flex-col gap-2 text-sm text-zinc-700">
                <div>
                  <span className="font-medium">{t("payconiqStatusLabel")}</span>{" "}
                  {payconiqPayment.payconiq_status || payconiqPayment.status}
                </div>
                <div>
                  <span className="font-medium">{t("payconiqLinkLabel")}</span>{" "}
                  <a className="text-blue-600 underline" href={payconiqPayment.payconiq_payment_url}>
                    {payconiqPayment.payconiq_payment_url}
                  </a>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={isPayconiqBusy}
                onClick={async () => {
                  if (!order.invoice) {
                    return;
                  }
                  setIsPayconiqBusy(true);
                  setPayconiqError(null);
                  try {
                    const payment = await createPayconiqPayment(order.invoice.id);
                    setPayconiqPayment(payment);
                  } catch (error) {
                    setPayconiqError(
                      error instanceof Error ? error.message : t("payconiqError")
                    );
                  } finally {
                    setIsPayconiqBusy(false);
                  }
                }}
              >
                {t("payconiqCreateButton")}
              </Button>
              {payconiqPayment ? (
                <Button
                  variant="outline"
                  disabled={isPayconiqBusy}
                  onClick={async () => {
                    setIsPayconiqBusy(true);
                    setPayconiqError(null);
                    try {
                      const payment = await getPayconiqPaymentStatus(payconiqPayment.id);
                      setPayconiqPayment(payment);
                    } catch (error) {
                      setPayconiqError(
                        error instanceof Error ? error.message : t("payconiqError")
                      );
                    } finally {
                      setIsPayconiqBusy(false);
                    }
                  }}
                >
                  {t("payconiqRefreshButton")}
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </ClubAdminLayout>
  );
}
