"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { ActionNotices, FormPanel } from "@/components/ui/list-page-chrome";
import { auditActionLabel, displayAuditValue } from "@/lib/audit-log";
import { formatDisplayDateTime } from "@/lib/date-display";
import { FinanceAuditLog, getFinanceAuditLog } from "@/lib/ltf-finance-api";

export default function LtfFinanceAuditLogDetailPage() {
  const t = useTranslations("LtfFinance");
  const locale = useLocale();
  const params = useParams();
  const [log, setLog] = useState<FinanceAuditLog | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logId = useMemo(() => {
    const rawId = params?.id;
    if (Array.isArray(rawId)) {
      return Number(rawId[0]);
    }
    return Number(rawId);
  }, [params]);

  const listHref = `/${locale}/dashboard/ltf-finance/audit-log`;

  useEffect(() => {
    if (!logId || Number.isNaN(logId)) {
      setErrorMessage(t("auditLogNotFoundSubtitle"));
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await getFinanceAuditLog(logId);
        if (!cancelled) {
          setLog(response);
        }
      } catch (error) {
        if (!cancelled) {
          setLog(null);
          setErrorMessage(error instanceof Error ? error.message : t("auditLogLoadError"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [logId, t]);

  if (isLoading) {
    return (
      <LtfFinanceLayout title={t("auditLogDetailTitle")} subtitle={t("auditLogDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </LtfFinanceLayout>
    );
  }

  if (!log) {
    return (
      <LtfFinanceLayout title={t("auditLogDetailTitle")} subtitle={t("auditLogDetailSubtitle")}>
        <Button asChild variant="outline" className="w-fit">
          <Link href={listHref}>{t("backToAuditLog")}</Link>
        </Button>
        <EmptyState
          title={t("auditLogNotFoundTitle")}
          description={errorMessage ?? t("auditLogNotFoundSubtitle")}
        />
      </LtfFinanceLayout>
    );
  }

  const memberDisplay = log.member_name
    ? `${log.member_name}${log.member_ltf_licenseid ? ` · ${log.member_ltf_licenseid}` : ""}`
    : "—";

  return (
    <LtfFinanceLayout
      title={auditActionLabel(log.action, t)}
      subtitle={t("auditLogDetailSubtitle")}
    >
      <Button asChild variant="outline" className="w-fit">
        <Link href={listHref}>{t("backToAuditLog")}</Link>
      </Button>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <FormPanel>
        <p className="text-sm text-muted">{formatDisplayDateTime(log.created_at)}</p>
        <p className="mt-2 text-sm text-foreground">{log.message || "—"}</p>
        <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted">{t("actorLabel")}</dt>
            <dd className="font-medium text-foreground">{displayAuditValue(log.actor_name)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted">{t("clubLabel")}</dt>
            <dd className="font-medium text-foreground">{displayAuditValue(log.club_name)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted">{t("memberLabel")}</dt>
            <dd className="font-medium text-foreground">{memberDisplay}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted">{t("ltfLicenseLabel")}</dt>
            <dd className="font-medium text-foreground">{displayAuditValue(log.license_label)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted">{t("orderNumberLabel")}</dt>
            <dd className="font-medium text-foreground">
              {log.order && log.order_number ? (
                <Link
                  href={`/${locale}/dashboard/ltf-finance/orders/${log.order}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {log.order_number}
                </Link>
              ) : (
                displayAuditValue(log.order_number)
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted">{t("invoiceNumberLabel")}</dt>
            <dd className="font-medium text-foreground">
              {log.invoice && log.invoice_number ? (
                <Link
                  href={`/${locale}/dashboard/ltf-finance/invoices/${log.invoice}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {log.invoice_number}
                </Link>
              ) : (
                displayAuditValue(log.invoice_number)
              )}
            </dd>
          </div>
        </dl>
      </FormPanel>

      {log.metadata_display && log.metadata_display.length > 0 ? (
        <FormPanel>
          <h2 className="text-section text-foreground">{t("auditLogDetailsLabel")}</h2>
          <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
            {log.metadata_display.map((item) => (
              <div key={item.key} className="flex flex-col gap-1">
                <dt className="text-xs text-muted">{item.label}</dt>
                <dd className="font-medium text-foreground">{item.value}</dd>
              </div>
            ))}
          </dl>
        </FormPanel>
      ) : null}
    </LtfFinanceLayout>
  );
}
