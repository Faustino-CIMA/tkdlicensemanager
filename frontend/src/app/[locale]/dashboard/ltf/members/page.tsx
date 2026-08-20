"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  ExpandableTable,
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  NestedTable,
  PageNotice,
  PageSizeSelect,
  dataRowClickableClass,
  dataTableClass,
  dataTdClass,
  dataThClass,
  dataTheadClass,
  resolveListPageSize,
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDisplayDate } from "@/lib/date-display";
import { useClubSelection } from "@/components/club-selection-provider";
import {
  Club,
  License,
  Member,
  getClubs,
  getLicensesList,
  getMembersPage,
} from "@/lib/ltf-admin-api";

type MemberStatusFilter = "all" | "active" | "inactive";

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

function getStatusTone(status: License["status"]): "success" | "warning" | "neutral" | "danger" {
  if (status === "active") {
    return "success";
  }
  if (status === "pending") {
    return "warning";
  }
  if (status === "expired") {
    return "neutral";
  }
  return "danger";
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
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [memberStatusFilter, setMemberStatusFilter] = useState<MemberStatusFilter>("active");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [memberFacetCounts, setMemberFacetCounts] = useState({
    all: 0,
    active: 0,
    inactive: 0,
  });
  const { selectedClubId } = useClubSelection();

  const membersListPageSize = useMemo(
    () => resolveListPageSize(pageSize, totalCount),
    [pageSize, totalCount]
  );

  const isActiveFilter = useMemo(() => {
    if (memberStatusFilter === "all") {
      return undefined;
    }
    return memberStatusFilter === "active";
  }, [memberStatusFilter]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const q = searchQuery || undefined;
    const clubId = selectedClubId ?? undefined;
    try {
      const [clubsResponse, membersResponse, allCountRes, activeCountRes, inactiveCountRes] =
        await Promise.all([
          getClubs(),
          getMembersPage({
            page: currentPage,
            pageSize: membersListPageSize,
            q,
            clubId,
            isActive: isActiveFilter,
          }),
          getMembersPage({ page: 1, pageSize: 1, q, clubId, isActive: undefined }),
          getMembersPage({ page: 1, pageSize: 1, q, clubId, isActive: true }),
          getMembersPage({ page: 1, pageSize: 1, q, clubId, isActive: false }),
        ]);
      setClubs(clubsResponse);
      setMembers(membersResponse.results);
      setTotalCount(membersResponse.count);
      setMemberFacetCounts({
        all: allCountRes.count,
        active: activeCountRes.count,
        inactive: inactiveCountRes.count,
      });
      const memberIds = membersResponse.results.map((member) => member.id);
      if (memberIds.length > 0) {
        const licensesResponse = await getLicensesList({ memberIds });
        setLicenses(licensesResponse);
      } else {
        setLicenses([]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, isActiveFilter, membersListPageSize, searchQuery, selectedClubId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClubId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

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

  const groupedClubRows = useMemo<ClubGroup[]>(() => {
    const grouped = new Map<number, { clubName: string; members: Member[] }>();
    for (const member of members) {
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
  }, [clubById, licensesByMember, members, t]);

  const totalPages = Math.max(1, Math.ceil(totalCount / membersListPageSize));
  const pagedClubRows = groupedClubRows;

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, searchQuery, isActiveFilter]);

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
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <ListToolbarPanel
            search={
              <Input
                className="w-full max-w-xs"
                placeholder={t("searchMembersPlaceholder")}
                aria-label={t("searchMembersPlaceholder")}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            }
            pageSize={
              <PageSizeSelect
                value={pageSize}
                onChange={setPageSize}
                ariaLabel={common("rowsPerPageLabel")}
                allLabel={common("rowsPerPageAll")}
              />
            }
            filters={
              <FilterPills
                ariaLabel={t("membersStatusFilterAriaLabel")}
                value={memberStatusFilter}
                onChange={setMemberStatusFilter}
                options={[
                  { value: "all", title: t("filterAllTitle"), count: memberFacetCounts.all },
                  { value: "active", title: t("filterActiveTitle"), count: memberFacetCounts.active },
                  {
                    value: "inactive",
                    title: t("filterInactiveTitle"),
                    count: memberFacetCounts.inactive,
                  },
                ]}
              />
            }
          />

          <ListActionsRow
            actions={
              <>
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value === "expand-clubs") {
                      expandAllVisibleClubs();
                    }
                    if (value === "collapse-clubs") {
                      collapseAllVisibleClubs();
                    }
                    if (value === "expand-members") {
                      expandAllVisibleMembers();
                    }
                    if (value === "collapse-members") {
                      collapseAllVisibleMembers();
                    }
                  }}
                >
                  <SelectTrigger className="min-w-[11rem]" aria-label={t("membersMenuLabel")}>
                    <SelectValue placeholder={t("membersMenuLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expand-clubs" disabled={visibleClubIds.length === 0}>
                      {t("expandAllClubs")}
                    </SelectItem>
                    <SelectItem value="collapse-clubs" disabled={visibleClubIds.length === 0}>
                      {t("collapseAllClubs")}
                    </SelectItem>
                    <SelectItem value="expand-members" disabled={visibleMemberIds.length === 0}>
                      {t("expandAllMembers")}
                    </SelectItem>
                    <SelectItem value="collapse-members" disabled={visibleMemberIds.length === 0}>
                      {t("collapseAllMembers")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted">{t("membersReadOnlyHint")}</p>
              </>
            }
            pagination={
              <ListPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPrevious={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                onNext={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                pageLabel={t("pageLabel", { current: currentPage, total: totalPages })}
                previousLabel={t("previousPage")}
                nextLabel={t("nextPage")}
              />
            }
          />
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : groupedClubRows.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noMembersResultsSubtitle")} />
        ) : (
          <ExpandableTable>
            <table className={dataTableClass}>
              <thead className={dataTheadClass}>
                <tr>
                  <th className={`w-10 ${dataThClass}`} />
                  <th className={dataThClass}>{t("clubLabel")}</th>
                  <th className={dataThClass}>{t("totalMembers")}</th>
                  <th className={dataThClass}>{t("licensesTitle")}</th>
                  <th className={dataThClass}>{t("statusActive")}</th>
                  <th className={dataThClass}>{t("statusPending")}</th>
                  <th className={dataThClass}>{t("statusExpired")}</th>
                  <th className={dataThClass}>{t("statusRevoked")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {pagedClubRows.map((clubGroup) => {
                  const clubExpanded = expandedClubSet.has(clubGroup.clubId);
                  return (
                    <Fragment key={clubGroup.clubId}>
                      <tr
                        className={dataRowClickableClass}
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
                        <td className={`${dataTdClass} text-muted`}>
                          {clubExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className={`${dataTdClass} font-medium`}>{clubGroup.clubName}</td>
                        <td className={dataTdClass}>{clubGroup.totalMembers}</td>
                        <td className={dataTdClass}>{clubGroup.totalLicenses}</td>
                        <td className={dataTdClass}>{clubGroup.activeCount}</td>
                        <td className={dataTdClass}>{clubGroup.pendingCount}</td>
                        <td className={dataTdClass}>{clubGroup.expiredCount}</td>
                        <td className={dataTdClass}>{clubGroup.revokedCount}</td>
                      </tr>
                      {clubExpanded ? (
                        <tr className="bg-secondary/60">
                          <td colSpan={8} className="px-6 py-3">
                            <NestedTable>
                              <table className={dataTableClass}>
                                <thead className={dataTheadClass}>
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
                                <tbody className="divide-y divide-border/80">
                                  {clubGroup.members.map((memberGroup) => {
                                    const memberExpanded = expandedMemberSet.has(
                                      memberGroup.member.id
                                    );
                                    return (
                                      <Fragment key={memberGroup.member.id}>
                                        <tr
                                          className={dataRowClickableClass}
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
                                          <td className="px-4 py-2 text-muted">
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
                                          <tr className="bg-secondary/50">
                                            <td colSpan={10} className="px-6 py-3">
                                              {memberGroup.licenses.length === 0 ? (
                                                <p className="text-sm text-muted">
                                                  {t("noMemberLicensesSubtitle")}
                                                </p>
                                              ) : (
                                                <NestedTable>
                                                  <table className={dataTableClass}>
                                                    <thead className={dataTheadClass}>
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
                                                    <tbody className="divide-y divide-border/80">
                                                      {memberGroup.licenses.map((license) => (
                                                        <tr
                                                          key={license.id}
                                                          className="h-[var(--table-row-height)] text-foreground"
                                                        >
                                                          <td className="px-4 py-2">{license.year}</td>
                                                          <td className="px-4 py-2">
                                                            <StatusBadge
                                                              label={getStatusLabel(license.status)}
                                                              tone={getStatusTone(license.status)}
                                                            />
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {formatIssuedAt(license.issued_at)}
                                                          </td>
                                                        </tr>
                                                      ))}
                                                    </tbody>
                                                  </table>
                                                </NestedTable>
                                              )}
                                            </td>
                                          </tr>
                                        ) : null}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </NestedTable>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </ExpandableTable>
        )}
      </div>
    </LtfAdminLayout>
  );
}
