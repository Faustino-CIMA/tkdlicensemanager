"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { MemberHistoryTimeline } from "@/components/history/member-history-timeline";
import { CurrentLicensesPanel } from "@/components/member/current-licenses-panel";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deleteMemberGrade,
  deleteMemberProfilePicture,
  downloadMemberProfilePicture,
  Member,
  MemberClubTransferHistory,
  MemberHistoryResponse,
  getMember,
  getMemberClubTransfers,
  getMemberHistory,
  promoteMemberGrade,
  updateMember,
  updateMemberGrade,
} from "@/lib/club-admin-api";
import { MemberClubMovementPanel } from "@/components/member/member-club-movement-panel";
import { PageNotice } from "@/components/ui/list-page-chrome";
import { apiRequest } from "@/lib/api";
import { formatDateInputValue, formatDisplayDate, parseDisplayDateToIso } from "@/lib/date-display";
import {
  LICENSE_ROLE_VALUES,
  type LicenseRoleValue,
  canonicalizeLicenseRole,
} from "@/lib/license-roles";

function normalizeMemberSex(value: unknown): "M" | "F" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "F" || normalized === "FEMALE") {
    return "F";
  }
  return "M";
}

function normalizeLicenseRole(value: unknown): LicenseRoleValue | "" {
  return canonicalizeLicenseRole(value);
}

const memberSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required."),
  last_name: z.string().trim().min(1, "Last name is required."),
  sex: z.preprocess(normalizeMemberSex, z.enum(["M", "F"])),
  email: z.union([z.literal(""), z.string().email("Please enter a valid email address.")]),
  wt_licenseid: z.string().max(32, "WT license ID must be at most 32 characters."),
  ltf_licenseid: z.string().max(20, "LTF license ID must be at most 20 characters."),
  date_of_birth: z.string().refine(
    (value) => {
      const normalized = String(value ?? "").trim();
      return !normalized || parseDisplayDateToIso(normalized) !== null;
    },
    "Use date format 29 Nov 2026."
  ),
  primary_license_role: z.preprocess(
    normalizeLicenseRole,
    z.enum(LICENSE_ROLE_VALUES).or(z.literal(""))
  ),
  secondary_license_role: z.preprocess(
    normalizeLicenseRole,
    z.enum(LICENSE_ROLE_VALUES).or(z.literal(""))
  ),
  is_active: z.boolean(),
});

type MemberFormValues = z.infer<typeof memberSchema>;
type AuthMeResponse = { role: string };

function memberToFormValues(member: Member): MemberFormValues {
  return {
    first_name: member.first_name,
    last_name: member.last_name,
    sex: normalizeMemberSex(member.sex),
    email: member.email ?? "",
    wt_licenseid: member.wt_licenseid ?? "",
    ltf_licenseid: member.ltf_licenseid ?? "",
    date_of_birth: formatDateInputValue(member.date_of_birth),
    primary_license_role: normalizeLicenseRole(member.primary_license_role),
    secondary_license_role: normalizeLicenseRole(member.secondary_license_role),
    is_active: member.is_active,
  };
}

