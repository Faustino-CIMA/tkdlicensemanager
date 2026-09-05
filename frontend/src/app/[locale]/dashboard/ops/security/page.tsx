"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { EntityTable } from "@/components/club-admin/entity-table";
import { OpsLayout } from "@/components/ops/ops-layout";
import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDisplayDateTime } from "@/lib/date-display";
import {
  getOpsAlerts,
  getOpsAuthEvents,
  getOpsSessions,
  revokeOpsSession,
  updateOpsAlert,
  type OpsAlert,
  type OpsAuthEvent,
  type OpsSession,
} from "@/lib/ops-api";

function alertTone(severity: OpsAlert["severity"]): "info" | "warning" | "danger" {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

export default function OpsSecurityPage() {
  const t = useTranslations("Ops");
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [events, setEvents] = useState<OpsAuthEvent[]>([]);
  const [sessions, setSessions] = useState<OpsSession[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const [alertPage, eventPage, sessionPage] = await Promise.all([
        getOpsAlerts({ status: "open" }),
        getOpsAuthEvents({ event_type: "login_failure" }),
        getOpsSessions(60),
      ]);
      setAlerts(alertPage.results);
      setEvents(eventPage.results);
      setSessions(sessionPage.results);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAlert = async (id: number, status: OpsAlert["status"]) => {
    try {
      await updateOpsAlert(id, status);
      setSuccessMessage(t("alertUpdated"));
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("saveError"));
    }
  };

  const onRevoke = async (userId: number) => {
    try {
      await revokeOpsSession(userId);
      setSuccessMessage(t("sessionRevoked"));
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("saveError"));
    }
  };

  return (
    <OpsLayout title={t("securityTitle")} subtitle={t("securitySubtitle")}>
      <ActionNotices
        error={errorMessage}
        success={successMessage}
        onDismiss={() => {
          setErrorMessage(null);
          setSuccessMessage(null);
        }}
      />

      <section>
        <h2 className="text-lg font-semibold text-foreground">{t("alertsTitle")}</h2>
        <div className="mt-3">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">{t("alertsEmpty")}</p>
          ) : (
            <EntityTable
              columns={[
                {
                  key: "severity",
                  header: t("colSeverity"),
                  render: (row) => <StatusBadge label={row.severity} tone={alertTone(row.severity)} />,
                },
                { key: "title", header: t("colTitle") },
                { key: "detail", header: t("colDetail") },
                {
                  key: "created_at",
                  header: t("colCreated"),
                  render: (row) => formatDisplayDateTime(row.created_at),
                },
                {
                  key: "actions",
                  header: t("colActions"),
                  render: (row) => (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => onAlert(row.id, "ack")}>
                        {t("ack")}
                      </Button>
                      <Button variant="outline" onClick={() => onAlert(row.id, "resolved")}>
                        {t("resolve")}
                      </Button>
                    </div>
                  ),
                },
              ]}
              rows={alerts}
            />
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">{t("failedLoginsTitle")}</h2>
        <div className="mt-3">
          {events.length === 0 ? (
            <p className="text-sm text-muted">{t("failedLoginsEmpty")}</p>
          ) : (
            <EntityTable
              columns={[
                {
                  key: "created_at",
                  header: t("colCreated"),
                  render: (row) => formatDisplayDateTime(row.created_at),
                },
                { key: "username_attempted", header: t("colUser") },
                { key: "ip", header: t("colIp"), render: (row) => row.ip || "—" },
                { key: "user_agent", header: t("colUserAgent") },
              ]}
              rows={events}
            />
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">{t("sessionsTitle")}</h2>
        <div className="mt-3">
          <EntityTable
            columns={[
              { key: "username", header: t("colUser") },
              { key: "role", header: t("colRole") },
              { key: "last_ip", header: t("colIp"), render: (row) => row.last_ip || "—" },
              {
                key: "last_used_at",
                header: t("colLastUsed"),
                render: (row) => (row.last_used_at ? formatDisplayDateTime(row.last_used_at) : "—"),
              },
              {
                key: "actions",
                header: t("colActions"),
                render: (row) => (
                  <Button variant="outline" onClick={() => onRevoke(row.user_id)}>
                    {t("revokeSession")}
                  </Button>
                ),
              },
            ]}
            rows={sessions.map((session) => ({ ...session, id: session.user_id }))}
          />
        </div>
      </section>
    </OpsLayout>
  );
}
