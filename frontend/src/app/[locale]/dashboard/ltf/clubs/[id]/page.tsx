"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  BrandingLogoUploadPayload,
  BrandingLogosManager,
} from "@/components/branding/branding-logos-manager";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormPanel, PageNotice } from "@/components/ui/list-page-chrome";
import { deriveBankNameFromIban, isValidIban } from "@/lib/iban";
import {
  BrandingLogo,
  Club,
  deleteClubLogo,
  getClub,
  getClubLogos,
  updateClub,
  updateClubLogo,
  uploadClubLogo,
} from "@/lib/ltf-admin-api";

type ClubEditValues = {
  name: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  locality: string;
  iban: string;
  email: string;
};

function toClubEditValues(club: Club): ClubEditValues {
  return {
    name: club.name ?? "",
    address_line1: club.address_line1 || club.address || "",
    address_line2: club.address_line2 ?? "",
    postal_code: club.postal_code ?? "",
    locality: club.locality || club.city || "",
    iban: club.iban ?? "",
    email: club.email ?? "",
  };
}

export default function LtfClubDetailPage() {
  const t = useTranslations("LtfAdmin");
  const params = useParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const clubId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);

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
    email: "",
  });

  const [clubLogos, setClubLogos] = useState<BrandingLogo[]>([]);
  const [isLoadingLogos, setIsLoadingLogos] = useState(false);
  const [logosLoadError, setLogosLoadError] = useState<string | null>(null);

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
    setLogosLoadError(null);
    try {
      const response = await getClubLogos(clubId);
      setClubLogos(response.logos);
    } catch (error) {
      setLogosLoadError(error instanceof Error ? error.message : "Failed to load logos.");
    } finally {
      setIsLoadingLogos(false);
    }
  }, [clubId]);

  useEffect(() => {
    void loadClub();
  }, [loadClub]);

  useEffect(() => {
    void loadLogos();
  }, [loadLogos]);

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
        email: editValues.email.trim(),
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

  const handleUploadLogo = async (payload: BrandingLogoUploadPayload) => {
    if (!clubId) {
      throw new Error("Club not found.");
    }
    await uploadClubLogo(clubId, payload);
    await loadLogos();
  };

  const handleSelectLogo = async (logoId: number) => {
    if (!clubId) {
      throw new Error("Club not found.");
    }
    await updateClubLogo(clubId, logoId, { is_selected: true });
    await loadLogos();
  };

  const handleDeleteLogo = async (logoId: number) => {
    if (!clubId) {
      throw new Error("Club not found.");
    }
    await deleteClubLogo(clubId, logoId);
    await loadLogos();
  };

  const title = club ? t("clubDetailTitle", { club: club.name }) : t("clubDetailTitleFallback");
  const derivedBankName = deriveBankNameFromIban(editValues.iban) || club?.bank_name || "";

  return (
    <LtfAdminLayout title={title} subtitle={t("clubDetailSubtitle")}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <Button variant="outline" className="w-fit" asChild>
            <Link href={`/${locale}/dashboard/ltf/clubs`}>{t("backToClubs")}</Link>
          </Button>
        </div>

        {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : !club ? (
          <EmptyState title={t("noResultsTitle")} description={t("noClubsResultsSubtitle")} />
        ) : (
          <div className="space-y-6">
            <FormPanel>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-section text-foreground">{t("clubOverviewTab")}</h2>
                {!isEditingOverview ? (
                  <Button size="sm" variant="outline" onClick={() => setIsEditingOverview(true)}>
                    {t("editAction")}
                  </Button>
                ) : null}
              </div>

              {!isEditingOverview ? (
                <div className="mt-4 grid gap-3 text-sm text-foreground md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("clubNameLabel")}</span>
                    <span className="font-medium">{club.name}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("postalCodeLabel")}</span>
                    <span className="font-medium">{club.postal_code || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("localityLabel")}</span>
                    <span className="font-medium">{club.locality || club.city || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs text-muted">{t("addressLine1Label")}</span>
                    <span className="font-medium">{club.address_line1 || club.address || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs text-muted">{t("addressLine2Label")}</span>
                    <span className="font-medium">{club.address_line2 || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs text-muted">{t("clubEmailLabel")}</span>
                    <span className="font-medium">{club.email || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("ibanLabel")}</span>
                    <span className="font-medium">{club.iban || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("bankNameLabel")}</span>
                    <span className="font-medium">{club.bank_name || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("maxAdminsLabel")}</span>
                    <span className="font-medium">{club.max_admins}</span>
                  </div>
                </div>
              ) : (
                <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleSaveOverview}>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-foreground">{t("clubNameLabel")}</label>
                    <Input
                      value={editValues.name}
                      onChange={(event) => handleOverviewFieldChange("name", event.target.value)}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-foreground">{t("addressLine1Label")}</label>
                    <Input
                      value={editValues.address_line1}
                      onChange={(event) =>
                        handleOverviewFieldChange("address_line1", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-foreground">{t("addressLine2Label")}</label>
                    <Input
                      value={editValues.address_line2}
                      onChange={(event) =>
                        handleOverviewFieldChange("address_line2", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("postalCodeLabel")}</label>
                    <Input
                      value={editValues.postal_code}
                      onChange={(event) =>
                        handleOverviewFieldChange("postal_code", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("localityLabel")}</label>
                    <Input
                      value={editValues.locality}
                      onChange={(event) =>
                        handleOverviewFieldChange("locality", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-foreground">{t("clubEmailLabel")}</label>
                    <Input
                      type="email"
                      value={editValues.email}
                      onChange={(event) => handleOverviewFieldChange("email", event.target.value)}
                      placeholder="club@example.com"
                    />
                    <p className="text-xs text-muted">{t("clubEmailHint")}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("ibanLabel")}</label>
                    <Input
                      value={editValues.iban}
                      onChange={(event) => handleOverviewFieldChange("iban", event.target.value)}
                      placeholder="LU28 0019 4006 4475 0000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("bankNameLabel")}</label>
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
            </FormPanel>

            <BrandingLogosManager
              logos={clubLogos}
              isLoading={isLoadingLogos}
              loadError={logosLoadError}
              onUpload={handleUploadLogo}
              onSelect={handleSelectLogo}
              onDelete={handleDeleteLogo}
            />
          </div>
        )}
      </div>
    </LtfAdminLayout>
  );
}
