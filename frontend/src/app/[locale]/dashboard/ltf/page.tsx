"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { Club, License, Member, getClubs, getLicenses, getMembers } from "@/lib/ltf-admin-api";

export default function LtfAdminOverviewPage() {
  const t = useTranslations("LtfAdmin");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadOverview = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [clubsResponse, membersResponse, licensesResponse] = await Promise.all([
          getClubs(),
          getMembers(),
          getLicenses(),
        ]);
        setClubs(clubsResponse);
        setMembers(membersResponse);
        setLicenses(licensesResponse);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load overview.");
      } finally {
        setIsLoading(false);
      }
    };

    loadOverview();
  }, []);

  const activeLicenses = useMemo(
    () => licenses.filter((license) => license.status === "active"),
    [licenses]
  );
  const pendingLicenses = useMemo(
    () => licenses.filter((license) => license.status === "pending"),
    [licenses]
  );

  return (
    <LtfAdminLayout title={t("overviewTitle")} subtitle={t("overviewSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title={t("totalClubs")} value={String(clubs.length)} />
          <SummaryCard title={t("totalMembers")} value={String(members.length)} />
          <SummaryCard title={t("activeLicenses")} value={String(activeLicenses.length)} />
          <SummaryCard title={t("pendingLicenses")} value={String(pendingLicenses.length)} />
        </section>
      )}
    </LtfAdminLayout>
  );
}
