"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

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
  LogoUsageType,
  deleteFederationLogo,
  getFederationLogos,
  getFederationProfile,
  updateFederationLogo,
  updateFederationProfile,
  uploadFederationLogo,
} from "@/lib/ltf-admin-api";

const federationSchema = z.object({
  name: z.string().min(1, "Federation name is required"),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  postal_code: z.string().optional(),
  locality: z.string().optional(),
  iban: z
    .string()
    .optional()
    .refine((value) => !value || isValidIban(value), "Enter a valid IBAN."),
});

type FederationFormValues = z.infer<typeof federationSchema>;

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

export default function LtfAdminSettingsPage() {
  const t = useTranslations("LtfAdmin");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logos, setLogos] = useState<BrandingLogo[]>([]);
  const [isLoadingLogos, setIsLoadingLogos] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUsage, setLogoUsage] = useState<LogoUsageType>("general");
  const [logoLabel, setLogoLabel] = useState("");
  const [markUploadedAsSelected, setMarkUploadedAsSelected] = useState(true);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FederationFormValues>({
    resolver: zodResolver(federationSchema),
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
  const derivedBankName = deriveBankNameFromIban(watchedIban);
  const usageLabelMap: Record<LogoUsageType, string> = useMemo(
    () => ({
      general: t("logoUsageGeneral"),
      invoice: t("logoUsageInvoice"),
      print: t("logoUsagePrint"),
      digital: t("logoUsageDigital"),
    }),
    [t]
  );

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const profile = await getFederationProfile();
      reset({
        name: profile.name,
        address_line1: profile.address_line1 ?? "",
        address_line2: profile.address_line2 ?? "",
        postal_code: profile.postal_code ?? "",
        locality: profile.locality ?? "",
        iban: profile.iban ?? "",
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("federationSettingsLoadError")
      );
    } finally {
      setIsLoading(false);
    }
  }, [reset, t]);

  const loadLogos = useCallback(async () => {
    setIsLoadingLogos(true);
    try {
      const response = await getFederationLogos();
      setLogos(response.logos);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load logos.");
    } finally {
      setIsLoadingLogos(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    void loadLogos();
  }, [loadLogos]);

  const onSubmit = async (values: FederationFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const saved = await updateFederationProfile(values);
      reset({
        name: saved.name,
        address_line1: saved.address_line1 ?? "",
        address_line2: saved.address_line2 ?? "",
        postal_code: saved.postal_code ?? "",
        locality: saved.locality ?? "",
        iban: saved.iban ?? "",
      });
      setSuccessMessage(t("federationSettingsSaved"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("federationSettingsSaveError")
      );
    }
  };

  const handleUploadLogo = async () => {
    if (!logoFile) {
      return;
    }
    setErrorMessage(null);
    setIsUploadingLogo(true);
    try {
      await uploadFederationLogo({
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
    try {
      await updateFederationLogo(logoId, { is_selected: true });
      await loadLogos();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to select logo.");
    }
  };

  const handleDeleteLogo = async (logoId: number) => {
    try {
      await deleteFederationLogo(logoId);
      await loadLogos();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete logo.");
    }
  };

  return (
    <LtfAdminLayout
      title={t("federationSettingsTitle")}
      subtitle={t("federationSettingsSubtitle")}
    >
      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">
            {t("federationSettingsFormTitle")}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            {t("federationSettingsFormSubtitle")}
          </p>

          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-zinc-700">{t("federationNameLabel")}</label>
              <Input placeholder="Luxembourg Taekwondo Federation" {...register("name")} />
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

            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">{t("ibanLabel")}</label>
              <Input placeholder="LU28 0019 4006 4475 0000" {...register("iban")} />
              {errors.iban ? <p className="text-sm text-red-600">{errors.iban.message}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">{t("bankNameLabel")}</label>
              <Input value={derivedBankName || "-"} readOnly />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {t("saveFederationSettings")}
              </Button>
            </div>
          </form>

          {successMessage ? <p className="mt-4 text-sm text-emerald-600">{successMessage}</p> : null}
          {errorMessage ? <p className="mt-4 text-sm text-red-600">{errorMessage}</p> : null}
          </section>

          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">{t("logoSectionTitle")}</h2>
          <p className="mt-2 text-sm text-zinc-500">{t("logoSectionSubtitle")}</p>

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
              <Select value={logoUsage} onValueChange={(value) => setLogoUsage(value as LogoUsageType)}>
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
          ) : logos.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">{t("logoEmptyState")}</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {logos.map((logo) => (
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
      )}
    </LtfAdminLayout>
  );
}
