"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  Award,
  History,
  IdCard,
  User,
} from "lucide-react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { MemberHistoryTimeline } from "@/components/history/member-history-timeline";
import { CurrentLicensesPanel } from "@/components/member/current-licenses-panel";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import {
  FormPanel,
  PageNotice,
  ActionNotices
} from "@/components/ui/list-page-chrome";
import { MemberClubMovementPanel } from "@/components/member/member-club-movement-panel";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import {
  downloadMemberProfilePicture,
  Member,
  MemberHistoryResponse,
  getMember,
  getMemberHistory,
} from "@/lib/ltf-admin-api";
import { getMemberClubTransfers, MemberClubTransferHistory } from "@/lib/club-admin-api";

const MEMBER_DETAIL_TABS = [
  "overview",
  "current-licenses",
  "license-history",
  "grades",
  "club-movements",
] as const;

type MemberDetailTab = (typeof MEMBER_DETAIL_TABS)[number];

function parseMemberDetailTab(value: string | null): MemberDetailTab {
  if (value && (MEMBER_DETAIL_TABS as readonly string[]).includes(value)) {
    return value as MemberDetailTab;
  }
  return "overview";
}

export default function LtfMemberDetailPage() {
  const t = useTranslations("LtfAdmin");
  const commonT = useTranslations("Common");
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const memberId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);
  const urlTab = parseMemberDetailTab(searchParams.get("tab"));
  const [activeTab, setActiveTabState] = useState<MemberDetailTab>(urlTab);

  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<MemberHistoryResponse | null>(null);
  const [clubMoves, setClubMoves] = useState<MemberClubTransferHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setActiveTabState(urlTab);
  }, [urlTab]);

  const setActiveTab = useCallback(
    (tab: MemberDetailTab) => {
      setActiveTabState(tab);
      const nextParams = new URLSearchParams(searchParams.toString());
      if (tab === "overview") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", tab);
      }
      const nextQuery = nextParams.toString();
      const currentQuery = searchParams.toString();
      if (nextQuery === currentQuery) {
        return;
      }
      router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
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

  const licenseHistoryCount = useMemo(() => {
    const years = new Set((history?.license_history ?? []).map((entry) => entry.license_year));
    return years.size;
  }, [history]);
  const gradeHistoryCount = history?.grade_history.length ?? 0;
  const clubMovementCount = clubMoves?.completed_transfer_count ?? 0;

  const title = member
    ? t("memberDetailTitle", { name: `${member.first_name} ${member.last_name}` })
    : t("memberDetailTitleFallback");

  const historyTimelineShared = {
    licenseTitle: t("licenseHistoryTitle"),
    gradeTitle: t("gradeHistoryTitle"),
    emptyLabel: t("historyEmpty"),
    licenseYearLabel: t("historyLicenseYearColumn"),
    licenseTypeLabel: t("historyLicenseTypeColumn"),
    licenseStatusLabel: t("historyLicenseStatusColumn"),
    licenseIssuedLabel: t("historyLicenseIssuedColumn"),
    gradeDateLabel: t("historyGradeDateColumn"),
    gradeLabel: t("historyGradeColumn"),
    gradeIssuedByLabel: t("historyGradeIssuedByColumn"),
    previousPageLabel: commonT("paginationPrevious"),
    nextPageLabel: commonT("paginationNext"),
    pageLabel: commonT("paginationPage"),
    licenseHistory: history?.license_history ?? [],
    gradeHistory: history?.grade_history ?? [],
  };

  return (
    <LtfAdminLayout title={title} subtitle={t("memberDetailSubtitle")}>
      <div className="space-y-6">
        <Button variant="outline" asChild>
          <Link href={`/${locale}/dashboard/ltf/members`}>{t("backToMembers")}</Link>
        </Button>

        <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : !member ? (
          <EmptyState title={t("noResultsTitle")} description={t("memberNotFound")} />
        ) : (
          <div className="space-y-6">
            {member.is_club_tourist ? (
              <PageNotice tone="warning">{t("clubTouristMemberHint")}</PageNotice>
            ) : null}

            <UnderlineTabs
              idPrefix="member-detail"
              ariaLabel={t("memberDetailTabsAriaLabel")}
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: "overview", label: t("memberOverviewTab"), icon: User },
                {
                  value: "current-licenses",
                  label: t("memberCurrentLicensesTab"),
                  icon: IdCard,
                },
                {
                  value: "license-history",
                  label: t("memberLicenseHistoryTab"),
                  icon: History,
                  count: licenseHistoryCount,
                },
                {
                  value: "grades",
                  label: t("memberGradesTab"),
                  icon: Award,
                  count: gradeHistoryCount,
                },
                {
                  value: "club-movements",
                  label: t("memberClubMovementsTab"),
                  icon: ArrowLeftRight,
                  count: clubMovementCount,
                },
              ]}
            />

            <div
              role="tabpanel"
              id="member-detail-panel"
              aria-labelledby={`member-detail-${activeTab}`}
            >
              {activeTab === "overview" ? (
                <FormPanel>
                  <h2 className="text-section text-foreground">{t("memberOverviewTab")}</h2>
                  <p className="mt-1 text-sm text-muted">{t("membersReadOnlyHint")}</p>
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
                      readOnly
                      onDownload={handlePhotoDownload}
                    />
                  </div>
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
                      <span className="text-xs text-muted">{t("beltRankLabel")}</span>
                      <span className="font-medium">{member.belt_rank || "-"}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted">{t("ltfLicenseLabel")}</span>
                      <span className="font-medium">{member.ltf_licenseid || "-"}</span>
                    </div>
                  </div>
                </FormPanel>
              ) : null}

              {activeTab === "current-licenses" ? (
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
              ) : null}

              {activeTab === "license-history" ? (
                <FormPanel>
                  <h2 className="text-section text-foreground">{t("memberLicenseHistoryTab")}</h2>
                  <p className="mt-1 text-sm text-muted">{t("licenseHistorySubtitle")}</p>
                  <div className="mt-4">
                    <MemberHistoryTimeline {...historyTimelineShared} visibleSection="licenses" />
                  </div>
                </FormPanel>
              ) : null}

              {activeTab === "grades" ? (
                <FormPanel>
                  <h2 className="text-section text-foreground">{t("memberGradesTab")}</h2>
                  <p className="mt-1 text-sm text-muted">{t("gradeHistorySubtitle")}</p>
                  <div className="mt-4">
                    <MemberHistoryTimeline {...historyTimelineShared} visibleSection="grades" />
                  </div>
                </FormPanel>
              ) : null}

              {activeTab === "club-movements" ? (
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
              ) : null}
            </div>
          </div>
        )}
      </div>
    </LtfAdminLayout>
  );
}
