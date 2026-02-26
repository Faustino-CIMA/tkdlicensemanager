"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { useClubSelection } from "@/components/club-selection-provider";
import { deriveBankNameFromIban, isValidIban } from "@/lib/iban";
import {
  BrandingLogo,
  LogoUsageType,
  deleteClubLogo,
  getClubLogos,
  getClubs,
  updateClub,
  updateClubLogo,
  uploadClubLogo,
} from "@/lib/club-admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  postal_code: z.string().optional(),
  locality: z.string().optional(),
  iban: z.string().optional(),
});

type ClubFormValues = z.infer<typeof clubSchema>;

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

export default function ClubAdminSettingsPage() {
  const t = useTranslations("ClubAdmin");
  const { selectedClubId } = useClubSelection();
  const requestIdRef = useRef(0);
  const logoRequestIdRef = useRef(0);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clubLogos, setClubLogos] = useState<BrandingLogo[]>([]);
  const [isLoadingLogos, setIsLoadingLogos] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUsage, setLogoUsage] = useState<LogoUsageType>("general");
  const [logoLabel, setLogoLabel] = useState("");
  const [markUploadedAsSelected, setMarkUploadedAsSelected] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ClubFormValues>({
    resolver: zodResolver(clubSchema),
    defaultValues: {
      name: "",
      address_line1: "",
      address_line2: "",
      postal_code: "",
      locality: "",
      iban: "",
    },
  });
  const watchedIban = watch("iban");
  const derivedBankName = useMemo(
    () => deriveBankNameFromIban(watchedIban),
    [watchedIban]
  );
  const usageLabelMap: Record<LogoUsageType, string> = {
    general: t("logoUsageGeneral"),
    invoice: t("logoUsageInvoice"),
    print: t("logoUsagePrint"),
    digital: t("logoUsageDigital"),
  };

  const resetToEmpty = useCallback(() => {
    reset({
      name: "",
      address_line1: "",
      address_line2: "",
      postal_code: "",
      locality: "",
      iban: "",
    });
  }, [reset]);

  const loadSelectedClub = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!selectedClubId) {
      resetToEmpty();
      setIsLoading(false);
      return;
    }
    try {
      const clubsResponse = await getClubs();
      if (requestId !== requestIdRef.current) {
        return;
      }
      const club = clubsResponse.find((record) => record.id === selectedClubId);
      if (!club) {
        resetToEmpty();
        return;
      }
      reset({
        name: club.name,
        address_line1: club.address_line1 ?? club.address ?? "",
        address_line2: club.address_line2 ?? "",
        postal_code: club.postal_code ?? "",
        locality: club.locality ?? club.city ?? "",
        iban: club.iban ?? "",
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "Failed to load club.");
      resetToEmpty();
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [reset, resetToEmpty, selectedClubId]);

  const loadLogos = useCallback(async () => {
    const requestId = ++logoRequestIdRef.current;
    if (!selectedClubId) {
      setClubLogos([]);
      setIsLoadingLogos(false);
      return;
    }
    setIsLoadingLogos(true);
    try {
      const response = await getClubLogos(selectedClubId);
      if (requestId !== logoRequestIdRef.current) {
        return;
      }
      setClubLogos(response.logos);
    } catch (error) {
      if (requestId !== logoRequestIdRef.current) {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "Failed to load logos.");
    } finally {
      if (requestId === logoRequestIdRef.current) {
        setIsLoadingLogos(false);
      }
    }
  }, [selectedClubId]);

  useEffect(() => {
    void loadSelectedClub();
  }, [loadSelectedClub]);

  useEffect(() => {
    void loadLogos();
  }, [loadLogos]);

  const onSubmit = async (values: ClubFormValues) => {
    if (!selectedClubId) {
      return;
    }
    const normalizedIban = values.iban?.trim() ?? "";
    if (normalizedIban && !isValidIban(normalizedIban)) {
      setErrorMessage("Enter a valid IBAN.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await updateClub(selectedClubId, {
        ...values,
        iban: normalizedIban,
        address: values.address_line1 ?? "",
        city: values.locality ?? "",
      });
      setSuccessMessage(t("clubSaved"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update club.");
    }
  };

  const handleUploadLogo = async () => {
    if (!selectedClubId || !logoFile) {
      return;
    }
    setIsUploadingLogo(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await uploadClubLogo(selectedClubId, {
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
    if (!selectedClubId) {
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await updateClubLogo(selectedClubId, logoId, { is_selected: true });
      await loadLogos();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to select logo.");
    }
  };

  const handleDeleteLogo = async (logoId: number) => {
    if (!selectedClubId) {
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteClubLogo(selectedClubId, logoId);
      await loadLogos();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete logo.");
    }
  };

  return (
    <ClubAdminLayout title={t("clubProfileTitle")} subtitle={t("clubProfileSubtitle")}>
      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : !selectedClubId ? (
        <EmptyState title={t("clubProfileTitle")} description={t("selectClubPlaceholder")} />
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("clubFormTitle")}</h2>
            <p className="mt-2 text-sm text-zinc-500">{t("clubFormSubtitle")}</p>

            <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-zinc-700">{t("clubNameLabel")}</label>
                <Input placeholder="LTF Central Club" {...register("name")} />
                {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-zinc-700">{t("addressLine1Label")}</label>
                <Input placeholder="12 Rue de la Gare" {...register("address_line1")} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-zinc-700">{t("addressLine2Label")}</label>
                <Input
                  placeholder="Building, floor, unit (optional)"
                  {...register("address_line2")}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("postalCodeLabel")}</label>
                <Input placeholder="1234" {...register("postal_code")} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("localityLabel")}</label>
                <Input placeholder="Luxembourg" {...register("locality")} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-zinc-700">{t("ibanLabel")}</label>
                <Input placeholder="LU00 0000 0000 0000" {...register("iban")} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-zinc-700">{t("bankNameLabel")}</label>
                <Input value={derivedBankName || "-"} readOnly disabled />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isSubmitting}>
                  {t("saveClub")}
                </Button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("logoSectionTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t("logoSectionSubtitle")}</p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-zinc-700">{t("logoLabelInputLabel")}</label>
                <Input
                  value={logoLabel}
                  onChange={(event) => setLogoLabel(event.target.value)}
                  placeholder={t("logoLabelPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("logoUsageLabel")}</label>
                <Select value={logoUsage} onValueChange={(value) => setLogoUsage(value as LogoUsageType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">{t("logoUsageGeneral")}</SelectItem>
                    <SelectItem value="invoice">{t("logoUsageInvoice")}</SelectItem>
                    <SelectItem value="print">{t("logoUsagePrint")}</SelectItem>
                    <SelectItem value="digital">{t("logoUsageDigital")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("markLogoSelectedLabel")}</label>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={markUploadedAsSelected}
                    onChange={(event) => setMarkUploadedAsSelected(event.target.checked)}
                  />
                  {t("markLogoSelectedLabel")}
                </label>
              </div>
            </div>

            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => logoFileInputRef.current?.click()}>
                {t("chooseLogoFileAction")}
              </Button>
              <Button type="button" onClick={handleUploadLogo} disabled={!logoFile || isUploadingLogo}>
                {isUploadingLogo ? t("savingAction") : t("uploadLogoAction")}
              </Button>
            </div>

            {logoFile ? (
              <p className="mt-2 text-xs text-zinc-500">
                {t("selectedFileLabel")}: {logoFile.name} ({formatFileSize(logoFile.size)})
              </p>
            ) : null}

            {isLoadingLogos ? (
              <p className="mt-4 text-sm text-zinc-600">{t("loadingSubtitle")}</p>
            ) : clubLogos.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">{t("logoEmptyState")}</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {clubLogos.map((logo) => (
                  <article key={logo.id} className="rounded-xl border border-zinc-200 p-3">
                    <div className="flex items-start gap-3">
                      {logo.content_url ? (
                        <img
                          src={logo.content_url}
                          alt={logo.label || logo.file_name}
                          className="h-16 w-16 rounded object-contain"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500">
                          {t("noPreviewAvailable")}
                        </div>
                      )}
                      <div className="min-w-0 flex-1 text-xs text-zinc-600">
                        <p className="truncate font-medium text-zinc-800">
                          {logo.label || logo.file_name}
                        </p>
                        <p>
                          {t("logoUsageLabel")}: {usageLabelMap[logo.usage_type]}
                        </p>
                        <p>{formatFileSize(logo.file_size)}</p>
                        {logo.is_selected ? (
                          <p className="font-medium text-emerald-700">{t("logoSelectedBadge")}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
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
                        variant="outline"
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

          {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}
          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
        </div>
      )}
    </ClubAdminLayout>
  );
}
