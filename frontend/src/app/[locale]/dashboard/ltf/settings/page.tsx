"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFederationProfile, updateFederationProfile } from "@/lib/ltf-admin-api";

const federationSchema = z.object({
  name: z.string().min(1, "Federation name is required"),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  postal_code: z.string().optional(),
  locality: z.string().optional(),
});

type FederationFormValues = z.infer<typeof federationSchema>;

export default function LtfAdminSettingsPage() {
  const t = useTranslations("LtfAdmin");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FederationFormValues>({
    resolver: zodResolver(federationSchema),
    defaultValues: {
      name: "",
      address_line1: "",
      address_line2: "",
      postal_code: "",
      locality: "",
    },
  });

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
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("federationSettingsLoadError")
      );
    } finally {
      setIsLoading(false);
    }
  }, [reset, t]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const onSubmit = async (values: FederationFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await updateFederationProfile(values);
      setSuccessMessage(t("federationSettingsSaved"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("federationSettingsSaveError")
      );
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

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {t("saveFederationSettings")}
              </Button>
            </div>
          </form>

          {successMessage ? <p className="mt-4 text-sm text-emerald-600">{successMessage}</p> : null}
          {errorMessage ? <p className="mt-4 text-sm text-red-600">{errorMessage}</p> : null}
        </section>
      )}
    </LtfAdminLayout>
  );
}
