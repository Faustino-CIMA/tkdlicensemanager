"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
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
import { deriveBankNameFromIban, isValidIban } from "@/lib/iban";
import {
  BrandingLogo,
  Club,
  LogoUsageType,
  addClubAdmin,
  deleteClubLogo,
  getClub,
  getClubAdmins,
  getClubLogos,
  getEligibleMembers,
  removeClubAdmin,
  setClubMaxAdmins,
  updateClub,
  updateClubLogo,
  uploadClubLogo,
} from "@/lib/ltf-admin-api";

type TabKey = "overview" | "admins";

type ClubEditValues = {
  name: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  locality: string;
  iban: string;
};

function toClubEditValues(club: Club): ClubEditValues {
  return {
    name: club.name ?? "",
    address_line1: club.address_line1 || club.address || "",
    address_line2: club.address_line2 ?? "",
    postal_code: club.postal_code ?? "",
    locality: club.locality || club.city || "",
    iban: club.iban ?? "",
  };
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return "-";
  }
  const kb = 1024;
  const mb = kb * 1024;
  if (bytes >= mb) {
    return `${(bytes / mb).toFixed(2)} MB`;
  }
  return `${(bytes / kb).toFixed(1)} KB`;
}

export default function LtfClubDetailPage() {
  const t = useTranslations("LtfAdmin");
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
  const [isEditingOverview, setIsEditingOverview] = useState(false);
  const [isSavingOverview, setIsSavingOverview] = useState(false);
  const [editValues, setEditValues] = useState<ClubEditValues>({
    name: "",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    locality: "",
    iban: "",
  });

  const [clubAdmins, setClubAdmins] = useState<Array<{ id: number; username: string; email: string }>>([]);
  const [eligibleMembers, setEligibleMembers] = useState<Array<{ id: number; label: string }>>([]);
  const [maxAdmins, setMaxAdmins] = useState<number>(10);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [clubLogos, setClubLogos] = useState<BrandingLogo[]>([]);
  const [isLoadingLogos, setIsLoadingLogos] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUsage, setLogoUsage] = useState<LogoUsageType>("general");
  const [logoLabel, setLogoLabel] = useState("");
  const [markUploadedAsSelected, setMarkUploadedAsSelected] = useState(true);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const tabItems = useMemo(
    () => [
      { key: "overview" as const, label: t("clubOverviewTab") },
      { key: "admins" as const, label: t("clubAdminsTab") },
    ],
    [t]
  );

  const loadClub = useCallback(async () => {
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
      setEditValues(toClubEditValues(response));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load club.");
    } finally {
      setIsLoading(false);
    }
  }, [clubId, t]);

  const loadLogos = useCallback(async () => {
    if (!clubId) {
      return;
    }
    setIsLoadingLogos(true);
    try {
      const response = await getClubLogos(clubId);
      setClubLogos(response.logos);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load logos.");
    } finally {
      setIsLoadingLogos(false);
    }
  }, [clubId]);

  const loadAdmins = useCallback(async () => {
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
  }, [clubId]);

  useEffect(() => {
    void loadClub();
  }, [loadClub]);

  useEffect(() => {
    if (activeTab === "admins") {
      void loadAdmins();
    }
  }, [activeTab, loadAdmins]);

  useEffect(() => {
    if (activeTab === "overview") {
      void loadLogos();
    }
  }, [activeTab, loadLogos]);

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

  const handleOverviewFieldChange = (field: keyof ClubEditValues, value: string) => {
    setEditValues((previous) => ({ ...previous, [field]: value }));
  };

  const handleCancelOverviewEdit = () => {
    if (club) {
      setEditValues(toClubEditValues(club));
    }
    setIsEditingOverview(false);
  };

  const handleSaveOverview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!clubId) {
      return;
    }
    const postalCode = editValues.postal_code.trim();
    const normalizedIban = editValues.iban.trim();
    if (postalCode && !/^\d{4}$/.test(postalCode)) {
      setErrorMessage("Postal code must be 4 digits for Luxembourg.");
      return;
    }
    if (normalizedIban && !isValidIban(normalizedIban)) {
      setErrorMessage("Enter a valid IBAN.");
      return;
    }
    setIsSavingOverview(true);
    setErrorMessage(null);
    try {
      const payload = {
        name: editValues.name.trim(),
        address_line1: editValues.address_line1.trim(),
        address_line2: editValues.address_line2.trim(),
        postal_code: postalCode,
        locality: editValues.locality.trim(),
        iban: normalizedIban,
        city: editValues.locality.trim(),
        address: editValues.address_line1.trim(),
      };
      const updated = await updateClub(clubId, payload);
      setClub(updated);
      setEditValues(toClubEditValues(updated));
      setIsEditingOverview(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save club details.");
    } finally {
      setIsSavingOverview(false);
    }
  };

  const handleUploadLogo = async () => {
    if (!clubId || !logoFile) {
      return;
    }
    setIsUploadingLogo(true);
    setErrorMessage(null);
    try {
      await uploadClubLogo(clubId, {
        file: logoFile,
        usage_type: logoUsage,
        label: logoLabel.trim(),
        is_selected: markUploadedAsSelected,
      });
      setLogoFile(null);
      setLogoLabel("");
      setMarkUploadedAsSelected(true);
      if (logoFileInputRef.current) {
        logoFileInputRef.current.value = "";
      }
      await loadLogos();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to upload logo.");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSelectLogo = async (logoId: number) => {
    if (!clubId) {
      return;
    }
    try {
      await updateClubLogo(clubId, logoId, { is_selected: true });
      await loadLogos();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to select logo.");
    }
  };

  const handleDeleteLogo = async (logoId: number) => {
    if (!clubId) {
      return;
    }
    try {
      await deleteClubLogo(clubId, logoId);
      await loadLogos();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete logo.");
    }
  };

  const title = club ? t("clubDetailTitle", { club: club.name }) : t("clubDetailTitleFallback");
  const derivedBankName = deriveBankNameFromIban(editValues.iban) || club?.bank_name || "";
  const usageLabelMap: Record<LogoUsageType, string> = {
    general: t("logoUsageGeneral"),
    invoice: t("logoUsageInvoice"),
    print: t("logoUsagePrint"),
    digital: t("logoUsageDigital"),
  };

  return (
    <LtfAdminLayout title={title} subtitle={t("clubDetailSubtitle")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${locale}/dashboard/ltf/clubs`}>{t("backToClubs")}</Link>
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
          <div className="space-y-4">
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-zinc-900">{t("clubOverviewTab")}</h2>
                {!isEditingOverview ? (
                  <Button size="sm" variant="outline" onClick={() => setIsEditingOverview(true)}>
                    {t("editAction")}
                  </Button>
                ) : null}
              </div>

              {!isEditingOverview ? (
                <div className="mt-4 grid gap-3 text-sm text-zinc-700 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{t("clubNameLabel")}</span>
                    <span className="font-medium">{club.name}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{t("postalCodeLabel")}</span>
                    <span className="font-medium">{club.postal_code || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{t("localityLabel")}</span>
                    <span className="font-medium">{club.locality || club.city || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs text-zinc-500">{t("addressLine1Label")}</span>
                    <span className="font-medium">{club.address_line1 || club.address || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs text-zinc-500">{t("addressLine2Label")}</span>
                    <span className="font-medium">{club.address_line2 || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{t("ibanLabel")}</span>
                    <span className="font-medium">{club.iban || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{t("bankNameLabel")}</span>
                    <span className="font-medium">{club.bank_name || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{t("maxAdminsLabel")}</span>
                    <span className="font-medium">{club.max_admins}</span>
                  </div>
                </div>
              ) : (
                <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleSaveOverview}>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-zinc-700">{t("clubNameLabel")}</label>
                    <Input
                      value={editValues.name}
                      onChange={(event) => handleOverviewFieldChange("name", event.target.value)}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-zinc-700">{t("addressLine1Label")}</label>
                    <Input
                      value={editValues.address_line1}
                      onChange={(event) =>
                        handleOverviewFieldChange("address_line1", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-zinc-700">{t("addressLine2Label")}</label>
                    <Input
                      value={editValues.address_line2}
                      onChange={(event) =>
                        handleOverviewFieldChange("address_line2", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">{t("postalCodeLabel")}</label>
                    <Input
                      value={editValues.postal_code}
                      onChange={(event) =>
                        handleOverviewFieldChange("postal_code", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">{t("localityLabel")}</label>
                    <Input
                      value={editValues.locality}
                      onChange={(event) =>
                        handleOverviewFieldChange("locality", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">{t("ibanLabel")}</label>
                    <Input
                      value={editValues.iban}
                      onChange={(event) => handleOverviewFieldChange("iban", event.target.value)}
                      placeholder="LU28 0019 4006 4475 0000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">{t("bankNameLabel")}</label>
                    <Input value={derivedBankName || "-"} readOnly />
                  </div>
                  <div className="flex items-center gap-2 md:col-span-2">
                    <Button type="submit" disabled={isSavingOverview}>
                      {isSavingOverview ? t("savingAction") : t("saveChanges")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCancelOverviewEdit}
                      disabled={isSavingOverview}
                    >
                      {t("cancelEdit")}
                    </Button>
                  </div>
                </form>
              )}
            </section>

            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900">{t("logoSectionTitle")}</h2>
              <p className="mt-1 text-sm text-zinc-500">{t("logoSectionSubtitle")}</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700">{t("logoLabelInputLabel")}</label>
                  <Input
                    value={logoLabel}
                    onChange={(event) => setLogoLabel(event.target.value)}
                    placeholder={t("logoLabelPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700">{t("logoUsageLabel")}</label>
                  <Select
                    value={logoUsage}
                    onValueChange={(value) => setLogoUsage(value as LogoUsageType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(usageLabelMap).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="outline" onClick={() => logoFileInputRef.current?.click()}>
                  {t("chooseLogoFileAction")}
                </Button>
                <label className="flex items-center gap-2 text-sm text-zinc-600">
                  <input
                    type="checkbox"
                    checked={markUploadedAsSelected}
                    onChange={(event) => setMarkUploadedAsSelected(event.target.checked)}
                  />
                  {t("markLogoSelectedLabel")}
                </label>
                <Button type="button" onClick={handleUploadLogo} disabled={!logoFile || isUploadingLogo}>
                  {isUploadingLogo ? t("savingAction") : t("uploadLogoAction")}
                </Button>
              </div>

              {logoFile ? (
                <p className="mt-2 text-sm text-zinc-600">
                  {t("selectedFileLabel")}: {logoFile.name} ({formatFileSize(logoFile.size)})
                </p>
              ) : null}

              {isLoadingLogos ? (
                <p className="mt-4 text-sm text-zinc-600">{t("loadingTitle")}</p>
              ) : clubLogos.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">{t("logoEmptyState")}</p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {clubLogos.map((logo) => (
                    <article key={logo.id} className="rounded-xl border border-zinc-200 p-3">
                      <div className="aspect-[16/9] w-full overflow-hidden rounded-md bg-zinc-100">
                        {logo.content_url ? (
                          <img
                            src={logo.content_url}
                            alt={logo.label || logo.file_name}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                            {t("noPreviewAvailable")}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-zinc-600">
                        <p className="font-medium text-zinc-800">{logo.label || logo.file_name}</p>
                        <p>
                          {t("logoUsageLabel")}: {usageLabelMap[logo.usage_type]}
                        </p>
                        <p>{formatFileSize(logo.file_size)}</p>
                        {logo.is_selected ? (
                          <p className="font-medium text-emerald-700">{t("logoSelectedBadge")}</p>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        {!logo.is_selected ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleSelectLogo(logo.id)}
                          >
                            {t("selectLogoAction")}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteLogo(logo.id)}
                        >
                          {t("deleteAction")}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
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
    </LtfAdminLayout>
  );
}
