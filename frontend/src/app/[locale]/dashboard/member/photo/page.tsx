"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { apiRequest } from "@/lib/api";
import { Member, getMembers, uploadMemberProfilePicture } from "@/lib/ltf-admin-api";

type MeResponse = {
  id: number;
  username: string;
  role: string;
};

export default function MemberProfilePhotoPage() {
  const t = useTranslations("Member");
  const router = useRouter();
  const params = useParams();
  const rawLocale = params?.locale;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const backHref = `/${locale}/dashboard/member`;

  const [member, setMember] = useState<Member | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMember = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const me = await apiRequest<MeResponse>("/api/auth/me/");
      if (me.role !== "member") {
        setErrorMessage(t("roleNotAllowed"));
        return;
      }
      const members = await getMembers();
      setMember(members[0] ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load member.");
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMember();
  }, [loadMember]);

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-zinc-900">{t("photoModalTitle")}</h1>
          <p className="mt-2 text-sm text-zinc-500">{t("photoModalDescription")}</p>
        </header>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : !member ? (
          <EmptyState title={t("emptyTitle")} description={t("emptySubtitle")} />
        ) : (
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
            isPageEditor
            onCancelEditor={() => router.push(backHref)}
            onSave={async (input) => {
              await uploadMemberProfilePicture(member.id, {
                processedImage: input.processedImage,
                originalImage: input.originalImage,
                photoEditMetadata: input.photoEditMetadata,
                photoConsentConfirmed: input.photoConsentConfirmed,
              });
              router.push(backHref);
            }}
          />
        )}
      </div>
    </main>
  );
}
