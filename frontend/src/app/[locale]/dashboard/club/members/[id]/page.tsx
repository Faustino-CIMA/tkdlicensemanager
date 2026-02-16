"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { MemberHistoryTimeline } from "@/components/history/member-history-timeline";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deleteMemberProfilePicture,
  downloadMemberProfilePicture,
  Member,
  MemberHistoryResponse,
  getMember,
  getMemberHistory,
  promoteMemberGrade,
  updateMember,
} from "@/lib/club-admin-api";
import { apiRequest } from "@/lib/api";

type TabKey = "overview" | "history";
type MemberDetailQueryUpdates = {
  tab?: TabKey | null;
  edit?: "1" | null;
};

const LICENSE_ROLE_VALUES = [
  "athlete",
  "coach",
  "referee",
  "official",
  "doctor",
  "physiotherapist",
] as const;

const memberSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required."),
  last_name: z.string().trim().min(1, "Last name is required."),
  sex: z.enum(["M", "F"]),
  email: z.union([z.literal(""), z.string().email("Please enter a valid email address.")]),
  wt_licenseid: z.string().max(32, "WT license ID must be at most 32 characters."),
  ltf_licenseid: z.string().max(20, "LTF license ID must be at most 20 characters."),
  date_of_birth: z.string(),
  belt_rank: z.string().max(50, "Belt rank must be at most 50 characters."),
  primary_license_role: z.enum(LICENSE_ROLE_VALUES).or(z.literal("")).optional(),
  secondary_license_role: z.enum(LICENSE_ROLE_VALUES).or(z.literal("")).optional(),
  is_active: z.boolean(),
});

type MemberFormValues = z.infer<typeof memberSchema>;
type AuthMeResponse = { role: string };