export default function ClubMemberDetailPage() {
  const t = useTranslations("ClubAdmin");
  const commonT = useTranslations("Common");
  const importT = useTranslations("Import");
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const memberId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);
  const isEditing = searchParams.get("edit") === "1";
  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<MemberHistoryResponse | null>(null);
  const [clubMoves, setClubMoves] = useState<MemberClubTransferHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    control,
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
      primary_license_role: "",
      secondary_license_role: "",
      is_active: true,
    },
    values: member ? memberToFormValues(member) : undefined,
  });
  const roleLabelByValue = useMemo(
    () => ({
      Athlete: t("licenseRoleAthlete"),
      Coach: t("licenseRoleCoach"),
      Referee: t("licenseRoleReferee"),
      Official: t("licenseRoleOfficial"),
      Doctor: t("licenseRoleDoctor"),
      Physiotherapist: t("licenseRolePhysiotherapist"),
      Volunteer: t("licenseRoleVolunteer"),
      Staff: t("licenseRoleStaff"),
      Media: t("licenseRoleMedia"),
      Fan: t("licenseRoleFan"),
    }),
    [t]
  );

  const updateEditQuery = useCallback(
    (edit: boolean) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (edit) {
        nextParams.set("edit", "1");
      } else {
        nextParams.delete("edit");
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
      const [memberResponse, historyResponse, movementResponse] = await Promise.all([
        getMember(memberId),
        getMemberHistory(memberId),
        getMemberClubTransfers(memberId),
      ]);
      setMember(memberResponse);
      setHistory(historyResponse);
      setClubMoves(movementResponse);
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
  const canManageGrades = canEditMember;

  useEffect(() => {
    if (!member || !isEditing || !canManageMemberFull) {
      return;
    }
    reset(memberToFormValues(member));
  }, [canManageMemberFull, isEditing, member, reset]);

  const onEdit = () => {
    if (!canEditMember) {
      return;
    }
    updateEditQuery(true);
  };

  const onCancelEdit = () => {
    updateEditQuery(false);
    if (member) {
      reset(memberToFormValues(member));
    }
  };

  const onSubmit = async (values: MemberFormValues) => {
    if (!member) {
      return;
    }
    setErrorMessage(null);
    const dateOfBirthIso = parseDisplayDateToIso(values.date_of_birth);
    try {
      await updateMember(member.id, {
        club: member.club,
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        sex: values.sex,
        email: values.email.trim(),
        wt_licenseid: values.wt_licenseid.trim(),
        ltf_licenseid: values.ltf_licenseid.trim(),
        date_of_birth: dateOfBirthIso,
        primary_license_role: values.primary_license_role ?? "",
        secondary_license_role: values.secondary_license_role ?? "",
        is_active: values.is_active,
      });
      updateEditQuery(false);
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
        <Button variant="outline" size="sm" className="h-[var(--control-height)] min-h-[var(--control-height)]" asChild>
          <Link href={`/${locale}/dashboard/club/members`}>{t("backToMembers")}</Link>
        </Button>

        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : !member ? (
          <EmptyState title={t("noResultsTitle")} description={t("memberNotFound")} />
        ) : (
          <div className="space-y-4">
            <section className="rounded-[var(--radius-card)] bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">{t("memberOverviewTab")}</h2>
                {isEditing && canManageMemberFull ? (
                  <Button variant="outline" size="sm" className="h-[var(--control-height)] min-h-[var(--control-height)]" onClick={onCancelEdit}>
                    {t("cancelEdit")}
                  </Button>
                ) : canManageMemberFull ? (
                  <Button
                    variant="outline"
                    size="icon-lg"
                    className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0"
                    aria-label={t("editAction")}
                    onClick={onEdit}
                  >
                    <Pencil className="h-4 w-4" />
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
                    cameraCaptureButton: t("photoCameraCaptureButton"),
                    cameraCancelButton: t("photoCameraCancelButton"),
                    cameraStarting: t("photoCameraStarting"),
                    cameraUnavailable: t("photoCameraUnavailable"),
                    cameraPermissionDenied: t("photoCameraPermissionDenied"),
                    cameraStartError: t("photoCameraStartError"),
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
              {isEditing && canManageMemberFull ? (
                <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
                  <div className="space-y-2">
                    <Label htmlFor="member-first-name">{t("firstNameLabel")}</Label>
                    <Input
                      id="member-first-name"
                      placeholder="Jane"
                      disabled={isCoach}
                      {...register("first_name")}
                    />
                    {errors.first_name ? (
                      <p className="text-sm text-destructive">{errors.first_name.message}</p>
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
                      <p className="text-sm text-destructive">{errors.last_name.message}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label>{t("sexLabel")}</Label>
                    <Controller
                      name="sex"
                      control={control}
                      render={({ field }) => (
                        <Select
                          disabled={isCoach}
                          value={field.value === "F" ? "F" : "M"}
                          onValueChange={(value) => {
                            if (value === "M" || value === "F") {
                              field.onChange(value);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("sexLabel")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="M">{t("sexMale")}</SelectItem>
                            <SelectItem value="F">{t("sexFemale")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.sex ? <p className="text-sm text-destructive">{errors.sex.message}</p> : null}
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
                    {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="member-wt-license">{importT("wtLicenseLabel")}</Label>
                    <Input
                      id="member-wt-license"
                      placeholder="LUX-12345"
                      disabled={isCoach}
                      {...register("wt_licenseid")}
                    />
                    {errors.wt_licenseid ? (
                      <p className="text-sm text-destructive">{errors.wt_licenseid.message}</p>
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
                      <p className="text-sm text-destructive">{errors.ltf_licenseid.message}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="member-dob">{t("dobLabel")}</Label>
                    <Input
                      id="member-dob"
                      placeholder="29 Nov 2026"
                      disabled={isCoach}
                      {...register("date_of_birth")}
                    />
                    {errors.date_of_birth ? (
                      <p className="text-sm text-destructive">{errors.date_of_birth.message}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label>{t("beltRankLabel")}</Label>
                    <p className="text-sm font-medium text-foreground">{member.belt_rank || "-"}</p>
                    <p className="text-xs text-muted">{t("beltRankManagedInGradesHint")}</p>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("primaryLicenseRoleLabel")}</Label>
                    <Controller
                      name="primary_license_role"
                      control={control}
                      render={({ field }) => (
                        <Select
                          disabled={isCoach}
                          value={field.value || "none"}
                          onValueChange={(value) => {
                            const nextPrimary = value === "none" ? "" : value;
                            field.onChange(nextPrimary);
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
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("secondaryLicenseRoleLabel")}</Label>
                    <Controller
                      name="secondary_license_role"
                      control={control}
                      render={({ field }) => (
                        <Select
                          disabled={isCoach || !watch("primary_license_role")}
                          value={field.value || "none"}
                          onValueChange={(value) =>
                            field.onChange(value === "none" ? "" : value)
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
                      )}
                    />
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
                    <Button type="submit" className="h-[var(--control-height)] min-h-[var(--control-height)]" disabled={isSubmitting}>
                      {t("updateMember")}
                    </Button>
                    <Button type="button" variant="outline" className="h-[var(--control-height)] min-h-[var(--control-height)]" onClick={onCancelEdit}>
                      {t("cancelEdit")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 grid gap-3 text-sm text-foreground md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("firstNameLabel")}</span>
                    <span className="font-medium">{member.first_name}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("lastNameLabel")}</span>
                    <span className="font-medium">{member.last_name}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("sexLabel")}</span>
                    <span className="font-medium">
                      {member.sex === "M" ? t("sexMale") : t("sexFemale")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("emailLabel")}</span>
                    <span className="font-medium">{member.email || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{importT("wtLicenseLabel")}</span>
                    <span className="font-medium">{member.wt_licenseid || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("ltfLicenseLabel")}</span>
                    <span className="font-medium">{member.ltf_licenseid || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("dobLabel")}</span>
                    <span className="font-medium">{formatDisplayDate(member.date_of_birth)}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("beltRankLabel")}</span>
                    <span className="font-medium">{member.belt_rank || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("primaryLicenseRoleLabel")}</span>
                    <span className="font-medium">
                      {canonicalizeLicenseRole(member.primary_license_role)
                        ? roleLabelByValue[canonicalizeLicenseRole(member.primary_license_role)]
                        : "-"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("secondaryLicenseRoleLabel")}</span>
                    <span className="font-medium">
                      {canonicalizeLicenseRole(member.secondary_license_role)
                        ? roleLabelByValue[canonicalizeLicenseRole(member.secondary_license_role)]
                        : "-"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{t("isActiveLabel")}</span>
                    <span className="font-medium">
                      {member.is_active ? t("activeLabel") : t("inactiveLabel")}
                    </span>
                  </div>
                </div>
              )}
            </section>

            {member.is_club_tourist ? (
              <PageNotice tone="warning">{t("clubTouristMemberHint")}</PageNotice>
            ) : null}

            <CurrentLicensesPanel
              memberId={member.id}
              licenses={member.current_licenses ?? []}
              title={t("currentLicensesTitle")}
              subtitle={t("currentLicensesSubtitle")}
              emptyLabel={t("currentLicensesEmpty")}
              pendingHint={t("currentLicensesPendingHint")}
              yearLabel={t("yearLabel")}
              typeLabel={t("licenseTypeLabel")}
              statusLabel={t("statusLabel")}
              pendingLabel={t("statusPending")}
              activeLabel={t("statusActive")}
              expiredLabel={t("statusExpired")}
              revokedLabel={t("statusRevoked")}
              cardPreviewTitle={t("cardPreviewTitle")}
              cardPreviewFrontLabel={t("cardPreviewFrontLabel")}
              cardPreviewBackLabel={t("cardPreviewBackLabel")}
              cardPreviewUnavailable={t("cardPreviewUnavailable")}
            />

            <MemberClubMovementPanel
              title={t("clubMovementHistoryTitle")}
              subtitle={t("clubMovementHistorySubtitle")}
              emptyLabel={t("clubMovementHistoryEmpty")}
              fromLabel={t("clubMovementFromLabel")}
              toLabel={t("clubMovementToLabel")}
              dateLabel={t("clubMovementDateLabel")}
              statusLabel={t("statusLabel")}
              countLabel={t("clubMovementCountLabel")}
              touristLabel={t("clubTouristBadge")}
              touristHint={t("clubTouristMemberHint")}
              history={clubMoves}
            />

            <section className="rounded-[var(--radius-card)] bg-card p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-foreground">{t("memberHistoryTab")}</h2>
              <p className="mt-1 text-sm text-muted">{t("memberHistorySubtitle")}</p>
              <div className="mt-4">
                <MemberHistoryTimeline
                  licenseTitle={t("licenseHistoryTitle")}
                  gradeTitle={t("gradeHistoryTitle")}
                  emptyLabel={t("historyEmpty")}
                  licenseYearLabel={t("historyLicenseYearColumn")}
                  licenseTypeLabel={t("historyLicenseTypeColumn")}
                  licenseStatusLabel={t("historyLicenseStatusColumn")}
                  licenseIssuedLabel={t("historyLicenseIssuedColumn")}
                  gradeDateLabel={t("historyGradeDateColumn")}
                  gradeLabel={t("historyGradeColumn")}
                  gradeIssuedByLabel={t("historyGradeIssuedByColumn")}
                  addGradeAriaLabel={t("addGradeAction")}
                  editGradeAriaLabel={t("editGradeAction")}
                  deleteGradeAriaLabel={t("deleteGradeAction")}
                  deleteGradeTitle={t("deleteGradeTitle")}
                  deleteGradeDescription={t("deleteGradeDescription")}
                  deleteConfirmLabel={commonT("deleteConfirmButton")}
                  gradeFormTitle={t("promoteGradeTitle")}
                  editGradeFormTitle={t("editGradeTitle")}
                  promoteToGradeLabel={t("promoteToGradeLabel")}
                  promoteDateLabel={t("promoteDateLabel")}
                  issuedByLabel={t("gradeIssuedByLabel")}
                  issuedByClubOption={t("gradeIssuedByClubOption")}
                  issuedByLtfOption={t("gradeIssuedByLtfOption")}
                  issuedByOtherOption={t("gradeIssuedByOtherOption")}
                  issuedByOtherPlaceholder={t("gradeIssuedByOtherPlaceholder")}
                  promoteSubmitLabel={t("promoteSubmitLabel")}
                  cancelLabel={t("cancelEdit")}
                  previousPageLabel={commonT("paginationPrevious")}
                  nextPageLabel={commonT("paginationNext")}
                  pageLabel={commonT("paginationPage")}
                  onPromote={
                    canManageGrades
                      ? async (input) => {
                          await promoteMemberGrade(member.id, input);
                          await loadMember();
                        }
                      : undefined
                  }
                  onUpdateGrade={
                    canManageGrades
                      ? async (historyId, input) => {
                          await updateMemberGrade(member.id, historyId, input);
                          await loadMember();
                        }
                      : undefined
                  }
                  onDeleteGrade={
                    canManageGrades
                      ? async (historyId) => {
                          await deleteMemberGrade(member.id, historyId);
                          await loadMember();
                        }
                      : undefined
                  }
                  licenseHistory={history?.license_history ?? []}
                  gradeHistory={history?.grade_history ?? []}
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </ClubAdminLayout>
  );
}
