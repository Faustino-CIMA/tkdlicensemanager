"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { useClubSelection } from "@/components/club-selection-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/api";
import { Club, createMember, getClubs } from "@/lib/club-admin-api";

const LICENSE_ROLE_VALUES = [
  "athlete",
  "coach",
  "referee",
  "official",
  "doctor",
  "physiotherapist",
] as const;

const createMemberSchema = z
  .object({
    club: z.string().min(1, "Club is required"),
    first_name: z.string().trim().min(1, "First name is required"),
    last_name: z.string().trim().min(1, "Last name is required"),
    sex: z.enum(["M", "F"]),
    wt_licenseid: z.string().max(20, "WT license ID must be at most 20 characters."),
    ltf_license_prefix: z.enum(["LTF", "LUX"]),
    date_of_birth: z.string().optional(),
    belt_rank: z.string().optional(),
    primary_license_role: z.enum(LICENSE_ROLE_VALUES).or(z.literal("")).optional(),
    secondary_license_role: z.enum(LICENSE_ROLE_VALUES).or(z.literal("")).optional(),
    is_active: z.boolean(),
  })
  .superRefine((values, context) => {
    if (values.secondary_license_role && !values.primary_license_role) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondary_license_role"],
        message: "Secondary role requires a primary role.",
      });
    }
    if (
      values.primary_license_role &&
      values.secondary_license_role &&
      values.primary_license_role === values.secondary_license_role
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondary_license_role"],
        message: "Secondary role must differ from primary role.",
      });
    }
  });

type CreateMemberFormValues = z.infer<typeof createMemberSchema>;
type AuthMeResponse = { role: string };

