"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { MemberHistoryTimeline } from "@/components/history/member-history-timeline";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { apiRequest } from "@/lib/api";
import {
  deleteMemberProfilePicture,
  downloadMemberProfilePicture,
  Member,
  MemberHistoryResponse,
  getMemberHistory,
  getMembers,
} from "@/lib/ltf-admin-api";

type MeResponse = {
  id: number;
  username: string;
  role: string;
};

export default function MemberDashboardPage() {
  const t = useTranslations("Member");
  const router = useRouter();
  const params = useParams();
  const rawLocale = params?.locale;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<MemberHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const me = await apiRequest<MeResponse>("/api/auth/me/");
      if (me.role !== "member") {
        setErrorMessage(t("roleNotAllowed"));
        return;
      }
      const members = await getMembers();
      const ownMember = members[0] ?? null;
      if (!ownMember) {
        setMember(null);
        setHistory(null);
        return;
      }
      const historyResponse = await getMemberHistory(ownMember.id);
      setMember(ownMember);
      setHistory(historyResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load member history.");
    } finally {
      setIsLoading(false);
    }
  }, [t]);

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
    loadData();
  }, [loadData]);

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-zinc-900">{t("title")}</h1>
          <p className="mt-2 text-sm text-zinc-500">{t("subtitle")}</p>
        </header>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : !member ? (
          <EmptyState title={t("emptyTitle")} description={t("emptySubtitle")} />
        ) : (
          <div className="space-y-4">
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
                await loadData();
              }}
              onDownload={handlePhotoDownload}
              onEdit={() => router.push(`/${locale}/dashboard/member/photo`)}
            />

            <MemberHistoryTimeline
              title={t("historyTitle")}
              subtitle={t("historySubtitle")}
              licenseTitle={t("licenseHistoryTitle")}
              gradeTitle={t("gradeHistoryTitle")}
              emptyLabel={t("historyEmpty")}
              eventLabel={t("historyEventLabel")}
              reasonLabel={t("historyReasonLabel")}
              notesLabel={t("historyNotesLabel")}
              fromLabel={t("historyFromLabel")}
              toLabel={t("historyToLabel")}
              licenseHistory={history?.license_history ?? []}
              gradeHistory={history?.grade_history ?? []}
            />
          </div>
        )}
      </div>
    </main>
  );
}
