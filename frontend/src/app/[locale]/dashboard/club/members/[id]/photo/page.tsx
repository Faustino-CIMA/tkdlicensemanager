"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { ProfilePhotoManager } from "@/components/profile-photo/profile-photo-manager";
import { Button } from "@/components/ui/button";
import { Member, getMember, uploadMemberProfilePicture } from "@/lib/club-admin-api";

export default function ClubMemberPhotoPage() {
  const t = useTranslations("ClubAdmin");
  const params = useParams();
  const router = useRouter();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const memberId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);
  const backHref = `/${locale}/dashboard/club/members/${memberId}?tab=overview`;

  const [member, setMember] = useState<Member | null>(null);
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
      const memberResponse = await getMember(memberId);
      setMember(memberResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load member.");
    } finally {
      setIsLoading(false);
    }
  }, [memberId, t]);

  useEffect(() => {
    loadMember();
  }, [loadMember]);

  const title = member
    ? t("memberDetailTitle", { name: `${member.first_name} ${member.last_name}` })
    : t("memberDetailTitleFallback");

  return (
    <ClubAdminLayout title={title} subtitle={t("photoModalDescription")}>
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={backHref}>{t("backToMembers")}</Link>
        </Button>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : !member ? (
          <EmptyState title={t("noResultsTitle")} description={t("memberNotFound")} />
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
              // #region agent log
              fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "025755",
                },
                body: JSON.stringify({
                  sessionId: "025755",
                  runId: "initial-photo-save",
                  hypothesisId: "H1",
                  location: "frontend/src/app/[locale]/dashboard/club/members/[id]/photo/page.tsx:onSave:beforeUpload",
                  message: "photo page invoking uploadMemberProfilePicture",
                  data: {
                    memberId: member.id,
                    processedSize: input.processedImage.size,
                    processedType: input.processedImage.type,
                    originalSize: input.originalImage?.size ?? null,
                    originalType: input.originalImage?.type ?? null,
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
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
    </ClubAdminLayout>
  );
}
