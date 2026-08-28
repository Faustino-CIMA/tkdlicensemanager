"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { MemberHistoryTimeline } from "@/components/history/member-history-timeline";
import { CurrentLicensesPanel } from "@/components/member/current-licenses-panel";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { FormPanel, PageNotice } from "@/components/ui/list-page-chrome";
import {
  downloadMemberProfilePicture,
  Member,
  MemberHistoryResponse,
  getMember,
  getMemberHistory,
} from "@/lib/ltf-admin-api";

export default function LtfMemberDetailPage() {
  const t = useTranslations("LtfAdmin");
  const commonT = useTranslations("Common");
  const params = useParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const memberId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);

  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<MemberHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const title = member
    ? t("memberDetailTitle", { name: `${member.first_name} ${member.last_name}` })
    : t("memberDetailTitleFallback");

  return (
    <LtfAdminLayout title={title} subtitle={t("memberDetailSubtitle")}>
      <div className="space-y-6">
        <Button variant="outline" asChild>
          <Link href={`/${locale}/dashboard/ltf/members`}>{t("backToMembers")}</Link>
        </Button>

        {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : !member ? (
          <EmptyState title={t("noResultsTitle")} description={t("memberNotFound")} />
        ) : (
          <div className="space-y-6">
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

            <FormPanel>
              <h2 className="text-section text-foreground">{t("memberHistoryTab")}</h2>
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
                  previousPageLabel={commonT("paginationPrevious")}
                  nextPageLabel={commonT("paginationNext")}
                  pageLabel={commonT("paginationPage")}
                  licenseHistory={history?.license_history ?? []}
                  gradeHistory={history?.grade_history ?? []}
                />
              </div>
            </FormPanel>
          </div>
        )}
      </div>
    </LtfAdminLayout>
  );
}
