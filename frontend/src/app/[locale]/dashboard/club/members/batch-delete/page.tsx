"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { License, Member, deleteMember, getLicenses, getMembers } from "@/lib/club-admin-api";
import { apiRequest } from "@/lib/api";

const BATCH_DELETE_STORAGE_KEY = "club_members_batch_delete_payload";

type AuthMeResponse = { role: string };

type BatchDeletePayload = {
  selectedIds: number[];
  selectedClubId: number | null;
};

type DeleteResult = {
  deleted: number;
  failed: number;
  failedItems: string[];
};

function parseBatchDeletePayload(): BatchDeletePayload {
  if (typeof window === "undefined") {
    return { selectedIds: [], selectedClubId: null };
  }
  try {
    const rawValue = window.sessionStorage.getItem(BATCH_DELETE_STORAGE_KEY);
    if (!rawValue) {
      return { selectedIds: [], selectedClubId: null };
    }
    const parsedValue = JSON.parse(rawValue) as {
      selectedIds?: unknown;
      selectedClubId?: unknown;
    };
    const ids = Array.isArray(parsedValue.selectedIds)
      ? parsedValue.selectedIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const selectedClubId = Number(parsedValue.selectedClubId);
    return {
      selectedIds: Array.from(new Set(ids)),
      selectedClubId: Number.isInteger(selectedClubId) && selectedClubId > 0 ? selectedClubId : null,
    };
  } catch {
    return { selectedIds: [], selectedClubId: null };
  }
}

export default function ClubMembersBatchDeletePage() {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";

  const [payload] = useState<BatchDeletePayload>(() => parseBatchDeletePayload());
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<DeleteResult | null>(null);

  const canManageMembers = currentRole === "club_admin";
  const selectedIds = payload.selectedIds;

  const selectedMembers = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return members.filter((member) => {
      if (!selectedSet.has(member.id)) {
        return false;
      }
      if (!payload.selectedClubId) {
        return true;
      }
      return member.club === payload.selectedClubId;
    });
  }, [members, payload.selectedClubId, selectedIds]);

  const licenseCountByMember = useMemo(() => {
    const map = new Map<number, number>();
    licenses.forEach((license) => {
      map.set(license.member, (map.get(license.member) ?? 0) + 1);
    });
    return map;
  }, [licenses]);

  const cascadeLicensesTotal = useMemo(
    () =>
      selectedMembers.reduce(
        (total, member) => total + (licenseCountByMember.get(member.id) ?? 0),
        0
      ),
    [licenseCountByMember, selectedMembers]
  );

  const previewRows = useMemo(
    () =>
      selectedMembers.map((member) => ({
        id: member.id,
        memberLabel: `${member.first_name} ${member.last_name}`,
        ltfLicenseId: member.ltf_licenseid || "—",
        statusLabel: member.is_active ? t("activeLabel") : t("inactiveLabel"),
        statusTone: member.is_active ? "success" : "danger",
        cascadeLabel: String(licenseCountByMember.get(member.id) ?? 0),
      })),
    [licenseCountByMember, selectedMembers, t]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
      setCurrentRole(me.role);
      if (me.role !== "club_admin" || selectedIds.length === 0) {
        setMembers([]);
        setLicenses([]);
        return;
      }
      const [membersResponse, licensesResponse] = await Promise.all([getMembers(), getLicenses()]);
      setMembers(membersResponse);
      setLicenses(licensesResponse);
    } catch (error) {
      setCurrentRole(null);
      setErrorMessage(error instanceof Error ? error.message : t("batchDeleteMembersLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [selectedIds.length, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const clearBatchPayload = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(BATCH_DELETE_STORAGE_KEY);
  };

  const clearMemberSelectionStorage = () => {
    if (typeof window === "undefined") {
      return;
    }
    const selectedIdsStorageKey = `club_members_selected_ids:${payload.selectedClubId ?? "all"}`;
    window.sessionStorage.removeItem(selectedIdsStorageKey);
  };

  const handleBack = () => {
    clearBatchPayload();
    router.push(`/${locale}/dashboard/club/members`);
  };

  const handleConfirmDelete = async () => {
    if (!canManageMembers || selectedMembers.length === 0 || isDeleting) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    setResult(null);
    const total = selectedMembers.length;
    let deleted = 0;
    const failedItems: string[] = [];

    for (let index = 0; index < selectedMembers.length; index += 1) {
      const member = selectedMembers[index];
      setProgress({ current: index + 1, total });
      try {
        await deleteMember(member.id);
        deleted += 1;
      } catch {
        failedItems.push(`${member.first_name} ${member.last_name}`);
      }
    }

    clearBatchPayload();
    clearMemberSelectionStorage();
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
    <ClubAdminLayout title={t("batchDeleteMembersTitle")} subtitle={t("batchDeleteMembersSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : !canManageMembers ? (
        <div className="space-y-4">
          <EmptyState
            title={t("batchDeleteMembersForbiddenTitle")}
            description={t("batchDeleteMembersForbiddenSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("batchDeleteMembersBackAction")}
          </Button>
        </div>
      ) : selectedIds.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title={t("batchDeleteMembersNoSelectionTitle")}
            description={t("batchDeleteMembersNoSelectionSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("batchDeleteMembersBackAction")}
          </Button>
        </div>
      ) : selectedMembers.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title={t("batchDeleteMembersNoMatchesTitle")}
            description={t("batchDeleteMembersNoMatchesSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("batchDeleteMembersBackAction")}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {t("batchDeleteMembersSelectedCountLabel")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{selectedMembers.length}</p>
            </article>
            <article className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {t("batchDeleteMembersCascadeLicensesLabel")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{cascadeLicensesTotal}</p>
            </article>
          </section>

          <section className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {t("batchDeleteMembersWarning")}
          </section>

          {progress ? (
            <p className="text-sm text-zinc-600">
              {t("batchDeleteMembersDeletingProgress", {
                current: progress.current,
                total: progress.total,
              })}
            </p>
          ) : null}

          {result ? (
            <section className="space-y-3 rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-900">
                {t("batchDeleteMembersResultLabel", {
                  deleted: result.deleted,
                  failed: result.failed,
                })}
              </p>
              {result.failedItems.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-zinc-700">
                    {t("batchDeleteMembersFailedItemsTitle")}
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
            <h2 className="text-sm font-semibold text-zinc-900">{t("batchDeleteMembersPreviewTitle")}</h2>
            <EntityTable
              columns={[
                { key: "memberLabel", header: t("memberLabel") },
                { key: "ltfLicenseId", header: t("ltfLicenseLabel") },
                {
                  key: "statusLabel",
                  header: t("statusLabel"),
                  render: (row: (typeof previewRows)[number]) => (
                    <StatusBadge label={row.statusLabel} tone={row.statusTone} />
                  ),
                },
                { key: "cascadeLabel", header: t("batchDeleteMembersCascadeColumnLabel") },
              ]}
              rows={previewRows}
            />
          </section>

          <section className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting || selectedMembers.length === 0}
            >
              {t("batchDeleteMembersConfirmAction")}
            </Button>
            <Button variant="outline" onClick={handleBack} disabled={isDeleting}>
              {t("batchDeleteMembersBackAction")}
            </Button>
          </section>
        </div>
      )}
    </ClubAdminLayout>
  );
}
