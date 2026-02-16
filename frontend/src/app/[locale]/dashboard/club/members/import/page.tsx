"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { useClubSelection } from "@/components/club-selection-provider";
import { ImportWizardPage } from "@/components/import/import-wizard-page";

export default function ClubMembersImportPage() {
  const t = useTranslations("Import");
  const clubT = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";
  const { clubs, selectedClubId, isLoading } = useClubSelection();

  const clubOptions = useMemo(
    () => clubs.map((club) => ({ id: club.id, name: club.name })),
    [clubs]
  );

  const fieldsByType = useMemo(
    () => ({
      clubs: [
        { key: "name", label: t("clubNameLabel"), required: true },
        { key: "address_line1", label: t("addressLine1Label") },
        { key: "address_line2", label: t("addressLine2Label") },
        { key: "postal_code", label: t("postalCodeLabel") },
        { key: "locality", label: t("localityLabel") },
      ],
      members: [
        { key: "first_name", label: t("firstNameLabel"), required: true },
        { key: "last_name", label: t("lastNameLabel"), required: true },
        { key: "sex", label: t("sexLabel") },
        { key: "email", label: t("emailLabel") },
        { key: "date_of_birth", label: t("dobLabel") },
        { key: "belt_rank", label: t("beltRankLabel") },
        { key: "wt_licenseid", label: t("wtLicenseLabel") },
        { key: "ltf_licenseid", label: t("ltfLicenseLabel") },
        { key: "primary_license_role", label: t("primaryLicenseRoleLabel") },
        { key: "secondary_license_role", label: t("secondaryLicenseRoleLabel") },
        { key: "is_active", label: t("isActiveLabel") },
      ],
    }),
    [t]
  );

  if (isLoading && clubs.length === 0) {
    return (
      <ClubAdminLayout title={t("importMembers")} subtitle={t("wizardSubtitleMembers")}>
        <EmptyState title={clubT("loadingTitle")} description={clubT("loadingSubtitle")} />
      </ClubAdminLayout>
    );
  }

  if (clubs.length === 0 || !selectedClubId) {
    return (
      <ClubAdminLayout title={t("importMembers")} subtitle={t("wizardSubtitleMembers")}>
        <EmptyState title={t("noClubAvailableTitle")} description={t("noClubAvailableSubtitle")} />
      </ClubAdminLayout>
    );
  }

  return (
    <ClubAdminLayout title={t("importMembers")} subtitle={t("wizardSubtitleMembers")}>
      <ImportWizardPage
        allowedTypes={["members"]}
        defaultType="members"
        fixedClubId={selectedClubId}
        allowClubSelection={false}
        clubOptions={clubOptions}
        fieldsByType={fieldsByType}
        backHrefByType={{
          clubs: `/${locale}/dashboard/club/members`,
          members: `/${locale}/dashboard/club/members`,
        }}
        successHrefByType={{
          clubs: `/${locale}/dashboard/club/members`,
          members: `/${locale}/dashboard/club/members`,
        }}
      />
    </ClubAdminLayout>
  );
}
