"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";

export default function LtfMemberPhotoPage() {
  const t = useTranslations("LtfAdmin");
  const params = useParams();
  const rawLocale = params?.locale;
  const rawId = params?.id;
  const locale = typeof rawLocale === "string" ? rawLocale : "en";
  const memberId = typeof rawId === "string" ? Number(rawId) : Number(rawId?.[0]);
  const backHref = `/${locale}/dashboard/ltf/members/${memberId}?tab=overview`;

  return (
    <LtfAdminLayout title={t("memberDetailTitleFallback")} subtitle={t("membersReadOnlyHint")}>
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={backHref}>{t("backToMembers")}</Link>
        </Button>
        <EmptyState title={t("photoSectionTitle")} description={t("memberPhotoReadOnlyMessage")} />
      </div>
    </LtfAdminLayout>
  );
}
