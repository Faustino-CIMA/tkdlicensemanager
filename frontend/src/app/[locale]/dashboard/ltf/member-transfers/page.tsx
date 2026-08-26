"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { FormPanel, PageNotice } from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { getMemberTransfers, MemberTransfer } from "@/lib/club-admin-api";

export default function LtfMemberTransfersPage() {
  const t = useTranslations("LtfAdmin");
  const [transfers, setTransfers] = useState<MemberTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const rows = await getMemberTransfers({ feeOnly: true });
      setTransfers(rows);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <LtfAdminLayout title={t("memberTransfersTitle")} subtitle={t("memberTransfersSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}
      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : transfers.length === 0 ? (
        <EmptyState title={t("memberTransfersEmpty")} />
      ) : (
        <div className="space-y-3">
          {transfers.map((item) => (
            <FormPanel key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {item.member.first_name} {item.member.last_name}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {item.from_club.name} → {item.to_club.name}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge label={item.status} tone="info" />
                  <StatusBadge
                    label={t("memberTransferFeeBadge", {
                      amount: item.fee_amount,
                      currency: item.fee_currency,
                    })}
                    tone="warning"
                  />
                </div>
              </div>
              {item.note ? <p className="mt-3 text-sm text-foreground">{item.note}</p> : null}
              <div className="mt-3 space-y-2">
                {item.messages.map((message) => (
                  <p key={message.id} className="text-sm text-muted">
                    {message.author_name}: {message.body}
                  </p>
                ))}
              </div>
            </FormPanel>
          ))}
        </div>
      )}
    </LtfAdminLayout>
  );
}
