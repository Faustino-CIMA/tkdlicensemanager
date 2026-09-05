"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { OpsLayout } from "@/components/ops/ops-layout";
import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { formatDisplayDateTime } from "@/lib/date-display";
import { getOpsAuditDetail, type OpsAuditEntry } from "@/lib/ops-api";

export default function OpsAuditDetailPage() {
  const t = useTranslations("Ops");
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const [entry, setEntry] = useState<OpsAuditEntry | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return;
    let cancelled = false;
    getOpsAuditDetail(id)
      .then((payload) => {
        if (!cancelled) setEntry(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : t("loadError"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id, t]);

  return (
    <OpsLayout title={t("auditDetailTitle")} subtitle={entry?.action}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <div className="mb-4">
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard/ops/audit`}>{t("backToAudit")}</Link>
        </Button>
      </div>
      {entry ? (
        <div className="app-panel space-y-3 p-6 text-sm">
          <p>
            <span className="text-muted">{t("colCreated")}: </span>
            {formatDisplayDateTime(entry.created_at)}
          </p>
          <p>
            <span className="text-muted">{t("colActor")}: </span>
            {entry.actor_name || "—"}
          </p>
          <p>
            <span className="text-muted">{t("colAction")}: </span>
            {entry.action}
          </p>
          <p>
            <span className="text-muted">{t("colTarget")}: </span>
            {entry.target_type}
            {entry.target_id ? ` #${entry.target_id}` : ""}
          </p>
          <p>
            <span className="text-muted">{t("colMessage")}: </span>
            {entry.message}
          </p>
          <p>
            <span className="text-muted">{t("colIp")}: </span>
            {entry.ip || "—"}
          </p>
          <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-secondary p-3 text-xs">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
        </div>
      ) : null}
    </OpsLayout>
  );
}
