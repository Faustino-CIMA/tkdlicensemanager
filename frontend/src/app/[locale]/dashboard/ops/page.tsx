"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Activity, AlertTriangle, Server, ShieldAlert, Users } from "lucide-react";

import { EntityTable } from "@/components/club-admin/entity-table";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { OpsLayout } from "@/components/ops/ops-layout";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDisplayDateTime } from "@/lib/date-display";
import { getOpsOverview, getOpsSessions, type OpsOverview, type OpsSession } from "@/lib/ops-api";

function toneForOk(ok: boolean): "success" | "danger" {
  return ok ? "success" : "danger";
}

export default function OpsOverviewPage() {
  const t = useTranslations("Ops");
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [sessions, setSessions] = useState<OpsSession[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const [nextOverview, nextSessions] = await Promise.all([getOpsOverview(), getOpsSessions()]);
      setOverview(nextOverview);
      setSessions(nextSessions.results);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const checks = overview ? Object.entries(overview.health.checks) : [];

  return (
    <OpsLayout title={t("overviewTitle")} subtitle={t("overviewSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title={t("cardOnline")}
          value={String(overview?.online_sessions ?? "—")}
          icon={Activity}
          tone="accent"
        />
        <SummaryCard
          title={t("cardAlerts")}
          value={String(overview?.open_alerts ?? "—")}
          icon={AlertTriangle}
          tone={overview && overview.open_alerts > 0 ? "danger" : "success"}
        />
        <SummaryCard
          title={t("cardFailedLogins")}
          value={String(overview?.failed_logins_24h ?? "—")}
          helper={t("last24h")}
          icon={ShieldAlert}
          tone={overview && overview.failed_logins_24h > 0 ? "warning" : "neutral"}
        />
        <SummaryCard
          title={t("cardUsers")}
          value={String(overview?.user_count ?? "—")}
          helper={t("superuserCount", { count: overview?.superuser_count ?? 0 })}
          icon={Users}
          tone="neutral"
        />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">{t("healthTitle")}</h2>
        <p className="mt-1 text-sm text-muted">
          {overview
            ? t("healthMeta", {
                version: overview.health.app_version || "—",
                django: overview.health.django_version,
              })
            : t("loading")}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {checks.map(([name, check]) => (
            <div key={name} className="app-panel p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold capitalize text-foreground">{name.replaceAll("_", " ")}</p>
                <StatusBadge label={check.ok ? t("statusOk") : t("statusDown")} tone={toneForOk(check.ok)} />
              </div>
              <p className="mt-2 text-sm text-muted">{check.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Server className="size-4 text-muted" aria-hidden />
          <h2 className="text-lg font-semibold text-foreground">{t("sessionsTitle")}</h2>
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted">{t("sessionsEmpty")}</p>
        ) : (
          <EntityTable
            columns={[
              { key: "username", header: t("colUser") },
              { key: "role", header: t("colRole") },
              {
                key: "is_superuser",
                header: t("colSuperuser"),
                render: (row) => (row.is_superuser ? t("yes") : t("no")),
              },
              { key: "last_ip", header: t("colIp"), render: (row) => row.last_ip || "—" },
              {
                key: "last_used_at",
                header: t("colLastUsed"),
                render: (row) => (row.last_used_at ? formatDisplayDateTime(row.last_used_at) : "—"),
              },
            ]}
            rows={sessions.map((session) => ({ ...session, id: session.user_id }))}
          />
        )}
      </section>
    </OpsLayout>
  );
}
