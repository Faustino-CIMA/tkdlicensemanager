"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { License, Member, deleteMember, getLicenses, getMember } from "@/lib/club-admin-api";
import { apiRequest } from "@/lib/api";

type AuthMeResponse = { role: string };

const BATCH_DELETE_STORAGE_KEY = "club_members_batch_delete_payload";

export default function ClubMemberDeletePage() {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const locale = pathname?.split("/")[1] || "en";

  const parsedMemberId = Number(params?.id);
  const memberId = Number.isInteger(parsedMemberId) && parsedMemberId > 0 ? parsedMemberId : null;

  const [member, setMember] = useState<Member | null>(null);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManageMembers = currentRole === "club_admin";
  const cascadeLicenses = useMemo(() => {
    if (!member) {
      return [];
    }
    return licenses.filter((license) => license.member === member.id);
  }, [licenses, member]);

  const cascadePreviewRows = useMemo(
    () =>
      cascadeLicenses.map((license) => {
        const statusLabel =
          license.status === "active"
            ? t("statusActive")
            : license.status === "expired"
            ? t("statusExpired")
            : t("statusPending");
        const statusTone =
          license.status === "active"
            ? "success"
            : license.status === "expired"
            ? "danger"
            : "warning";
        return {
          id: license.id,
          yearLabel: String(license.year),
          statusLabel,
          statusTone,
        };
      }),
    [cascadeLicenses, t]
  );

  const loadData = useCallback(async () => {
    if (!memberId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
      setCurrentRole(me.role);
      if (me.role !== "club_admin") {
        setMember(null);
        setLicenses([]);
        return;
      }
      try {
        const [memberResponse, licensesResponse] = await Promise.all([
          getMember(memberId),
          getLicenses(),
        ]);
        setMember(memberResponse);
        setLicenses(licensesResponse);
      } catch (error) {
        setMember(null);
        setLicenses([]);
        setErrorMessage(error instanceof Error ? error.message : t("singleDeleteMemberLoadError"));
      }
    } catch (error) {
      setCurrentRole(null);
      setErrorMessage(error instanceof Error ? error.message : t("singleDeleteMemberLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [memberId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const clearSelectionStorage = () => {
    if (typeof window === "undefined") {
      return;
    }
    if (member?.club) {
      window.sessionStorage.removeItem(`club_members_selected_ids:${member.club}`);
    }
    window.sessionStorage.removeItem(BATCH_DELETE_STORAGE_KEY);
  };

  const handleBack = () => {
    router.push(`/${locale}/dashboard/club/members`);
  };

  const handleConfirmDelete = async () => {
    if (!canManageMembers || !member || !memberId || isDeleting || isDeleted) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deleteMember(memberId);
      clearSelectionStorage();
      setIsDeleted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("singleDeleteMemberDeleteError"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ClubAdminLayout title={t("singleDeleteMemberTitle")} subtitle={t("singleDeleteMemberSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : !canManageMembers ? (
        <div className="space-y-4">
          <EmptyState
            title={t("singleDeleteMemberForbiddenTitle")}
            description={t("singleDeleteMemberForbiddenSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("singleDeleteMemberBackAction")}
          </Button>
        </div>
      ) : !memberId || !member ? (
        <div className="space-y-4">
          <EmptyState
            title={t("singleDeleteMemberNotFoundTitle")}
            description={t("singleDeleteMemberNotFoundSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("singleDeleteMemberBackAction")}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-900">{t("singleDeleteMemberPreviewTitle")}</h2>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-zinc-500">{t("memberLabel")}</dt>
                <dd className="font-medium text-zinc-900">
                  {member.first_name} {member.last_name}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("ltfLicenseLabel")}</dt>
                <dd className="font-medium text-zinc-900">{member.ltf_licenseid || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("statusLabel")}</dt>
                <dd className="font-medium text-zinc-900">
                  {member.is_active ? t("activeLabel") : t("inactiveLabel")}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("singleDeleteMemberCascadeCountLabel")}</dt>
                <dd className="font-medium text-zinc-900">{cascadeLicenses.length}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {t("singleDeleteMemberWarning")}
          </section>

          {cascadePreviewRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-900">{t("singleDeleteMemberCascadeTitle")}</h2>
              <EntityTable
                columns={[
                  { key: "yearLabel", header: t("yearLabel") },
                  {
                    key: "statusLabel",
                    header: t("statusLabel"),
                    render: (row: (typeof cascadePreviewRows)[number]) => (
                      <StatusBadge label={row.statusLabel} tone={row.statusTone} />
                    ),
                  },
                ]}
                rows={cascadePreviewRows}
              />
            </section>
          ) : null}

          {isDeleted ? (
            <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
              {t("singleDeleteMemberDeletedMessage")}
            </section>
          ) : null}

          <section className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting || isDeleted}
            >
              {t("singleDeleteMemberConfirmAction")}
            </Button>
            <Button variant="outline" onClick={handleBack} disabled={isDeleting}>
              {t("singleDeleteMemberBackAction")}
            </Button>
          </section>
        </div>
      )}
    </ClubAdminLayout>
  );
}
