"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { useClubSelection } from "@/components/club-selection-provider";
import {
  Club,
  License,
  Member,
  getClubs,
  getLicenses,
  getMembers,
} from "@/lib/club-admin-api";

export default function ClubAdminOverviewPage() {
  const t = useTranslations("ClubAdmin");
  const { selectedClubId, setSelectedClubId, clubs: storedClubs } = useClubSelection();
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
        if (clubsResponse.length > 0 && !selectedClubId) {
          setSelectedClubId(clubsResponse[0].id);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load overview.");
      } finally {
        setIsLoading(false);
      }
    };

    loadOverview();
  }, []);

  const filteredMembers = useMemo(() => {
    if (!selectedClubId) {
      return members;
    }
    return members.filter((member) => member.club === selectedClubId);
  }, [members, selectedClubId]);

  const filteredLicenses = useMemo(() => {
    if (!selectedClubId) {
      return licenses;
    }
    return licenses.filter((license) => license.club === selectedClubId);
  }, [licenses, selectedClubId]);

  const activeLicenses = filteredLicenses.filter((license) => license.status === "active");
  const pendingLicenses = filteredLicenses.filter((license) => license.status === "pending");

  return (
    <ClubAdminLayout title={t("overviewTitle")} subtitle={t("overviewSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title={t("totalMembers")} value={String(filteredMembers.length)} />
          <SummaryCard title={t("totalLicenses")} value={String(filteredLicenses.length)} />
          <SummaryCard title={t("activeLicenses")} value={String(activeLicenses.length)} />
          <SummaryCard title={t("pendingLicenses")} value={String(pendingLicenses.length)} />
        </section>
      )}
    </ClubAdminLayout>
  );
}
