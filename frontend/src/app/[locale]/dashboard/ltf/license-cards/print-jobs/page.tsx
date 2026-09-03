"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  ListActionsRow,
  ListToolbarPanel,
  ActionNotices
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiRequest } from "@/lib/api";
import { formatDisplayDateTime } from "@/lib/date-display";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import { Club, getClubs } from "@/lib/ltf-admin-api";
import {
  PrintJob,
  PrintJobStatus,
  cancelPrintJob,
  downloadPrintJobPdf,
  executePrintJob,
  getPrintJobs,
  retryPrintJob,
} from "@/lib/license-card-api";

type AuthMeResponse = {
  role: string;
};

type PrintJobStatusFilter = "all" | "open" | "succeeded" | "failed" | "cancelled";

const OPEN_PRINT_JOB_STATUSES: PrintJobStatus[] = ["draft", "queued", "running"];

function jobMatchesStatusFilter(job: PrintJob, filter: PrintJobStatusFilter) {
  if (filter === "all") {
    return true;
  }
  if (filter === "open") {
    return OPEN_PRINT_JOB_STATUSES.includes(job.status);
  }
  return job.status === filter;
}

function openBlobInNewTab(blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 15000);
}

export default function LtfAdminLicenseCardPrintJobsPage() {
  const t = useTranslations("LtfAdmin");
  const locale = useLocale();
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [isRoleLoading, setIsRoleLoading] = useState(true);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PrintJobStatusFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const canManagePrintJobs = currentRole === "ltf_admin";
  const fallbackRoute = getDashboardRouteForRole(currentRole ?? "", locale) ?? `/${locale}/dashboard`;

  const clubNameById = useMemo(() => {
    return clubs.reduce<Record<number, string>>((acc, club) => {
      acc[club.id] = club.name;
      return acc;
    }, {});
  }, [clubs]);

  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [jobsResponse, clubsResponse] = await Promise.all([getPrintJobs(), getClubs()]);
      setJobs(jobsResponse);
      setClubs(clubsResponse);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardPrintJobsLoadError")
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let isMounted = true;
    const loadRole = async () => {
      setIsRoleLoading(true);
      try {
        const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
        if (isMounted) {
          setCurrentRole(me.role);
        }
      } catch {
        if (isMounted) {
          setCurrentRole(null);
        }
      } finally {
        if (isMounted) {
          setIsRoleLoading(false);
        }
      }
    };
    void loadRole();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!canManagePrintJobs) {
      return;
    }
    void loadJobs();
  }, [canManagePrintJobs, loadJobs]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      if (!jobMatchesStatusFilter(job, statusFilter)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const clubName = (clubNameById[job.club] || "").toLowerCase();
      return (
        job.job_number.toLowerCase().includes(normalizedQuery) ||
        String(job.id).includes(normalizedQuery) ||
        String(job.template_version).includes(normalizedQuery) ||
        clubName.includes(normalizedQuery)
      );
    });
  }, [clubNameById, jobs, searchQuery, statusFilter]);

  const printJobFacetCounts = useMemo(() => {
    const counts = {
      all: jobs.length,
      open: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const job of jobs) {
      if (OPEN_PRINT_JOB_STATUSES.includes(job.status)) {
        counts.open += 1;
      } else if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
        counts[job.status] += 1;
      }
    }
    return counts;
  }, [jobs]);

  const getStatusMeta = (status: PrintJobStatus) => {
    switch (status) {
      case "draft":
        return { label: t("licenseCardPrintJobStatusDraft"), tone: "neutral" as const };
      case "queued":
        return { label: t("licenseCardPrintJobStatusQueued"), tone: "warning" as const };
      case "running":
        return { label: t("licenseCardPrintJobStatusRunning"), tone: "info" as const };
      case "succeeded":
        return { label: t("licenseCardPrintJobStatusSucceeded"), tone: "success" as const };
      case "failed":
        return { label: t("licenseCardPrintJobStatusFailed"), tone: "danger" as const };
      default:
        return { label: t("licenseCardPrintJobStatusCancelled"), tone: "neutral" as const };
    }
  };

  const executeAction = async (jobId: number, action: () => Promise<unknown>) => {
    setActiveJobId(jobId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await action();
      setSuccessMessage(t("licenseCardPrintJobsActionSuccess"));
      await loadJobs();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardPrintJobsActionError")
      );
    } finally {
      setActiveJobId(null);
    }
  };

  const handleDownloadPdf = async (job: PrintJob) => {
    setActiveJobId(job.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const blob = await downloadPrintJobPdf(job.id);
      openBlobInNewTab(blob);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardPrintJobsActionError")
      );
    } finally {
      setActiveJobId(null);
    }
  };

  if (isRoleLoading) {
    return (
      <LtfAdminLayout
        title={t("licenseCardPrintJobsTitle")}
        subtitle={t("licenseCardPrintJobsSubtitle")}
      >
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </LtfAdminLayout>
    );
  }

  if (!canManagePrintJobs) {
    return (
      <LtfAdminLayout
        title={t("licenseCardPrintJobsTitle")}
        subtitle={t("licenseCardPrintJobsSubtitle")}
      >
        <EmptyState
          title={t("licenseCardsAccessDeniedTitle")}
          description={t("licenseCardsAccessDeniedSubtitle")}
        />
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href={fallbackRoute}>{t("licenseCardsAccessDeniedBackAction")}</Link>
          </Button>
        </div>
      </LtfAdminLayout>
    );
  }

  return (
    <LtfAdminLayout title={t("licenseCardPrintJobsTitle")} subtitle={t("licenseCardPrintJobsSubtitle")}>
      <ActionNotices error={errorMessage} success={successMessage} onDismiss={() => { setErrorMessage(null); setSuccessMessage(null); }} />

      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <ListToolbarPanel
            filtersPlacement="below"
            search={
              <Input
                className="w-full max-w-sm"
                placeholder={t("licenseCardPrintJobsSearchPlaceholder")}
                aria-label={t("licenseCardPrintJobsSearchPlaceholder")}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            }
            filters={
              <FilterPills
                layout="wrap"
                ariaLabel={t("printJobsStatusFilterAriaLabel")}
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  {
                    value: "all",
                    title: t("filterAllTitle"),
                    count: printJobFacetCounts.all,
                  },
                  {
                    value: "open",
                    title: t("printJobFilterOpenTitle"),
                    count: printJobFacetCounts.open,
                  },
                  {
                    value: "succeeded",
                    title: t("licenseCardPrintJobStatusSucceeded"),
                    count: printJobFacetCounts.succeeded,
                  },
                  {
                    value: "failed",
                    title: t("licenseCardPrintJobStatusFailed"),
                    count: printJobFacetCounts.failed,
                  },
                  {
                    value: "cancelled",
                    title: t("licenseCardPrintJobStatusCancelled"),
                    count: printJobFacetCounts.cancelled,
                  },
                ]}
              />
            }
          />
          <ListActionsRow
            actions={
              <Button variant="outline" disabled={isLoading} onClick={() => void loadJobs()}>
                {isLoading ? t("licenseCardPrintJobsRefreshingAction") : t("refreshAction")}
              </Button>
            }
          />
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : filteredJobs.length === 0 ? (
          <EmptyState
            title={t("licenseCardPrintJobsEmptyTitle")}
            description={t("licenseCardPrintJobsEmptySubtitle")}
          />
        ) : (
          <EntityTable
            columns={[
              { key: "job_number", header: t("licenseCardPrintJobLabel") },
              {
                key: "club",
                header: t("clubLabel"),
                render: (job) => clubNameById[job.club] || String(job.club),
              },
              {
                key: "template_version",
                header: t("licenseCardPrintJobTemplateVersionLabel"),
                render: (job) => `#${job.template_version}`,
              },
              { key: "total_items", header: t("licenseCardPrintJobItemsLabel") },
              {
                key: "status",
                header: t("statusLabel"),
                render: (job) => {
                  const statusMeta = getStatusMeta(job.status);
                  return <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />;
                },
              },
              {
                key: "created_at",
                header: t("createdAtLabel"),
                render: (job) => formatDisplayDateTime(job.created_at),
              },
              {
                key: "updated_at",
                header: t("updatedAtLabel"),
                render: (job) => formatDisplayDateTime(job.updated_at),
              },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (job) => {
                  const isJobBusy = activeJobId === job.id;
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isJobBusy || !["draft", "failed"].includes(job.status)}
                        onClick={() => void executeAction(job.id, () => executePrintJob(job.id))}
                      >
                        {t("licenseCardPrintJobExecuteAction")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isJobBusy || !["failed", "cancelled"].includes(job.status)}
                        onClick={() => void executeAction(job.id, () => retryPrintJob(job.id))}
                      >
                        {t("licenseCardPrintJobRetryAction")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isJobBusy || ["succeeded", "cancelled"].includes(job.status)}
                        onClick={() => void executeAction(job.id, () => cancelPrintJob(job.id))}
                      >
                        {t("licenseCardPrintJobCancelAction")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isJobBusy || job.status !== "succeeded" || !job.artifact_pdf}
                        onClick={() => void handleDownloadPdf(job)}
                      >
                        {t("licenseCardPrintJobDownloadPdfAction")}
                      </Button>
                    </div>
                  );
                },
              },
            ]}
            rows={filteredJobs}
          />
        )}
      </div>
    </LtfAdminLayout>
  );
}