export default function ClubMemberDetailPage() {
  const t = useTranslations("ClubAdmin");
  const importT = useTranslations("Import");
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const memberId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);
  const activeTab: TabKey = searchParams.get("tab") === "history" ? "history" : "overview";
  const isEditing = activeTab === "overview" && searchParams.get("edit") === "1";
  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<MemberHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      sex: "M",
      email: "",
      wt_licenseid: "",
      ltf_licenseid: "",
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

  const tabItems = useMemo(
    () => [
      { key: "overview" as const, label: t("memberOverviewTab") },
      { key: "history" as const, label: t("memberHistoryTab") },
    ],
    [t]
  );

  const updateDetailQuery = useCallback(
    (updates: MemberDetailQueryUpdates) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      if (updates.tab !== undefined) {
        if (updates.tab) {
          nextParams.set("tab", updates.tab);
        } else {
          nextParams.delete("tab");
        }
      }

      if (updates.edit !== undefined) {
        if (updates.edit) {
          nextParams.set("edit", updates.edit);
        } else {
          nextParams.delete("edit");
        }
      }

      const nextQuery = nextParams.toString();
      const currentQuery = searchParams.toString();
      if (nextQuery === currentQuery) {
        return;
      }

      router.replace(
        `/${locale}/dashboard/club/members/${memberId}${nextQuery ? `?${nextQuery}` : ""}`,
        { scroll: false }
      );
    },
    [locale, memberId, router, searchParams]
  );

  const loadMember = useCallback(async () => {
    if (!memberId) {
      setErrorMessage(t("memberNotFound"));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [memberResponse, historyResponse] = await Promise.all([
        getMember(memberId),
        getMemberHistory(memberId),
      ]);
      setMember(memberResponse);
      setHistory(historyResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load member.");
    } finally {
      setIsLoading(false);
    }
  }, [memberId, t]);

  const handlePhotoDownload = useCallback(async () => {
    if (!member) {
      return;
    }
    const photoBlob = await downloadMemberProfilePicture(member.id);
    const objectUrl = URL.createObjectURL(photoBlob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${member.first_name}-${member.last_name}-profile-picture.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, [member]);

  useEffect(() => {
    loadMember();
  }, [loadMember]);

  useEffect(() => {
    let isMounted = true;
    const loadCurrentUserRole = async () => {
      try {
        const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
        if (isMounted) {
          setCurrentRole(me.role);
        }
      } catch {
        if (isMounted) {
          setCurrentRole(null);
        }
      }
    };
    loadCurrentUserRole();
    return () => {
      isMounted = false;
    };
  }, []);

  const isCoach = currentRole === "coach";
  const canManageMemberFull = currentRole === "club_admin";
  const canEditMember = canManageMemberFull || isCoach;

  useEffect(() => {
    if (!searchParams.get("tab")) {
      updateDetailQuery({ tab: "overview" });
    }
  }, [searchParams, updateDetailQuery]);

  useEffect(() => {
    if (!member) {
      return;
    }
    reset({
      first_name: member.first_name,
      last_name: member.last_name,
      sex: member.sex,
      email: member.email ?? "",
      wt_licenseid: member.wt_licenseid ?? "",
      ltf_licenseid: member.ltf_licenseid ?? "",
      date_of_birth: member.date_of_birth ?? "",
      belt_rank: member.belt_rank ?? "",
      primary_license_role: member.primary_license_role ?? "",
      secondary_license_role: member.secondary_license_role ?? "",
      is_active: member.is_active,
    });
  }, [member, reset]);

  const onEdit = () => {
    if (!canEditMember) {
      return;
    }
    updateDetailQuery({ tab: "overview", edit: "1" });
  };

  const onCancelEdit = () => {
    updateDetailQuery({ edit: null });
    if (member) {
      reset({
        first_name: member.first_name,
        last_name: member.last_name,
        sex: member.sex,
        email: member.email ?? "",
        wt_licenseid: member.wt_licenseid ?? "",
        ltf_licenseid: member.ltf_licenseid ?? "",
        date_of_birth: member.date_of_birth ?? "",
        belt_rank: member.belt_rank ?? "",
        primary_license_role: member.primary_license_role ?? "",
        secondary_license_role: member.secondary_license_role ?? "",
        is_active: member.is_active,
      });
    }
  };

  const onSubmit = async (values: MemberFormValues) => {
    if (!member) {
      return;
    }
    setErrorMessage(null);
    try {
      if (isCoach) {
        await updateMember(member.id, {
          belt_rank: values.belt_rank.trim(),
        });
      } else {
        await updateMember(member.id, {
          club: member.club,
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          sex: values.sex,
          email: values.email.trim(),
          wt_licenseid: values.wt_licenseid.trim(),
          ltf_licenseid: values.ltf_licenseid.trim(),
          date_of_birth: values.date_of_birth ? values.date_of_birth : null,
          belt_rank: values.belt_rank.trim(),
          primary_license_role: values.primary_license_role ?? "",
          secondary_license_role: values.secondary_license_role ?? "",
          is_active: values.is_active,
        });
      }
      updateDetailQuery({ tab: "overview", edit: null });
      await loadMember();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update member.");
    }
  };

  const title = member
    ? t("memberDetailTitle", { name: `${member.first_name} ${member.last_name}` })
    : t("memberDetailTitleFallback");

  return (
    <ClubAdminLayout title={title} subtitle={t("memberDetailSubtitle")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${locale}/dashboard/club/members`}>{t("backToMembers")}</Link>
          </Button>
          <div className="flex items-center gap-2">
            {tabItems.map((tab) => (
              <Button
                key={tab.key}
                variant={activeTab === tab.key ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  if (tab.key === "history") {
                    updateDetailQuery({ tab: "history", edit: null });
                    return;
                  }
                  updateDetailQuery({ tab: "overview" });
                }}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : !member ? (
          <EmptyState title={t("noResultsTitle")} description={t("memberNotFound")} />
        ) : activeTab === "overview" ? (
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">{t("memberOverviewTab")}</h2>
              {isEditing ? (
                <Button variant="outline" size="sm" onClick={onCancelEdit}>
                  {t("cancelEdit")}
                </Button>
              ) : canEditMember ? (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  {t("editAction")}
                </Button>
              ) : null}
            </div>
            <div className="mt-4">
              <ProfilePhotoManager
                imageUrl={member.profile_picture_url}
                thumbnailUrl={member.profile_picture_thumbnail_url}
                labels={{
                  sectionTitle: t("photoSectionTitle"),
                  sectionSubtitle: t("photoSectionSubtitle"),
                  changeButton: t("photoChangeButton"),
                  removeButton: t("photoRemoveButton"),
                  downloadButton: t("photoDownloadButton"),
                  modalTitle: t("photoModalTitle"),
                  modalDescription: t("photoModalDescription"),
                  dragDropLabel: t("photoDragDropLabel"),
                  selectFileButton: t("photoSelectFileButton"),
                  cameraButton: t("photoCameraButton"),
                  zoomLabel: t("photoZoomLabel"),
                  backgroundColorLabel: t("photoBackgroundColorLabel"),
                  removeBackgroundButton: t("photoRemoveBackgroundButton"),
                  removeBackgroundBusy: t("photoRemoveBackgroundBusy"),
                  consentLabel: t("photoConsentLabel"),
                  saveButton: t("photoSaveButton"),
                  saveBusy: t("photoSaveBusy"),
                  cancelButton: t("photoCancelButton"),
                  previewTitle: t("photoPreviewTitle"),
                  currentPhotoAlt: t("photoCurrentAlt"),
                  emptyPhotoLabel: t("photoEmptyLabel"),
                  removeBackgroundUnsupported: t("photoUnsupportedError"),
                }}
                onDelete={
                  canManageMemberFull
                    ? async () => {
                        await deleteMemberProfilePicture(member.id);
                        await loadMember();
                      }
                    : undefined
                }
                onDownload={handlePhotoDownload}
                onEdit={
                  canManageMemberFull
                    ? () => router.push(`/${locale}/dashboard/club/members/${member.id}/photo`)
                    : undefined
                }
              />
            </div>
            {isEditing ? (
              <form
                className="mt-4 grid gap-4 md:grid-cols-2"
                onSubmit={handleSubmit(onSubmit)}
              >
                <div className="space-y-2">
                  <Label htmlFor="member-first-name">{t("firstNameLabel")}</Label>
                  <Input
                    id="member-first-name"
                    placeholder="Jane"
                    disabled={isCoach}
                    {...register("first_name")}
                  />
                  {errors.first_name ? (
                    <p className="text-sm text-red-600">{errors.first_name.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-last-name">{t("lastNameLabel")}</Label>
                  <Input
                    id="member-last-name"
                    placeholder="Doe"
                    disabled={isCoach}
                    {...register("last_name")}
                  />
                  {errors.last_name ? (
                    <p className="text-sm text-red-600">{errors.last_name.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>{t("sexLabel")}</Label>
                  <Select
                    disabled={isCoach}
                    value={watch("sex")}
                    onValueChange={(value) =>
                      setValue("sex", value as "M" | "F", {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("sexLabel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M">{t("sexMale")}</SelectItem>
                      <SelectItem value="F">{t("sexFemale")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.sex ? <p className="text-sm text-red-600">{errors.sex.message}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-email">{t("emailLabel")}</Label>
                  <Input
                    id="member-email"
                    type="email"
                    placeholder="member@example.com"
                    disabled={isCoach}
                    {...register("email")}
                  />
                  {errors.email ? <p className="text-sm text-red-600">{errors.email.message}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-wt-license">{importT("wtLicenseLabel")}</Label>
                  <Input
                    id="member-wt-license"
                    placeholder="WT-12345"
                    disabled={isCoach}
                    {...register("wt_licenseid")}
                  />
                  {errors.wt_licenseid ? (
                    <p className="text-sm text-red-600">{errors.wt_licenseid.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-ltf-license">{t("ltfLicenseLabel")}</Label>
                  <Input
                    id="member-ltf-license"
                    placeholder="LTF-12345"
                    disabled={isCoach}
                    {...register("ltf_licenseid")}
                  />
                  {errors.ltf_licenseid ? (
                    <p className="text-sm text-red-600">{errors.ltf_licenseid.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-dob">{t("dobLabel")}</Label>
                  <Input id="member-dob" type="date" disabled={isCoach} {...register("date_of_birth")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-belt-rank">{t("beltRankLabel")}</Label>
                  <Input id="member-belt-rank" placeholder="1st Dan" {...register("belt_rank")} />
                  {errors.belt_rank ? (
                    <p className="text-sm text-red-600">{errors.belt_rank.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>{t("primaryLicenseRoleLabel")}</Label>
                  <Select
                    disabled={isCoach}
                    value={watch("primary_license_role") || "none"}
                    onValueChange={(value) => {
                      const nextPrimary = value === "none" ? "" : value;
                      setValue(
                        "primary_license_role",
                        nextPrimary as MemberFormValues["primary_license_role"],
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
                    disabled={isCoach || !watch("primary_license_role")}
                    value={watch("secondary_license_role") || "none"}
                    onValueChange={(value) =>
                      setValue(
                        "secondary_license_role",
                        (value === "none" ? "" : value) as MemberFormValues["secondary_license_role"],
                        { shouldValidate: true }
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("secondaryLicenseRoleLabel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("roleNoneOption")}</SelectItem>
                      {LICENSE_ROLE_VALUES.filter((role) => role !== watch("primary_license_role")).map(
                        (role) => (
                          <SelectItem key={role} value={role}>
                            {roleLabelByValue[role]}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 md:col-span-2">
                  <Checkbox
                    checked={watch("is_active")}
                    disabled={isCoach}
                    onCheckedChange={(value) => {
                      if (!isCoach) {
                        setValue("is_active", Boolean(value));
                      }
                    }}
                    id="member-active"
                  />
                  <Label htmlFor="member-active">{t("isActiveLabel")}</Label>
                </div>

                <div className="flex items-center gap-3 md:col-span-2">
                  <Button type="submit" disabled={isSubmitting}>
                    {t("updateMember")}
                  </Button>
                  <Button type="button" variant="outline" onClick={onCancelEdit}>
                    {t("cancelEdit")}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="mt-4 grid gap-3 text-sm text-zinc-700 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("firstNameLabel")}</span>
                  <span className="font-medium">{member.first_name}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("lastNameLabel")}</span>
                  <span className="font-medium">{member.last_name}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("sexLabel")}</span>
                  <span className="font-medium">
                    {member.sex === "M" ? t("sexMale") : t("sexFemale")}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("emailLabel")}</span>
                  <span className="font-medium">{member.email || "-"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{importT("wtLicenseLabel")}</span>
                  <span className="font-medium">{member.wt_licenseid || "-"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("ltfLicenseLabel")}</span>
                  <span className="font-medium">{member.ltf_licenseid || "-"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("dobLabel")}</span>
                  <span className="font-medium">{member.date_of_birth || "-"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("beltRankLabel")}</span>
                  <span className="font-medium">{member.belt_rank || "-"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("primaryLicenseRoleLabel")}</span>
                  <span className="font-medium">
                    {member.primary_license_role
                      ? roleLabelByValue[member.primary_license_role]
                      : "-"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("secondaryLicenseRoleLabel")}</span>
                  <span className="font-medium">
                    {member.secondary_license_role
                      ? roleLabelByValue[member.secondary_license_role]
                      : "-"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{t("isActiveLabel")}</span>
                  <span className="font-medium">
                    {member.is_active ? t("activeLabel") : t("inactiveLabel")}
                  </span>
                </div>
              </div>
            )}
          </section>
        ) : (
          <MemberHistoryTimeline
            title={t("memberHistoryTab")}
            subtitle={t("memberHistorySubtitle")}
            licenseTitle={t("licenseHistoryTitle")}
            gradeTitle={t("gradeHistoryTitle")}
            emptyLabel={t("historyEmpty")}
            eventLabel={t("historyEventLabel")}
            reasonLabel={t("historyReasonLabel")}
            notesLabel={t("historyNotesLabel")}
            fromLabel={t("historyFromLabel")}
            toLabel={t("historyToLabel")}
            promoteTitle={t("promoteGradeTitle")}
            promoteToGradeLabel={t("promoteToGradeLabel")}
            promoteDateLabel={t("promoteDateLabel")}
            promoteExamDateLabel={t("promoteExamDateLabel")}
            promoteProofLabel={t("promoteProofLabel")}
            promoteNotesLabel={t("promoteNotesLabel")}
            promoteSubmitLabel={t("promoteSubmitLabel")}
            onPromote={async (input) => {
              if (!member) {
                return;
              }
              await promoteMemberGrade(member.id, input);
              await loadMember();
            }}
            licenseHistory={history?.license_history ?? []}
            gradeHistory={history?.grade_history ?? []}
          />
        )}
      </div>
    </ClubAdminLayout>
  );
}
