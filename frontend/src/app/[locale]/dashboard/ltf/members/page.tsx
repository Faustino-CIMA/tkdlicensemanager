"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  PageNotice,
  PageSizeSelect,
  resolveListPageSize,
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { useClubSelection } from "@/components/club-selection-provider";
import {
  Club,
  Member,
  MemberIssueFilter,
  getClubs,
  getMembersPage,
} from "@/lib/ltf-admin-api";

function parseMemberIssue(value: string | null): MemberIssueFilter | null {
  if (value === "no_valid_license" || value === "missing_ltf_licenseid") {
    return value;
  }
  return null;
}

type MemberStatusFilter = "all" | "active" | "inactive";

export default function LtfAdminMembersPage() {
  const t = useTranslations("LtfAdmin");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = pathname?.split("/")[1] || "en";
  const issue = parseMemberIssue(searchParams.get("issue"));

  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [memberStatusFilter, setMemberStatusFilter] = useState<MemberStatusFilter>("all");
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
            issue: issue ?? undefined,
          }),
          getMembersPage({
            page: 1,
            pageSize: 1,
            q,
            clubId,
            isActive: undefined,
            issue: issue ?? undefined,
          }),
          getMembersPage({
            page: 1,
            pageSize: 1,
            q,
            clubId,
            isActive: true,
            issue: issue ?? undefined,
          }),
          getMembersPage({
            page: 1,
            pageSize: 1,
            q,
            clubId,
            isActive: false,
            issue: issue ?? undefined,
          }),
        ]);
      setClubs(clubsResponse);
      setMembers(membersResponse.results);
      setTotalCount(membersResponse.count);
      setMemberFacetCounts({
        all: allCountRes.count,
        active: activeCountRes.count,
        inactive: inactiveCountRes.count,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, isActiveFilter, issue, membersListPageSize, searchQuery, selectedClubId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClubId, pageSize, searchQuery, isActiveFilter, issue]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const clubById = useMemo(() => new Map(clubs.map((club) => [club.id, club])), [clubs]);
  const totalPages = Math.max(1, Math.ceil(totalCount / membersListPageSize));

  const dismissIssueFilter = () => {
    router.replace(`/${locale}/dashboard/ltf/members`);
  };

  const getLicenseStatusMeta = useCallback(
    (status: string) => {
      if (status === "active") {
        return { label: t("statusActive"), tone: "success" as const };
      }
      if (status === "pending") {
        return { label: t("statusPending"), tone: "warning" as const };
      }
      if (status === "expired") {
        return { label: t("statusExpired"), tone: "neutral" as const };
      }
      return { label: t("statusRevoked"), tone: "danger" as const };
    },
    [t]
  );

  const columns = useMemo(
    () => [
      {
        key: "name",
        header: t("memberLabel"),
        render: (row: Member) => (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{`${row.first_name} ${row.last_name}`}</span>
            {row.is_club_tourist ? <StatusBadge label={t("clubTouristBadge")} tone="warning" /> : null}
          </span>
        ),
      },
      {
        key: "club",
        header: t("clubLabel"),
        render: (row: Member) => clubById.get(row.club)?.name ?? t("unknownClub"),
      },
      {
        key: "ltf_licenseid",
        header: t("ltfLicenseLabel"),
        render: (row: Member) => row.ltf_licenseid || "-",
      },
      {
        key: "belt_rank",
        header: t("beltRankLabel"),
        render: (row: Member) => row.belt_rank || "-",
      },
      {
        key: "is_active",
        header: t("statusLabel"),
        render: (row: Member) => (
          <StatusBadge
            label={row.is_active ? t("activeLabel") : t("inactiveLabel")}
            tone={row.is_active ? "success" : "neutral"}
          />
        ),
      },
      {
        key: "current_license",
        header: t("licensesTitle"),
        render: (row: Member) => {
          const current = row.current_licenses?.[0];
          if (!current) {
            return "-";
          }
          const meta = getLicenseStatusMeta(current.status);
          const extra = (row.current_licenses?.length ?? 0) > 1
            ? ` +${(row.current_licenses?.length ?? 0) - 1}`
            : "";
          return (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="text-sm">{current.year}</span>
              <StatusBadge label={`${meta.label}${extra}`} tone={meta.tone} />
            </span>
          );
        },
      },
    ],
    [clubById, getLicenseStatusMeta, t]
  );

  return (
    <LtfAdminLayout title={t("membersTitle")} subtitle={t("membersSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

      <div className="space-y-6">
        {issue ? (
          <div className="flex items-start justify-between gap-3 rounded-[var(--radius-form)] border px-4 py-3 text-sm banner-info">
            <p className="min-w-0 flex-1">
              {issue === "no_valid_license"
                ? t("membersWithoutValidLicenseFilterMessage")
                : t("membersMissingLtfLicenseIdFilterMessage")}
            </p>
            <button
              type="button"
              className="inline-flex h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0 items-center justify-center rounded-[var(--radius-form)]"
              aria-label={common("modalClose")}
              onClick={dismissIssueFilter}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

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
              issue ? undefined : (
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
              )
            }
          />

          <ListActionsRow
            actions={<p className="text-sm text-muted">{t("membersReadOnlyHint")}</p>}
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
        ) : members.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noMembersResultsSubtitle")} />
        ) : (
          <EntityTable
            columns={columns}
            rows={members}
            onRowClick={(member) => router.push(`/${locale}/dashboard/ltf/members/${member.id}`)}
          />
        )}
      </div>
    </LtfAdminLayout>
  );
}
