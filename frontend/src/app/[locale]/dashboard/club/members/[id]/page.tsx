"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { MemberHistoryTimeline } from "@/components/history/member-history-timeline";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { Button } from "@/components/ui/button";
import {
  deleteMemberProfilePicture,
  downloadMemberProfilePicture,
  Member,
  MemberHistoryResponse,
  getMember,
  getMemberHistory,
  promoteMemberGrade,
} from "@/lib/club-admin-api";

type TabKey = "overview" | "history";

export default function ClubMemberDetailPage() {
  const t = useTranslations("ClubAdmin");
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const memberId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);
  const initialTab: TabKey = searchParams.get("tab") === "history" ? "history" : "overview";

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<MemberHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tabItems = useMemo(
    () => [
      { key: "overview" as const, label: t("memberOverviewTab") },
      { key: "history" as const, label: t("memberHistoryTab") },
    ],
    [t]
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
                onClick={() => setActiveTab(tab.key)}
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
            <h2 className="text-lg font-semibold text-zinc-900">{t("memberOverviewTab")}</h2>
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
                onDelete={async () => {
                  await deleteMemberProfilePicture(member.id);
                  await loadMember();
                }}
                onDownload={handlePhotoDownload}
                onEdit={() => router.push(`/${locale}/dashboard/club/members/${member.id}/photo`)}
              />
            </div>
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
                <span className="text-xs text-zinc-500">{t("beltRankLabel")}</span>
                <span className="font-medium">{member.belt_rank || "-"}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">{t("ltfLicenseLabel")}</span>
                <span className="font-medium">{member.ltf_licenseid || "-"}</span>
              </div>
            </div>
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
