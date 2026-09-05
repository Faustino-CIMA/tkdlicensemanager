"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { EntityTable } from "@/components/club-admin/entity-table";
import { OpsLayout } from "@/components/ops/ops-layout";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { formatDisplayDateTime } from "@/lib/date-display";
import { getOpsAudit, type OpsAuditEntry } from "@/lib/ops-api";

export default function OpsAuditPage() {
  const t = useTranslations("Ops");
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<OpsAuditEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const page = await getOpsAudit();
      setRows(page.results);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <OpsLayout title={t("auditTitle")} subtitle={t("auditSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <EntityTable
        columns={[
          {
            key: "created_at",
            header: t("colCreated"),
            render: (row) => formatDisplayDateTime(row.created_at),
          },
          { key: "action", header: t("colAction") },
          { key: "actor_name", header: t("colActor"), render: (row) => row.actor_name || "—" },
          { key: "message", header: t("colMessage") },
        ]}
        rows={rows}
        onRowClick={(row) => router.push(`/${locale}/dashboard/ops/audit/${row.id}`)}
      />
    </OpsLayout>
  );
}
