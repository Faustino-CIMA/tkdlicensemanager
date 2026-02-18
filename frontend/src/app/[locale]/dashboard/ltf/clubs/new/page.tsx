"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClub } from "@/lib/ltf-admin-api";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  postal_code: z.string().optional(),
  locality: z.string().optional(),
});

type ClubFormValues = z.infer<typeof clubSchema>;

export default function LtfAdminCreateClubPage() {
  const t = useTranslations("LtfAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
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

  const onSubmit = async (values: ClubFormValues) => {
    setErrorMessage(null);
    const payload = {
      ...values,
      address: values.address_line1 ?? "",
      city: values.locality ?? "",
    };
    try {
      await createClub(payload);
      router.push(`/${locale}/dashboard/ltf/clubs`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create club.");
    }
  };

  return (
    <LtfAdminLayout title={t("createClub")} subtitle={t("clubFormSubtitle")}>
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/${locale}/dashboard/ltf/clubs`}>{t("backToClubs")}</Link>
        </Button>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
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

            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit" disabled={isSubmitting}>
                {t("createClub")}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href={`/${locale}/dashboard/ltf/clubs`}>{t("cancelEdit")}</Link>
              </Button>
            </div>
          </form>
        </section>
      </div>
    </LtfAdminLayout>
  );
}
