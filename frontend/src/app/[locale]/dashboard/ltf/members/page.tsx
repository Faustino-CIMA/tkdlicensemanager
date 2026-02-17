"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDisplayDate } from "@/lib/date-display";
import { Club, License, Member, getClubs, getLicenses, getMembers } from "@/lib/ltf-admin-api";

const pageSizeOptions = ["10", "25", "50", "100", "150", "200", "all"];

type MemberGroup = {
  member: Member;
  licenses: License[];
  total: number;
  activeCount: number;
  pendingCount: number;
  expiredCount: number;
  revokedCount: number;
};

type ClubGroup = {
  clubId: number;
  clubName: string;
  members: MemberGroup[];
  totalMembers: number;
  totalLicenses: number;
  activeCount: number;
  pendingCount: number;
  expiredCount: number;
  revokedCount: number;
};

function getStatusChipClasses(status: License["status"]): string {
  if (status === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "expired") {
    return "border-zinc-300 bg-zinc-100 text-zinc-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function formatIssuedAt(value: string | null): string {
  if (!value) {
    return "-";
  }
  return formatDisplayDate(value);
}

export default function LtfAdminMembersPage() {
  const t = useTranslations("LtfAdmin");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [expandedClubIds, setExpandedClubIds] = useState<number[]>([]);
  const [expandedMemberIds, setExpandedMemberIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [clubsResponse, membersResponse, licensesResponse] = await Promise.all([
        getClubs(),
        getMembers(),
        getLicenses(),
      ]);
      setClubs(clubsResponse);
      setMembers(membersResponse);
      setLicenses(licensesResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const clubById = useMemo(() => new Map(clubs.map((club) => [club.id, club])), [clubs]);

  const licensesByMember = useMemo(() => {
    const grouped = new Map<number, License[]>();
    for (const license of licenses) {
      const memberLicenses = grouped.get(license.member);
      if (memberLicenses) {
        memberLicenses.push(license);
      } else {
        grouped.set(license.member, [license]);
      }
    }
    for (const memberLicenses of grouped.values()) {
      memberLicenses.sort((left, right) => {
        const byYear = right.year - left.year;
        if (byYear !== 0) {
          return byYear;
        }
        return right.id - left.id;
      });
    }
    return grouped;
  }, [licenses]);

  const activeMembers = useMemo(() => members.filter((member) => member.is_active), [members]);

  const searchedMembers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return activeMembers;
    }
    return activeMembers.filter((member) => {
      const clubName = clubById.get(member.club)?.name.toLowerCase() ?? "";
      const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
      const licenseId = member.ltf_licenseid.toLowerCase();
      const beltRank = member.belt_rank.toLowerCase();
      const memberLicenses = licensesByMember.get(member.id) ?? [];
      const yearsText = memberLicenses.map((license) => String(license.year)).join(" ");
      const statusesText = memberLicenses.map((license) => license.status).join(" ");
      return (
        fullName.includes(normalizedQuery) ||
        clubName.includes(normalizedQuery) ||
        licenseId.includes(normalizedQuery) ||
        beltRank.includes(normalizedQuery) ||
        yearsText.includes(normalizedQuery) ||
        statusesText.includes(normalizedQuery)
      );
    });
  }, [activeMembers, clubById, licensesByMember, searchQuery]);

  const groupedClubRows = useMemo<ClubGroup[]>(() => {
    const grouped = new Map<number, { clubName: string; members: Member[] }>();
    for (const member of searchedMembers) {
      const clubName = clubById.get(member.club)?.name ?? t("unknownClub");
      const current = grouped.get(member.club);
      if (current) {
        current.members.push(member);
      } else {
        grouped.set(member.club, { clubName, members: [member] });
      }
    }

    return Array.from(grouped.entries())
      .map(([clubId, entry]) => {
        const memberGroups = [...entry.members]
          .sort((left, right) => {
            const byFirstName = left.first_name.localeCompare(right.first_name);
            if (byFirstName !== 0) {
              return byFirstName;
            }
            return left.last_name.localeCompare(right.last_name);
          })
          .map((member) => {
            const memberLicenses = licensesByMember.get(member.id) ?? [];
            const activeCount = memberLicenses.filter((license) => license.status === "active").length;
            const pendingCount = memberLicenses.filter((license) => license.status === "pending").length;
            const expiredCount = memberLicenses.filter((license) => license.status === "expired").length;
            const revokedCount = memberLicenses.filter((license) => license.status === "revoked").length;
            return {
              member,
              licenses: memberLicenses,
              total: memberLicenses.length,
              activeCount,
              pendingCount,
              expiredCount,
              revokedCount,
            };
          });

        const totalLicenses = memberGroups.reduce((sum, memberGroup) => sum + memberGroup.total, 0);
        const activeCount = memberGroups.reduce(
          (sum, memberGroup) => sum + memberGroup.activeCount,
          0
        );
        const pendingCount = memberGroups.reduce(
          (sum, memberGroup) => sum + memberGroup.pendingCount,
          0
        );
        const expiredCount = memberGroups.reduce(
          (sum, memberGroup) => sum + memberGroup.expiredCount,
          0
        );
        const revokedCount = memberGroups.reduce(
          (sum, memberGroup) => sum + memberGroup.revokedCount,
          0
        );

        return {
          clubId,
          clubName: entry.clubName,
          members: memberGroups,
          totalMembers: memberGroups.length,
          totalLicenses,
          activeCount,
          pendingCount,
          expiredCount,
          revokedCount,
        };
      })
      .sort((left, right) => left.clubName.localeCompare(right.clubName));
  }, [clubById, licensesByMember, searchedMembers, t]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(groupedClubRows.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(groupedClubRows.length / resolvedPageSize));
  const pagedClubRows = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return groupedClubRows.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, groupedClubRows, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, searchQuery]);

  useEffect(() => {
    const validClubIds = new Set(groupedClubRows.map((clubGroup) => clubGroup.clubId));
    setExpandedClubIds((previous) => previous.filter((clubId) => validClubIds.has(clubId)));
    const validMemberIds = new Set(
      groupedClubRows.flatMap((clubGroup) =>
        clubGroup.members.map((memberGroup) => memberGroup.member.id)
      )
    );
    setExpandedMemberIds((previous) =>
      previous.filter((memberId) => validMemberIds.has(memberId))
    );
  }, [groupedClubRows]);

  const expandedClubSet = useMemo(() => new Set(expandedClubIds), [expandedClubIds]);
  const expandedMemberSet = useMemo(() => new Set(expandedMemberIds), [expandedMemberIds]);

  const visibleClubIds = useMemo(() => pagedClubRows.map((clubGroup) => clubGroup.clubId), [pagedClubRows]);
  const visibleMemberIds = useMemo(
    () =>
      pagedClubRows.flatMap((clubGroup) =>
        clubGroup.members.map((memberGroup) => memberGroup.member.id)
      ),
    [pagedClubRows]
  );

  const toggleClubExpanded = (clubId: number) => {
    setExpandedClubIds((previous) =>
      previous.includes(clubId)
        ? previous.filter((item) => item !== clubId)
        : [...previous, clubId]
    );
  };

  const toggleMemberExpanded = (memberId: number) => {
    setExpandedMemberIds((previous) =>
      previous.includes(memberId)
        ? previous.filter((item) => item !== memberId)
        : [...previous, memberId]
    );
  };

  const expandAllVisibleClubs = () => {
    setExpandedClubIds((previous) => Array.from(new Set([...previous, ...visibleClubIds])));
  };

  const collapseAllVisibleClubs = () => {
    const visibleClubIdSet = new Set(visibleClubIds);
    const visibleMemberIdSet = new Set(visibleMemberIds);
    setExpandedClubIds((previous) => previous.filter((clubId) => !visibleClubIdSet.has(clubId)));
    setExpandedMemberIds((previous) =>
      previous.filter((memberId) => !visibleMemberIdSet.has(memberId))
    );
  };

  const expandAllVisibleMembers = () => {
    setExpandedClubIds((previous) => Array.from(new Set([...previous, ...visibleClubIds])));
    setExpandedMemberIds((previous) => Array.from(new Set([...previous, ...visibleMemberIds])));
  };

  const collapseAllVisibleMembers = () => {
    const visibleMemberIdSet = new Set(visibleMemberIds);
    setExpandedMemberIds((previous) =>
      previous.filter((memberId) => !visibleMemberIdSet.has(memberId))
    );
  };

  const getStatusLabel = useCallback(
    (status: License["status"]) => {
      if (status === "active") {
        return t("statusActive");
      }
      if (status === "pending") {
        return t("statusPending");
      }
      if (status === "expired") {
        return t("statusExpired");
      }
      return t("statusRevoked");
    },
    [t]
  );

  return (
    <LtfAdminLayout title={t("membersTitle")} subtitle={t("membersSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchMembersPlaceholder")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <Select value={pageSize} onValueChange={setPageSize}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={common("rowsPerPageLabel")} />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "all" ? common("rowsPerPageAll") : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={visibleClubIds.length === 0}
              onClick={expandAllVisibleClubs}
            >
              {t("expandAllClubs")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={visibleClubIds.length === 0}
              onClick={collapseAllVisibleClubs}
            >
              {t("collapseAllClubs")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={visibleMemberIds.length === 0}
              onClick={expandAllVisibleMembers}
            >
              {t("expandAllMembers")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={visibleMemberIds.length === 0}
              onClick={collapseAllVisibleMembers}
            >
              {t("collapseAllMembers")}
            </Button>
          </div>
          <div className="space-y-1 text-xs text-zinc-500">
            <p>{t("membersReadOnlyHint")}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            {t("pageLabel", { current: currentPage, total: totalPages })}
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
            >
              {t("previousPage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
            >
              {t("nextPage")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : groupedClubRows.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noMembersResultsSubtitle")} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-100 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="w-10 px-4 py-3 font-medium" />
                  <th className="px-4 py-3 font-medium">{t("clubLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("totalMembers")}</th>
                  <th className="px-4 py-3 font-medium">{t("licensesTitle")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusActive")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusPending")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusExpired")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusRevoked")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {pagedClubRows.map((clubGroup) => {
                  const clubExpanded = expandedClubSet.has(clubGroup.clubId);
                  return (
                    <Fragment key={clubGroup.clubId}>
                      <tr
                        className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
                        onClick={() => toggleClubExpanded(clubGroup.clubId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleClubExpanded(clubGroup.clubId);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={clubExpanded}
                      >
                        <td className="px-4 py-3 text-zinc-500">
                          {clubExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">{clubGroup.clubName}</td>
                        <td className="px-4 py-3">{clubGroup.totalMembers}</td>
                        <td className="px-4 py-3">{clubGroup.totalLicenses}</td>
                        <td className="px-4 py-3">{clubGroup.activeCount}</td>
                        <td className="px-4 py-3">{clubGroup.pendingCount}</td>
                        <td className="px-4 py-3">{clubGroup.expiredCount}</td>
                        <td className="px-4 py-3">{clubGroup.revokedCount}</td>
                      </tr>
                      {clubExpanded ? (
                        <tr className="bg-zinc-50/60">
                          <td colSpan={8} className="px-6 py-3">
                            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                                  <tr>
                                    <th className="w-10 px-4 py-2 font-medium" />
                                    <th className="px-4 py-2 font-medium">{t("memberLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("beltRankLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("ltfLicenseLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("licensesTitle")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusActive")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusPending")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusExpired")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusRevoked")}</th>
                                    <th className="px-4 py-2 font-medium">{t("actionsLabel")}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                  {clubGroup.members.map((memberGroup) => {
                                    const memberExpanded = expandedMemberSet.has(
                                      memberGroup.member.id
                                    );
                                    return (
                                      <Fragment key={memberGroup.member.id}>
                                        <tr
                                          className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
                                          onClick={() => toggleMemberExpanded(memberGroup.member.id)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              toggleMemberExpanded(memberGroup.member.id);
                                            }
                                          }}
                                          tabIndex={0}
                                          role="button"
                                          aria-expanded={memberExpanded}
                                        >
                                          <td className="px-4 py-2 text-zinc-500">
                                            {memberExpanded ? (
                                              <ChevronDown className="h-4 w-4" />
                                            ) : (
                                              <ChevronRight className="h-4 w-4" />
                                            )}
                                          </td>
                                          <td className="px-4 py-2 font-medium">
                                            {memberGroup.member.first_name} {memberGroup.member.last_name}
                                          </td>
                                          <td className="px-4 py-2">
                                            {memberGroup.member.belt_rank || "-"}
                                          </td>
                                          <td className="px-4 py-2">
                                            {memberGroup.member.ltf_licenseid || "-"}
                                          </td>
                                          <td className="px-4 py-2">{memberGroup.total}</td>
                                          <td className="px-4 py-2">{memberGroup.activeCount}</td>
                                          <td className="px-4 py-2">{memberGroup.pendingCount}</td>
                                          <td className="px-4 py-2">{memberGroup.expiredCount}</td>
                                          <td className="px-4 py-2">{memberGroup.revokedCount}</td>
                                          <td className="px-4 py-2" onClick={(event) => event.stopPropagation()}>
                                            <Button variant="outline" size="sm" asChild>
                                              <Link
                                                href={`/${locale}/dashboard/ltf/members/${memberGroup.member.id}`}
                                              >
                                                {t("viewMemberAction")}
                                              </Link>
                                            </Button>
                                          </td>
                                        </tr>
                                        {memberExpanded ? (
                                          <tr className="bg-zinc-50/50">
                                            <td colSpan={10} className="px-6 py-3">
                                              {memberGroup.licenses.length === 0 ? (
                                                <p className="text-sm text-zinc-500">
                                                  {t("noMemberLicensesSubtitle")}
                                                </p>
                                              ) : (
                                                <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
                                                  <table className="min-w-full text-left text-sm">
                                                    <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                                                      <tr>
                                                        <th className="px-4 py-2 font-medium">
                                                          {t("yearLabel")}
                                                        </th>
                                                        <th className="px-4 py-2 font-medium">
                                                          {t("statusLabel")}
                                                        </th>
                                                        <th className="px-4 py-2 font-medium">
                                                          {t("issuedAtLabel")}
                                                        </th>
                                                      </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-100">
                                                      {memberGroup.licenses.map((license) => (
                                                        <tr key={license.id} className="text-zinc-700">
                                                          <td className="px-4 py-2">{license.year}</td>
                                                          <td className="px-4 py-2">
                                                            <span
                                                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusChipClasses(
                                                                license.status
                                                              )}`}
                                                            >
                                                              {getStatusLabel(license.status)}
                                                            </span>
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {formatIssuedAt(license.issued_at)}
                                                          </td>
                                                        </tr>
                                                      ))}
                                                    </tbody>
                                                  </table>
                                                </div>
                                              )}
                                            </td>
                                          </tr>
                                        ) : null}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </LtfAdminLayout>
  );
}