export default function ClubAdminMemberCreatePage() {
  const t = useTranslations("ClubAdmin");
  const importT = useTranslations("Import");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const { selectedClubId, setSelectedClubId } = useClubSelection();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateMemberFormValues>({
    resolver: zodResolver(createMemberSchema),
    defaultValues: {
      club: "",
      first_name: "",
      last_name: "",
      sex: "M",
      wt_licenseid: "",
      ltf_license_prefix: "LTF",
      date_of_birth: "",
      belt_rank: "",
      primary_license_role: "",
      secondary_license_role: "",
      is_active: true,
    },
  });

  const roleLabelByValue = useMemo(
    () => ({
      athlete: t("licenseRoleAthlete"),
      coach: t("licenseRoleCoach"),
      referee: t("licenseRoleReferee"),
      official: t("licenseRoleOfficial"),
      doctor: t("licenseRoleDoctor"),
      physiotherapist: t("licenseRolePhysiotherapist"),
    }),
    [t]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [clubsResponse, meResponse] = await Promise.all([
        getClubs(),
        apiRequest<AuthMeResponse>("/api/auth/me/"),
      ]);
      setClubs(clubsResponse);
      setCurrentRole(meResponse.role);

      if (clubsResponse.length > 0) {
        const preferredClubId =
          selectedClubId && clubsResponse.some((club) => club.id === selectedClubId)
            ? selectedClubId
            : clubsResponse[0].id;
        setSelectedClubId(preferredClubId);
        setValue("club", String(preferredClubId));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load member form.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedClubId, setSelectedClubId, setValue]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const canManageMembers = currentRole === "club_admin";

  const onSubmit = async (values: CreateMemberFormValues) => {
    if (!canManageMembers) {
      return;
    }
    setErrorMessage(null);
    try {
      const clubId = Number(values.club);
      await createMember({
        club: clubId,
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        sex: values.sex,
        wt_licenseid: values.wt_licenseid.trim() || undefined,
        ltf_license_prefix: values.ltf_license_prefix,
        date_of_birth: values.date_of_birth ? values.date_of_birth : null,
        belt_rank: values.belt_rank?.trim() || "",
        primary_license_role: values.primary_license_role ?? "",
        secondary_license_role: values.secondary_license_role ?? "",
        is_active: values.is_active,
      });
      setSelectedClubId(clubId);
      router.push(`/${locale}/dashboard/club/members`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create member.");
    }
  };

  if (isLoading) {
    return (
      <ClubAdminLayout title={t("createMember")} subtitle={t("memberCreatePageSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </ClubAdminLayout>
    );
  }

  if (!canManageMembers) {
    return (
      <ClubAdminLayout title={t("createMember")} subtitle={t("memberCreatePageSubtitle")}>
        <EmptyState
          title={t("memberCreateForbiddenTitle")}
          description={t("memberCreateForbiddenSubtitle")}
        />
        <div className="mt-4">
          <Button variant="outline" asChild>
            <Link href={`/${locale}/dashboard/club/members`}>{t("backToMembers")}</Link>
          </Button>
        </div>
      </ClubAdminLayout>
    );
  }

  if (clubs.length === 0) {
    return (
      <ClubAdminLayout title={t("createMember")} subtitle={t("memberCreatePageSubtitle")}>
        <EmptyState title={t("noResultsTitle")} description={t("noMembersResultsSubtitle")} />
        <div className="mt-4">
          <Button variant="outline" asChild>
            <Link href={`/${locale}/dashboard/club/members`}>{t("backToMembers")}</Link>
          </Button>
        </div>
      </ClubAdminLayout>
    );
  }

  return (
    <ClubAdminLayout title={t("createMember")} subtitle={t("memberCreatePageSubtitle")}>
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/${locale}/dashboard/club/members`}>{t("backToMembers")}</Link>
        </Button>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2 md:col-span-2">
              <Label>{t("clubLabel")}</Label>
              <Select
                value={watch("club")}
                onValueChange={(value) => {
                  setSelectedClubId(Number(value));
                  setValue("club", value, { shouldValidate: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("selectClubPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {clubs.map((club) => (
                    <SelectItem key={club.id} value={String(club.id)}>
                      {club.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.club ? <p className="text-sm text-red-600">{errors.club.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-first-name">{t("firstNameLabel")}</Label>
              <Input id="member-first-name" placeholder="Jane" {...register("first_name")} />
              {errors.first_name ? <p className="text-sm text-red-600">{errors.first_name.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-last-name">{t("lastNameLabel")}</Label>
              <Input id="member-last-name" placeholder="Doe" {...register("last_name")} />
              {errors.last_name ? <p className="text-sm text-red-600">{errors.last_name.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label>{t("sexLabel")}</Label>
              <Select
                value={watch("sex")}
                onValueChange={(value) => setValue("sex", value as "M" | "F", { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("sexLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">{t("sexMale")}</SelectItem>
                  <SelectItem value="F">{t("sexFemale")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-wt-license">{importT("wtLicenseLabel")}</Label>
              <Input id="member-wt-license" placeholder="WT-12345" {...register("wt_licenseid")} />
              {errors.wt_licenseid ? (
                <p className="text-sm text-red-600">{errors.wt_licenseid.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>{t("ltfLicensePrefixLabel")}</Label>
              <Select
                value={watch("ltf_license_prefix")}
                onValueChange={(value) =>
                  setValue("ltf_license_prefix", value as "LTF" | "LUX", { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("ltfLicensePrefixLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LTF">{t("ltfLicensePrefixLtf")}</SelectItem>
                  <SelectItem value="LUX">{t("ltfLicensePrefixLux")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-zinc-500">{t("ltfLicensePrefixHint")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-dob">{t("dobLabel")}</Label>
              <Input id="member-dob" type="date" {...register("date_of_birth")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-belt-rank">{t("beltRankLabel")}</Label>
              <Input id="member-belt-rank" placeholder="1st Dan" {...register("belt_rank")} />
            </div>

            <div className="space-y-2">
              <Label>{t("primaryLicenseRoleLabel")}</Label>
              <Select
                value={watch("primary_license_role") || "none"}
                onValueChange={(value) => {
                  const nextPrimary = value === "none" ? "" : value;
                  setValue(
                    "primary_license_role",
                    nextPrimary as CreateMemberFormValues["primary_license_role"],
                    { shouldValidate: true }
                  );
                  if (nextPrimary === watch("secondary_license_role")) {
                    setValue("secondary_license_role", "", { shouldValidate: true });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("primaryLicenseRoleLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("roleNoneOption")}</SelectItem>
                  {LICENSE_ROLE_VALUES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabelByValue[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("secondaryLicenseRoleLabel")}</Label>
              <Select
                disabled={!watch("primary_license_role")}
                value={watch("secondary_license_role") || "none"}
                onValueChange={(value) =>
                  setValue(
                    "secondary_license_role",
                    (value === "none" ? "" : value) as CreateMemberFormValues["secondary_license_role"],
                    { shouldValidate: true }
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("secondaryLicenseRoleLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("roleNoneOption")}</SelectItem>
                  {LICENSE_ROLE_VALUES.filter((role) => role !== watch("primary_license_role")).map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabelByValue[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.secondary_license_role ? (
                <p className="text-sm text-red-600">{errors.secondary_license_role.message}</p>
              ) : null}
            </div>

            <div className="flex items-center gap-2 md:col-span-2">
              <Checkbox
                id="member-active"
                checked={watch("is_active")}
                onCheckedChange={(value) => setValue("is_active", Boolean(value))}
              />
              <Label htmlFor="member-active">{t("isActiveLabel")}</Label>
            </div>

            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit" disabled={isSubmitting}>
                {t("createMember")}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href={`/${locale}/dashboard/club/members`}>{t("cancelEdit")}</Link>
              </Button>
            </div>
          </form>
        </section>
      </div>
    </ClubAdminLayout>
  );
}
