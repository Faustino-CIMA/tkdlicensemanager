"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { NmaAdminLayout } from "@/components/nma-admin/nma-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Club,
  addClubAdmin,
  getClub,
  getClubAdmins,
  getEligibleMembers,
  removeClubAdmin,
  setClubMaxAdmins,
} from "@/lib/nma-admin-api";

type TabKey = "overview" | "admins";

export default function NmaClubDetailPage() {
  const t = useTranslations("NmaAdmin");
  const params = useParams();
  const searchParams = useSearchParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const clubId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);
  const initialTab: TabKey = searchParams.get("tab") === "admins" ? "admins" : "overview";

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [club, setClub] = useState<Club | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [clubAdmins, setClubAdmins] = useState<Array<{ id: number; username: string; email: string }>>([]);
  const [eligibleMembers, setEligibleMembers] = useState<Array<{ id: number; label: string }>>([]);
  const [maxAdmins, setMaxAdmins] = useState<number>(10);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");

  const tabItems = useMemo(
    () => [
      { key: "overview" as const, label: t("clubOverviewTab") },
      { key: "admins" as const, label: t("clubAdminsTab") },
    ],
    [t]
  );

  const loadClub = async () => {
    if (!clubId) {
      setErrorMessage(t("unknownClub"));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await getClub(clubId);
      setClub(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load club.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadAdmins = async () => {
    if (!clubId) {
      return;
    }
    setErrorMessage(null);
    try {
      const [adminsResponse, eligibleResponse] = await Promise.all([
        getClubAdmins(clubId),
        getEligibleMembers(clubId),
      ]);
      setClubAdmins(adminsResponse.admins);
      setMaxAdmins(adminsResponse.max_admins);
      setEligibleMembers(eligibleResponse.eligible);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load club admins.");
    }
  };

  useEffect(() => {
    loadClub();
  }, [clubId]);

  useEffect(() => {
    if (activeTab === "admins") {
      loadAdmins();
    }
  }, [activeTab, clubId]);

  const handleAddAdmin = async () => {
    if (!clubId || !selectedMemberId) {
      return;
    }
    try {
      await addClubAdmin(clubId, Number(selectedMemberId));
      await loadAdmins();
      setSelectedMemberId("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to add club admin.");
    }
  };

  const handleRemoveAdmin = async (userId: number) => {
    if (!clubId) {
      return;
    }
    try {
      await removeClubAdmin(clubId, userId);
      await loadAdmins();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to remove club admin.");
    }
  };

  const handleMaxAdminsChange = async (value: string) => {
    if (!clubId) {
      return;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }
    try {
      const response = await setClubMaxAdmins(clubId, parsed);
      setMaxAdmins(response.max_admins);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update admin limit.");
    }
  };

  const title = club ? t("clubDetailTitle", { club: club.name }) : t("clubDetailTitleFallback");

  return (
    <NmaAdminLayout title={title} subtitle={t("clubDetailSubtitle")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${locale}/dashboard/nma/clubs`}>{t("backToClubs")}</Link>
          </Button>
          <div className="flex items-center gap-2">
            {tabItems.map((tab) => (
              <Button
                key={tab.key}
                variant={activeTab === tab.key ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : !club ? (
          <EmptyState title={t("noResultsTitle")} description={t("noClubsResultsSubtitle")} />
        ) : activeTab === "overview" ? (
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("clubOverviewTab")}</h2>
            <div className="mt-4 grid gap-3 text-sm text-zinc-700 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">{t("clubNameLabel")}</span>
                <span className="font-medium">{club.name}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">{t("cityLabel")}</span>
                <span className="font-medium">{club.city || "-"}</span>
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <span className="text-xs text-zinc-500">{t("addressLabel")}</span>
                <span className="font-medium">{club.address || "-"}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">{t("maxAdminsLabel")}</span>
                <span className="font-medium">{club.max_admins}</span>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("clubAdminsTab")}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t("adminsSubtitle")}</p>

            <div className="mt-6 grid gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("maxAdminsLabel")}</label>
                <Input
                  type="number"
                  min={1}
                  value={String(maxAdmins)}
                  onChange={(event) => handleMaxAdminsChange(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("addAdminLabel")}</label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder={t("selectMemberAdminPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleMembers.map((member) => (
                        <SelectItem key={member.id} value={String(member.id)}>
                          {member.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddAdmin}>{t("addAdminAction")}</Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-zinc-700">{t("currentAdminsLabel")}</p>
                {clubAdmins.length === 0 ? (
                  <p className="text-sm text-zinc-500">{t("noAdminsLabel")}</p>
                ) : (
                  <div className="space-y-2">
                    {clubAdmins.map((admin) => (
                      <div
                        key={admin.id}
                        className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2"
                      >
                        <div className="text-sm text-zinc-700">
                          {admin.username} · {admin.email}
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRemoveAdmin(admin.id)}
                        >
                          {t("removeAdminAction")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </NmaAdminLayout>
  );
}
