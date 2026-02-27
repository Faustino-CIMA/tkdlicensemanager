"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [statusFilter, setStatusFilter] = useState<PrintJobStatus | "all">("all");
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
      if (statusFilter !== "all" && job.status !== statusFilter) {
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
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
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
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-full max-w-sm"
            placeholder={t("licenseCardPrintJobsSearchPlaceholder")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as PrintJobStatus | "all")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t("statusLabel")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("licenseCardPrintJobsStatusFilterAll")}</SelectItem>
              <SelectItem value="draft">{t("licenseCardPrintJobStatusDraft")}</SelectItem>
              <SelectItem value="queued">{t("licenseCardPrintJobStatusQueued")}</SelectItem>
              <SelectItem value="running">{t("licenseCardPrintJobStatusRunning")}</SelectItem>
              <SelectItem value="succeeded">{t("licenseCardPrintJobStatusSucceeded")}</SelectItem>
              <SelectItem value="failed">{t("licenseCardPrintJobStatusFailed")}</SelectItem>
              <SelectItem value="cancelled">{t("licenseCardPrintJobStatusCancelled")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={isLoading} onClick={() => void loadJobs()}>
            {isLoading ? t("licenseCardPrintJobsRefreshingAction") : t("refreshAction")}
          </Button>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : filteredJobs.length === 0 ? (
          <EmptyState
            title={t("licenseCardPrintJobsEmptyTitle")}
            description={t("licenseCardPrintJobsEmptySubtitle")}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-100 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("licenseCardPrintJobLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("clubLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("licenseCardPrintJobTemplateVersionLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("licenseCardPrintJobItemsLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("createdAtLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("updatedAtLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("actionsLabel")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredJobs.map((job) => {
                  const statusMeta = getStatusMeta(job.status);
                  const isJobBusy = activeJobId === job.id;
                  return (
                    <tr key={job.id} className="text-zinc-700">
                      <td className="px-4 py-3 font-medium">{job.job_number}</td>
                      <td className="px-4 py-3">{clubNameById[job.club] || String(job.club)}</td>
                      <td className="px-4 py-3">#{job.template_version}</td>
                      <td className="px-4 py-3">{job.total_items}</td>
                      <td className="px-4 py-3">
                        <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                      </td>
                      <td className="px-4 py-3">{formatDisplayDateTime(job.created_at)}</td>
                      <td className="px-4 py-3">{formatDisplayDateTime(job.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </LtfAdminLayout>
  );
}

