"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Club,
  License,
  Member,
  deleteLicense,
  getClubs,
  getLicenses,
  getMembers,
} from "@/lib/ltf-admin-api";

const BATCH_DELETE_STORAGE_KEY = "ltf_licenses_batch_delete_ids";

type DeleteResult = {
  deleted: number;
  failed: number;
  failedItems: string[];
};

function parseSelectedIds(): number[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const rawValue = window.sessionStorage.getItem(BATCH_DELETE_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    const ids = parsedValue
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

export default function LtfLicenseBatchDeletePage() {
  const t = useTranslations("LtfAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";

  const [selectedIds] = useState<number[]>(() => parseSelectedIds());
  const [licenses, setLicenses] = useState<License[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<DeleteResult | null>(null);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clubById = useMemo(() => new Map(clubs.map((club) => [club.id, club])), [clubs]);

  const selectedLicenses = useMemo(
    () => licenses.filter((license) => selectedIds.includes(license.id)),
    [licenses, selectedIds]
  );
  const impactedMembersCount = useMemo(
    () => new Set(selectedLicenses.map((license) => license.member)).size,
    [selectedLicenses]
  );

  const previewRows = useMemo(
    () =>
      selectedLicenses.map((license) => {
        const member = memberById.get(license.member);
        const club = clubById.get(license.club);
        const statusLabel =
          license.status === "active"
            ? t("statusActive")
            : license.status === "expired"
            ? t("statusExpired")
            : license.status === "revoked"
            ? t("statusRevoked")
            : t("statusPending");
        const statusTone =
          license.status === "active"
            ? "success"
            : license.status === "expired" || license.status === "revoked"
            ? "danger"
            : "warning";
        return {
          id: license.id,
          memberLabel: member ? `${member.first_name} ${member.last_name}` : t("unknownMember"),
          clubLabel: club?.name ?? t("unknownClub"),
          yearLabel: String(license.year),
          statusLabel,
          statusTone,
        };
      }),
    [selectedLicenses, memberById, clubById, t]
  );

  const loadData = useCallback(async () => {
    if (selectedIds.length === 0) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [licensesResponse, membersResponse, clubsResponse] = await Promise.all([
        getLicenses(),
        getMembers(),
        getClubs(),
      ]);
      setLicenses(licensesResponse);
      setMembers(membersResponse);
      setClubs(clubsResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("batchDeleteLicensesLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [selectedIds, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const clearBatchSelection = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(BATCH_DELETE_STORAGE_KEY);
  };

  const handleBack = () => {
    clearBatchSelection();
    router.push(`/${locale}/dashboard/ltf/licenses`);
  };

  const handleConfirmDelete = async () => {
    if (selectedLicenses.length === 0 || isDeleting) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    setResult(null);
    const total = selectedLicenses.length;
    let deleted = 0;
    const failedItems: string[] = [];

    for (let index = 0; index < selectedLicenses.length; index += 1) {
      const license = selectedLicenses[index];
      setProgress({ current: index + 1, total });
      try {
        await deleteLicense(license.id);
        deleted += 1;
      } catch {
        const member = memberById.get(license.member);
        const memberLabel = member ? `${member.first_name} ${member.last_name}` : t("unknownMember");
        failedItems.push(`${memberLabel} · ${license.year}`);
      }
    }

    clearBatchSelection();
    setProgress(null);
    setIsDeleting(false);
    setResult({
      deleted,
      failed: failedItems.length,
      failedItems,
    });
    await loadData();
  };

  return (
    <LtfAdminLayout title={t("batchDeleteLicensesTitle")} subtitle={t("batchDeleteLicensesSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : selectedIds.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title={t("batchDeleteLicensesNoSelectionTitle")}
            description={t("batchDeleteLicensesNoSelectionSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("batchDeleteLicensesBackAction")}
          </Button>
        </div>
      ) : selectedLicenses.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title={t("batchDeleteLicensesNoMatchesTitle")}
            description={t("batchDeleteLicensesNoMatchesSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("batchDeleteLicensesBackAction")}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {t("batchDeleteLicensesSelectedCountLabel")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{selectedLicenses.length}</p>
            </article>
            <article className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {t("batchDeleteLicensesImpactedMembersLabel")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{impactedMembersCount}</p>
            </article>
          </section>

          <section className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {t("batchDeleteLicensesWarning")}
          </section>

          {progress ? (
            <p className="text-sm text-zinc-600">
              {t("batchDeleteLicensesDeletingProgress", {
                current: progress.current,
                total: progress.total,
              })}
            </p>
          ) : null}

          {result ? (
            <section className="space-y-3 rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-900">
                {t("batchDeleteLicensesResultLabel", {
                  deleted: result.deleted,
                  failed: result.failed,
                })}
              </p>
              {result.failedItems.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-zinc-700">
                    {t("batchDeleteLicensesFailedItemsTitle")}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                    {result.failedItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900">{t("batchDeleteLicensesPreviewTitle")}</h2>
            <EntityTable
              columns={[
                { key: "memberLabel", header: t("memberLabel") },
                { key: "clubLabel", header: t("clubLabel") },
                { key: "yearLabel", header: t("yearLabel") },
                {
                  key: "statusLabel",
                  header: t("statusLabel"),
                  render: (row: (typeof previewRows)[number]) => (
                    <StatusBadge label={row.statusLabel} tone={row.statusTone} />
                  ),
                },
              ]}
              rows={previewRows}
            />
          </section>

          <section className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting || selectedLicenses.length === 0}
            >
              {t("batchDeleteLicensesConfirmAction")}
            </Button>
            <Button variant="outline" onClick={handleBack} disabled={isDeleting}>
              {t("batchDeleteLicensesBackAction")}
            </Button>
          </section>
        </div>
      )}
    </LtfAdminLayout>
  );
}
