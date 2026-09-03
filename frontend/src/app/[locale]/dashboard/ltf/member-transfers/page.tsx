"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import {
  FormPanel,
  ActionNotices
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getMemberTransfers,
  getTransferMovements,
  MemberTransfer,
  TransferMovementMonitor,
} from "@/lib/club-admin-api";
import { formatDisplayDateTime } from "@/lib/date-display";

export default function LtfMemberTransfersPage() {
  const t = useTranslations("LtfAdmin");
  const locale = useLocale();
  const router = useRouter();
  const [transfers, setTransfers] = useState<MemberTransfer[]>([]);
  const [monitor, setMonitor] = useState<TransferMovementMonitor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const [feeRows, movement] = await Promise.all([
        getMemberTransfers({ feeOnly: true }),
        getTransferMovements(),
      ]);
      setTransfers(feeRows);
      setMonitor(movement);
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
    <LtfAdminLayout title={t("memberTransfersTitle")} subtitle={t("memberMovementSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />
      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : (
        <div className="space-y-6">
          <FormPanel>
            <h2 className="text-section text-foreground">{t("clubTouristMonitorTitle")}</h2>
            <p className="mt-1 text-sm text-muted">
              {t("clubTouristMonitorHint", { count: monitor?.threshold ?? 3 })}
            </p>
            {(monitor?.flagged_members.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("clubTouristNone")}</p>
            ) : (
              <div className="mt-4">
                <EntityTable
                  columns={[
                    {
                      key: "name",
                      header: t("memberLabel"),
                      render: (row) => (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span>
                            {row.first_name} {row.last_name}
                          </span>
                          <StatusBadge label={t("clubTouristBadge")} tone="warning" />
                        </span>
                      ),
                    },
                    { key: "club_name", header: t("clubLabel") },
                    { key: "ltf_licenseid", header: t("ltfLicenseLabel") },
                    { key: "completed_transfer_count", header: t("clubMovementCountLabel") },
                  ]}
                  rows={monitor?.flagged_members ?? []}
                  onRowClick={(row) => {
                    router.push(`/${locale}/dashboard/ltf/members/${row.id}`);
                  }}
                />
              </div>
            )}
          </FormPanel>

          <FormPanel>
            <h2 className="text-section text-foreground">{t("clubMovementClubsTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("clubMovementClubsSubtitle")}</p>
            {(monitor?.clubs.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("clubMovementClubsEmpty")}</p>
            ) : (
              <div className="mt-4">
                <EntityTable
                  columns={[
                    { key: "name", header: t("clubLabel") },
                    { key: "incoming", header: t("clubMovementIncomingLabel") },
                    { key: "outgoing", header: t("clubMovementOutgoingLabel") },
                    { key: "total", header: t("clubMovementTotalLabel") },
                  ]}
                  rows={monitor?.clubs ?? []}
                />
              </div>
            )}
          </FormPanel>

          <FormPanel>
            <h2 className="text-section text-foreground">{t("clubMovementRecentTitle")}</h2>
            {(monitor?.recent_completed.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("clubMovementHistoryEmpty")}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-2 py-2 font-medium">{t("memberLabel")}</th>
                      <th className="px-2 py-2 font-medium">{t("clubMovementFromLabel")}</th>
                      <th className="px-2 py-2 font-medium">{t("clubMovementToLabel")}</th>
                      <th className="px-2 py-2 font-medium">{t("clubMovementDateLabel")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/80">
                    {(monitor?.recent_completed ?? []).map((row) => (
                      <tr key={row.id}>
                        <td className="px-2 py-2">
                          <Link
                            className="font-medium text-foreground underline-offset-2 hover:underline"
                            href={`/${locale}/dashboard/ltf/members/${row.member?.id}`}
                          >
                            {row.member?.first_name} {row.member?.last_name}
                          </Link>
                        </td>
                        <td className="px-2 py-2">{row.from_club.name}</td>
                        <td className="px-2 py-2">{row.to_club.name}</td>
                        <td className="px-2 py-2">
                          {formatDisplayDateTime(row.completed_at || row.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FormPanel>

          <FormPanel>
            <h2 className="text-section text-foreground">{t("memberTransfersFeeSectionTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("memberTransfersSubtitle")}</p>
            {transfers.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("memberTransfersEmpty")}</p>
            ) : (
              <div className="mt-4 space-y-3">
                {transfers.map((item) => (
                  <div key={item.id} className="rounded-[var(--radius-form)] border border-border p-4">
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
                  </div>
                ))}
              </div>
            )}
          </FormPanel>
        </div>
      )}
    </LtfAdminLayout>
  );
}
