"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { EntityTable } from "@/components/club-admin/entity-table";
import { OpsLayout } from "@/components/ops/ops-layout";
import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { getOpsJobs, retryOpsPrintJob, type OpsJobs } from "@/lib/ops-api";

export default function OpsJobsPage() {
  const t = useTranslations("Ops");
  const [jobs, setJobs] = useState<OpsJobs | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      setJobs(await getOpsJobs());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (id: number) => {
    try {
      await retryOpsPrintJob(id);
      setSuccessMessage(t("printJobQueued"));
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("saveError"));
    }
  };

  const celery = jobs?.celery ?? {};
  const ping = (celery.ping as Record<string, unknown> | undefined) || {};
  const workers = Object.keys(ping);
  const stuck = (jobs?.stuck_print_jobs ?? []).map((row, index) => ({
    ...row,
    id: Number(row.id ?? index),
  }));
  const failed = (jobs?.failed_print_jobs ?? []).map((row, index) => ({
    ...row,
    id: Number(row.id ?? index),
  }));
  const schedules = (jobs?.billing_schedules ?? []).map((row, index) => ({
    ...row,
    id: Number(row.id ?? index),
  }));

  return (
    <OpsLayout title={t("jobsTitle")} subtitle={t("jobsSubtitle")}>
      <ActionNotices
        error={errorMessage}
        success={successMessage}
        onDismiss={() => {
          setErrorMessage(null);
          setSuccessMessage(null);
        }}
      />
      <section>
        <h2 className="text-lg font-semibold text-foreground">{t("celeryTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {workers.length === 0 ? (
            <StatusBadge label={t("noWorkers")} tone="danger" />
          ) : (
            workers.map((worker) => <StatusBadge key={worker} label={worker} tone="success" />)
          )}
        </div>
        {"error" in celery ? <p className="mt-2 text-sm text-muted">{String(celery.error)}</p> : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">{t("stuckPrintJobs")}</h2>
        <div className="mt-3">
          {stuck.length === 0 ? (
            <p className="text-sm text-muted">{t("noStuckJobs")}</p>
          ) : (
            <EntityTable
              columns={[
                { key: "job_number", header: t("colJob") },
                { key: "status", header: t("colStatus") },
                { key: "error_detail", header: t("colDetail") },
                {
                  key: "actions",
                  header: t("colActions"),
                  render: (row) => (
                    <Button variant="outline" onClick={() => retry(Number(row.id))}>
                      {t("retry")}
                    </Button>
                  ),
                },
              ]}
              rows={stuck}
            />
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">{t("failedPrintJobs")}</h2>
        <div className="mt-3">
          {failed.length === 0 ? (
            <p className="text-sm text-muted">{t("noFailedJobs")}</p>
          ) : (
            <EntityTable
              columns={[
                { key: "job_number", header: t("colJob") },
                { key: "status", header: t("colStatus") },
                { key: "error_detail", header: t("colDetail") },
                {
                  key: "actions",
                  header: t("colActions"),
                  render: (row) => (
                    <Button variant="outline" onClick={() => retry(Number(row.id))}>
                      {t("retry")}
                    </Button>
                  ),
                },
              ]}
              rows={failed}
            />
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">{t("billingSchedules")}</h2>
        <div className="mt-3">
          <EntityTable
            columns={[
              { key: "id", header: "ID" },
              { key: "recurrence", header: t("colRecurrence") },
              { key: "next_run_on", header: t("colNextRun") },
              { key: "last_run_on", header: t("colLastRun") },
              { key: "is_active", header: t("colActive") },
            ]}
            rows={schedules}
          />
        </div>
      </section>
    </OpsLayout>
  );
}
