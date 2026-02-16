"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import {
  Club,
  License,
  LicenseType,
  Member,
  deleteLicense,
  getClubs,
  getLicenseTypes,
  getLicenses,
  getMembers,
} from "@/lib/ltf-admin-api";

export default function LtfLicenseDeletePage() {
  const t = useTranslations("LtfAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const locale = pathname?.split("/")[1] || "en";

  const parsedLicenseId = Number(params?.id);
  const licenseId = Number.isInteger(parsedLicenseId) && parsedLicenseId > 0 ? parsedLicenseId : null;

  const [license, setLicense] = useState<License | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [licenseTypes, setLicenseTypes] = useState<LicenseType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clubById = useMemo(() => new Map(clubs.map((club) => [club.id, club])), [clubs]);
  const licenseTypeById = useMemo(
    () => new Map(licenseTypes.map((licenseType) => [licenseType.id, licenseType])),
    [licenseTypes]
  );

  const loadData = useCallback(async () => {
    if (!licenseId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [licensesResponse, membersResponse, clubsResponse, licenseTypesResponse] = await Promise.all([
        getLicenses(),
        getMembers(),
        getClubs(),
        getLicenseTypes(),
      ]);
      setMembers(membersResponse);
      setClubs(clubsResponse);
      setLicenseTypes(licenseTypesResponse);
      setLicense(licensesResponse.find((item) => item.id === licenseId) ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("singleDeleteLicenseLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [licenseId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBack = () => {
    router.push(`/${locale}/dashboard/ltf/licenses`);
  };

  const handleConfirmDelete = async () => {
    if (!licenseId || !license || isDeleting || isDeleted) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deleteLicense(licenseId);
      setIsDeleted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("singleDeleteLicenseDeleteError"));
    } finally {
      setIsDeleting(false);
    }
  };

  const member = license ? memberById.get(license.member) : null;
  const club = license ? clubById.get(license.club) : null;
  const licenseType = license ? licenseTypeById.get(license.license_type) : null;
  const statusLabel =
    license?.status === "active"
      ? t("statusActive")
      : license?.status === "expired"
      ? t("statusExpired")
      : license?.status === "revoked"
      ? t("statusRevoked")
      : t("statusPending");

  return (
    <LtfAdminLayout title={t("singleDeleteLicenseTitle")} subtitle={t("singleDeleteLicenseSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : !licenseId || !license ? (
        <div className="space-y-4">
          <EmptyState
            title={t("singleDeleteLicenseNotFoundTitle")}
            description={t("singleDeleteLicenseNotFoundSubtitle")}
          />
          <Button variant="outline" onClick={handleBack}>
            {t("singleDeleteLicenseBackAction")}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-900">{t("singleDeleteLicensePreviewTitle")}</h2>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-zinc-500">{t("memberLabel")}</dt>
                <dd className="font-medium text-zinc-900">
                  {member ? `${member.first_name} ${member.last_name}` : t("unknownMember")}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("clubLabel")}</dt>
                <dd className="font-medium text-zinc-900">{club?.name ?? t("unknownClub")}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("licenseTypeLabel")}</dt>
                <dd className="font-medium text-zinc-900">
                  {licenseType?.name ?? t("unknownLicenseType")}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("yearLabel")}</dt>
                <dd className="font-medium text-zinc-900">{license.year}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("statusLabel")}</dt>
                <dd className="font-medium text-zinc-900">{statusLabel}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">{t("issuedAtLabel")}</dt>
                <dd className="font-medium text-zinc-900">
                  {license.issued_at ? new Date(license.issued_at).toLocaleDateString() : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {t("singleDeleteLicenseWarning")}
          </section>

          {isDeleted ? (
            <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
              {t("singleDeleteLicenseDeletedMessage")}
            </section>
          ) : null}

          <section className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting || isDeleted}
            >
              {t("singleDeleteLicenseConfirmAction")}
            </Button>
            <Button variant="outline" onClick={handleBack} disabled={isDeleting}>
              {t("singleDeleteLicenseBackAction")}
            </Button>
          </section>
        </div>
      )}
    </LtfAdminLayout>
  );
}
