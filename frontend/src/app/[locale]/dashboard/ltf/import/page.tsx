"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { ImportWizardPage } from "@/components/import/import-wizard-page";
import { getClubs } from "@/lib/ltf-admin-api";

type ClubOption = {
  id: number;
  name: string;
};

export default function LtfImportPage() {
  const t = useTranslations("Import");
  const ltfT = useTranslations("LtfAdmin");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";
  const searchParams = useSearchParams();

  const [clubOptions, setClubOptions] = useState<ClubOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultType = searchParams.get("type") === "members" ? "members" : "clubs";

  useEffect(() => {
    let isMounted = true;
    const loadClubs = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const clubs = await getClubs();
        if (!isMounted) {
          return;
        }
        setClubOptions(clubs.map((club) => ({ id: club.id, name: club.name })));
      } catch (loadError) {
        if (!isMounted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : t("loadClubsFailed"));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadClubs();

    return () => {
      isMounted = false;
    };
  }, [t]);

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

  return (
    <LtfAdminLayout title={t("importWizardTitle")} subtitle={t("wizardSubtitleLtf")}>
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
      {isLoading && clubOptions.length === 0 ? (
        <p className="mb-4 text-sm text-zinc-600">{ltfT("loadingTitle")}</p>
      ) : null}
      <ImportWizardPage
        allowedTypes={["clubs", "members"]}
        defaultType={defaultType}
        allowClubSelection
        clubOptions={clubOptions}
        fieldsByType={fieldsByType}
        backHrefByType={{
          clubs: `/${locale}/dashboard/ltf/clubs`,
          members: `/${locale}/dashboard/ltf/clubs`,
        }}
        successHrefByType={{
          clubs: `/${locale}/dashboard/ltf/clubs`,
          members: `/${locale}/dashboard/ltf/members`,
        }}
      />
    </LtfAdminLayout>
  );
}
