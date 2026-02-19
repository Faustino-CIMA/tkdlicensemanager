"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { useClubSelection } from "@/components/club-selection-provider";
import {
  License,
  LicenseType,
  Member,
  getClubs,
  getLicenseTypes,
  getLicensesPage,
  getMembersList,
} from "@/lib/club-admin-api";
import { formatDisplayDate } from "@/lib/date-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MemberLicenseRow = {
  member: Member;
  allLicenses: License[];
  visibleLicenses: License[];
  activeCount: number;
  pendingCount: number;
  expiredCount: number;
};

export default function ClubAdminLicensesPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const { selectedClubId, setSelectedClubId } = useClubSelection();
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [licenseTypes, setLicenseTypes] = useState<LicenseType[]>([]);
  const [expandedMemberIds, setExpandedMemberIds] = useState<number[]>([]);
  const [expandedStateHydrated, setExpandedStateHydrated] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["10", "25", "50", "100", "150", "200"];

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const clubsResponse = await getClubs();
      let effectiveClubId = selectedClubId ?? null;
      if (clubsResponse.length > 0 && !effectiveClubId) {
        effectiveClubId = clubsResponse[0].id;
        setSelectedClubId(effectiveClubId);
      }

      const licenseTypesPromise = getLicenseTypes();
      if (!effectiveClubId) {
        const licenseTypesResponse = await licenseTypesPromise;
        setLicenseTypes(licenseTypesResponse);
        setLicenses([]);
        setMembers([]);
        setTotalCount(0);
        return;
      }

      const licensesResponse = await getLicensesPage({
        page: currentPage,
        pageSize: Number(pageSize),
        clubId: effectiveClubId,
        q: searchQuery || undefined,
      });
      setLicenses(licensesResponse.results);
      setTotalCount(licensesResponse.count);

      const memberIds = Array.from(new Set(licensesResponse.results.map((license) => license.member)));
      if (memberIds.length > 0) {
        const membersResponse = await getMembersList({
          clubId: effectiveClubId,
          ids: memberIds,
        });
        setMembers(membersResponse);
      } else {
        setMembers([]);
      }

      const licenseTypesResponse = await licenseTypesPromise;
      setLicenseTypes(licenseTypesResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load licenses.");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, searchQuery, selectedClubId, setSelectedClubId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const memberById = useMemo(() => {
    return new Map(members.map((member) => [member.id, member]));
  }, [members]);

  const memberRows = useMemo(() => {
    const grouped = new Map<number, License[]>();
    for (const license of licenses) {
      const existing = grouped.get(license.member);
      if (existing) {
        existing.push(license);
      } else {
        grouped.set(license.member, [license]);
      }
    }
    const rows: MemberLicenseRow[] = [];
    for (const [memberId, memberLicenses] of grouped.entries()) {
      const member = memberById.get(memberId);
      if (!member) {
        continue;
      }
      const allLicenses = [...memberLicenses].sort((a, b) => b.year - a.year || b.id - a.id);
      rows.push({
        member,
        allLicenses,
        visibleLicenses: allLicenses,
        activeCount: allLicenses.filter((license) => license.status === "active").length,
        pendingCount: allLicenses.filter((license) => license.status === "pending").length,
        expiredCount: allLicenses.filter((license) => license.status === "expired").length,
      });
    }
    return rows.sort((left, right) => {
      const byLastName = left.member.last_name.localeCompare(right.member.last_name);
      if (byLastName !== 0) {
        return byLastName;
      }
      return left.member.first_name.localeCompare(right.member.first_name);
    });
  }, [licenses, memberById]);

  const expandableMemberIds = useMemo(() => {
    return memberRows.map((row) => row.member.id);
  }, [memberRows]);
  const expandableMemberIdSet = useMemo(
    () => new Set(expandableMemberIds),
    [expandableMemberIds]
  );
  const expandedStorageKey = useMemo(
    () => `club-licenses-expanded:${selectedClubId ?? "all"}`,
    [selectedClubId]
  );

  const licenseTypeNameById = useMemo(
    () => new Map(licenseTypes.map((licenseType) => [licenseType.id, licenseType.name])),
    [licenseTypes]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / Number(pageSize)));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubId, pageSize]);

  useEffect(() => {
    setExpandedStateHydrated(false);
    if (typeof window === "undefined") {
      setExpandedStateHydrated(true);
      return;
    }
    try {
      const storedValue = window.localStorage.getItem(expandedStorageKey);
      if (!storedValue) {
        setExpandedMemberIds([]);
        return;
      }
      const parsedValue = JSON.parse(storedValue);
      if (Array.isArray(parsedValue)) {
        setExpandedMemberIds(
          parsedValue
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        );
        return;
      }
      setExpandedMemberIds([]);
    } catch {
      setExpandedMemberIds([]);
    } finally {
      setExpandedStateHydrated(true);
    }
  }, [expandedStorageKey]);

  useEffect(() => {
    setExpandedMemberIds((previous) => {
      const next = previous.filter((memberId) => expandableMemberIdSet.has(memberId));
      return next.length === previous.length ? previous : next;
    });
  }, [expandableMemberIdSet]);

  useEffect(() => {
    if (!expandedStateHydrated || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(expandedStorageKey, JSON.stringify(expandedMemberIds));
    } catch {
      // Ignore browser storage failures.
    }
  }, [expandedMemberIds, expandedStateHydrated, expandedStorageKey]);

  const expandedMemberSet = useMemo(
    () => new Set(expandedMemberIds),
    [expandedMemberIds]
  );
  const pagedMemberIds = useMemo(
    () => memberRows.map((row) => row.member.id),
    [memberRows]
  );
  const pagedMemberIdSet = useMemo(() => new Set(pagedMemberIds), [pagedMemberIds]);
  const allPagedExpanded =
    pagedMemberIds.length > 0 && pagedMemberIds.every((memberId) => expandedMemberSet.has(memberId));
  const hasExpandedOnPage = pagedMemberIds.some((memberId) => expandedMemberSet.has(memberId));

  const toggleMemberExpanded = (memberId: number) => {
    setExpandedMemberIds((previous) =>
      previous.includes(memberId)
        ? previous.filter((id) => id !== memberId)
        : [...previous, memberId]
    );
  };

  const expandAllOnPage = () => {
    setExpandedMemberIds((previous) => {
      const next = new Set(previous);
      for (const memberId of pagedMemberIds) {
        next.add(memberId);
      }
      return Array.from(next);
    });
  };

  const collapseAllOnPage = () => {
    setExpandedMemberIds((previous) => previous.filter((memberId) => !pagedMemberIdSet.has(memberId)));
  };

  const getStatusLabel = (status: License["status"]) => {
    if (status === "active") {
      return t("statusActive");
    }
    if (status === "expired") {
      return t("statusExpired");
    }
    if (status === "pending") {
      return t("statusPending");
    }
    return status;
  };

  const getStatusChipClasses = (status: License["status"]) => {
    if (status === "active") {
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    }
    if (status === "expired") {
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
    }
    if (status === "pending") {
      return "border-amber-200 bg-amber-50 text-amber-700";
    }
    return "border-rose-200 bg-rose-50 text-rose-700";
  };

  const formatIssuedAt = (value: string | null) => {
    if (!value) {
      return "—";
    }
    return formatDisplayDate(value);
  };

  return (
    <ClubAdminLayout title={t("licensesTitle")} subtitle={t("licensesSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchLicensesPlaceholder")}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
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
              onClick={expandAllOnPage}
              disabled={pagedMemberIds.length === 0 || allPagedExpanded}
            >
              {t("expandAllMembers")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={collapseAllOnPage}
              disabled={!hasExpandedOnPage}
            >
              {t("collapseAllMembers")}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            {t("pageLabel", { current: currentPage, total: totalPages })}
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            >
              {t("previousPage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            >
              {t("nextPage")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : memberRows.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noLicensesResultsSubtitle")} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-100 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="w-10 px-4 py-3 font-medium" />
                  <th className="px-4 py-3 font-medium">{t("memberLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("totalLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusActive")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusPending")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusExpired")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {memberRows.map((row) => {
                  const isExpanded = expandedMemberSet.has(row.member.id);
                  const memberName = `${row.member.first_name} ${row.member.last_name}`;
                  return (
                    <Fragment key={row.member.id}>
                      <tr
                        className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
                        onClick={() => toggleMemberExpanded(row.member.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleMemberExpanded(row.member.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isExpanded}
                      >
                        <td className="px-4 py-3 text-zinc-500">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{memberName}</span>
                            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                              {row.allLicenses.length}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">{row.allLicenses.length}</td>
                        <td className="px-4 py-3">{row.activeCount}</td>
                        <td className="px-4 py-3">{row.pendingCount}</td>
                        <td className="px-4 py-3">{row.expiredCount}</td>
                      </tr>
                      {isExpanded ? (
                        <tr className="bg-zinc-50/60">
                          <td colSpan={6} className="px-6 py-3">
                            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                                  <tr>
                                    <th className="px-4 py-2 font-medium">{t("yearLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("licenseTypeLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("issuedAtLabel")}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                  {row.visibleLicenses.map((license) => (
                                    <tr key={license.id} className="text-zinc-700">
                                      <td className="px-4 py-2">{license.year}</td>
                                      <td className="px-4 py-2">
                                        {licenseTypeNameById.get(license.license_type) ??
                                          t("unknownLicenseType")}
                                      </td>
                                      <td className="px-4 py-2">
                                        <span
                                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusChipClasses(
                                            license.status
                                          )}`}
                                        >
                                          {getStatusLabel(license.status)}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2">{formatIssuedAt(license.issued_at)}</td>
                                    </tr>
                                  ))}
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
    </ClubAdminLayout>
  );
}
