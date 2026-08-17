"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  BrandingLogoUploadPayload,
  BrandingLogosManager,
} from "@/components/branding/branding-logos-manager";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deriveBankNameFromIban, isValidIban } from "@/lib/iban";
import {
  BrandingLogo,
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

export default function LtfAdminSettingsPage() {
  const t = useTranslations("LtfAdmin");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logos, setLogos] = useState<BrandingLogo[]>([]);
  const [isLoadingLogos, setIsLoadingLogos] = useState(false);
  const [logosLoadError, setLogosLoadError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
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
  const watchedIban = useWatch({ control, name: "iban", defaultValue: "" });
  const derivedBankName = deriveBankNameFromIban(watchedIban);

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
      setLogosLoadError(null);
    } catch (error) {
      setLogosLoadError(error instanceof Error ? error.message : "Failed to load logos.");
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

  const handleUploadLogo = async (payload: BrandingLogoUploadPayload) => {
    await uploadFederationLogo(payload);
    await loadLogos();
  };

  const handleSelectLogo = async (logoId: number) => {
    await updateFederationLogo(logoId, { is_selected: true });
    await loadLogos();
  };

  const handleDeleteLogo = async (logoId: number) => {
    await deleteFederationLogo(logoId);
    await loadLogos();
  };

  return (
    <LtfAdminLayout
      title={t("federationSettingsTitle")}
      subtitle={t("federationSettingsSubtitle")}
    >
      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : (
        <div className="space-y-4">
          <section className="rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">
            {t("federationSettingsFormTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {t("federationSettingsFormSubtitle")}
          </p>

          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground">{t("federationNameLabel")}</label>
              <Input placeholder="Luxembourg Taekwondo Federation" {...register("name")} />
              {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground">{t("addressLine1Label")}</label>
              <Input placeholder="12 Rue de la Gare" {...register("address_line1")} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground">{t("addressLine2Label")}</label>
              <Input
                placeholder="Building, floor, unit (optional)"
                {...register("address_line2")}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("postalCodeLabel")}</label>
              <Input placeholder="1234" {...register("postal_code")} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("localityLabel")}</label>
              <Input placeholder="Luxembourg" {...register("locality")} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("ibanLabel")}</label>
              <Input placeholder="LU28 0019 4006 4475 0000" {...register("iban")} />
              {errors.iban ? <p className="text-sm text-destructive">{errors.iban.message}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("bankNameLabel")}</label>
              <Input value={derivedBankName || "-"} readOnly />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {t("saveFederationSettings")}
              </Button>
            </div>
          </form>

          {successMessage ? (
            <p className="banner-success mt-4 rounded-[var(--radius-form)] border px-3 py-2 text-sm">
              {successMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="banner-danger mt-4 rounded-[var(--radius-form)] border px-3 py-2 text-sm">
              {errorMessage}
            </p>
          ) : null}
          </section>

          <BrandingLogosManager
            logos={logos}
            isLoading={isLoadingLogos}
            loadError={logosLoadError}
            onUpload={handleUploadLogo}
            onSelect={handleSelectLogo}
            onDelete={handleDeleteLogo}
          />
        </div>
      )}
    </LtfAdminLayout>
  );
}
