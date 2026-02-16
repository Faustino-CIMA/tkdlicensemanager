"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { getClubs, updateClub } from "@/lib/club-admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  postal_code: z.string().optional(),
  locality: z.string().optional(),
});

type ClubFormValues = z.infer<typeof clubSchema>;

export default function ClubAdminSettingsPage() {
  const t = useTranslations("ClubAdmin");
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClubFormValues>({
    resolver: zodResolver(clubSchema),
    defaultValues: {
      name: "",
      address_line1: "",
      address_line2: "",
      postal_code: "",
      locality: "",
    },
  });

  const loadClubs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const clubsResponse = await getClubs();
      if (clubsResponse.length > 0) {
        const club = clubsResponse[0];
        setSelectedClubId(club.id);
        reset({
          name: club.name,
          address_line1: club.address_line1 ?? club.address ?? "",
          address_line2: club.address_line2 ?? "",
          postal_code: club.postal_code ?? "",
          locality: club.locality ?? club.city ?? "",
        });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load club.");
    } finally {
      setIsLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    void loadClubs();
  }, [loadClubs]);

  const onSubmit = async (values: ClubFormValues) => {
    if (!selectedClubId) {
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await updateClub(selectedClubId, {
        ...values,
        address: values.address_line1 ?? "",
        city: values.locality ?? "",
      });
      setSuccessMessage(t("clubSaved"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update club.");
    }
  };

  return (
    <ClubAdminLayout title={t("clubProfileTitle")} subtitle={t("clubProfileSubtitle")}>
      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : (
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
              <Input placeholder="Building, floor, unit (optional)" {...register("address_line2")} />
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
                {t("saveClub")}
              </Button>
            </div>
          </form>

          {successMessage ? <p className="mt-4 text-sm text-emerald-600">{successMessage}</p> : null}
          {errorMessage ? <p className="mt-4 text-sm text-red-600">{errorMessage}</p> : null}
        </section>
      )}
    </ClubAdminLayout>
  );
}
