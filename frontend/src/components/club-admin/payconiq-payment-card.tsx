"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PayconiqPayment } from "@/lib/club-finance-api";

type PayconiqPaymentCardProps = {
  payment: PayconiqPayment | null;
  errorMessage: string | null;
  isBusy: boolean;
  onCreate: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
};

const TERMINAL_STATUSES = new Set(["PAID", "FAILED", "CANCELLED", "EXPIRED"]);

function normalizePayconiqStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toUpperCase();
}

export function PayconiqPaymentCard({
  payment,
  errorMessage,
  isBusy,
  onCreate,
  onRefresh,
}: PayconiqPaymentCardProps) {
  const t = useTranslations("ClubAdmin");
  const statusMeta = useMemo(() => {
    const normalized = normalizePayconiqStatus(payment?.payconiq_status || payment?.status);
    switch (normalized) {
      case "PENDING":
        return {
          label: t("payconiqStatusPending"),
          tone: "warning" as const,
          isTerminal: false,
        };
      case "PAID":
        return {
          label: t("payconiqStatusPaid"),
          tone: "success" as const,
          isTerminal: true,
        };
      case "FAILED":
        return {
          label: t("payconiqStatusFailed"),
          tone: "danger" as const,
          isTerminal: true,
        };
      case "CANCELLED":
        return {
          label: t("payconiqStatusCancelled"),
          tone: "neutral" as const,
          isTerminal: true,
        };
      case "EXPIRED":
        return {
          label: t("payconiqStatusExpired"),
          tone: "info" as const,
          isTerminal: true,
        };
      default:
        return {
          label: normalized
            ? `${t("payconiqStatusUnknown")} (${normalized})`
            : t("payconiqStatusUnknown"),
          tone: "neutral" as const,
          isTerminal: TERMINAL_STATUSES.has(normalized),
        };
    }
  }, [payment?.payconiq_status, payment?.status, t]);

  const createDisabled = isBusy || Boolean(payment && !statusMeta.isTerminal);

  return (
    <section className="mt-6 rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-700">{t("payconiqTitle")}</h2>
        <p className="text-sm text-zinc-600">{t("payconiqHint")}</p>
        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
        {payment ? (
          <div className="flex flex-col gap-2 text-sm text-zinc-700">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t("payconiqStatusLabel")}</span>
              <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
            </div>
            <div>
              <span className="font-medium">{t("payconiqLinkLabel")}</span>{" "}
              <a
                className="text-blue-600 underline"
                href={payment.payconiq_payment_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {payment.payconiq_payment_url}
              </a>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={createDisabled} onClick={onCreate}>
            {t("payconiqCreateButton")}
          </Button>
          {payment ? (
            <Button variant="outline" disabled={isBusy} onClick={onRefresh}>
              {t("payconiqRefreshButton")}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
