"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { MemberHistoryTimeline } from "@/components/history/member-history-timeline";
import { apiRequest } from "@/lib/api";
import { Member, MemberHistoryResponse, getMemberHistory, getMembers } from "@/lib/ltf-admin-api";

type MeResponse = {
  id: number;
  username: string;
  role: string;
};

export default function MemberDashboardPage() {
  const t = useTranslations("Member");
  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<MemberHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
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
    };

    loadData();
  }, [t]);

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
        )}
      </div>
    </main>
  );
}
