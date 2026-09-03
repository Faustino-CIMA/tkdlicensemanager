"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleAlert, Trash2, X } from "lucide-react";

import { ActionNotices } from "@/components/ui/list-page-chrome";
import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { resolveAssignedClubId, useClubSelection } from "@/components/club-selection-provider";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
import { StatusBadge } from "@/components/ui/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/api";
import {
  Member,
  MemberIssueFilter,
  getClubs,
  getMember,
  getMembersPage,
  updateMember,
} from "@/lib/club-admin-api";
import { formatDisplayDate } from "@/lib/date-display";

type AuthMeResponse = { role: string };

type MemberStatusFilter = "all" | "active" | "inactive";

function isMemberStatusFilter(value: unknown): value is MemberStatusFilter {
  return value === "all" || value === "active" || value === "inactive";
}

function parseMemberIssue(value: string | null, legacyFilter: string | null): MemberIssueFilter | null {
  if (value === "no_valid_license" || value === "missing_ltf_licenseid") {
    return value;
  }
  if (legacyFilter === "without_valid_license") {
    return "no_valid_license";
  }
  return null;
}

function memberStatusFilterFromLegacySwitches(parsed: {
  showActive?: boolean;
  showInactive?: boolean;
}): MemberStatusFilter {
  const { showActive: active, showInactive: inactive } = parsed;
  if (typeof active === "boolean" && typeof inactive === "boolean") {
    if (active && inactive) {
      return "all";
    }
    if (!active && inactive) {
      return "inactive";
    }
    return "active";
  }
  return "active";
}

/** Matches backend `API_PAGINATION_MAX_PAGE_SIZE` (see `backend/config/pagination.py`). */
const MEMBERS_LIST_PAGE_SIZE_CAP = 200;

const BATCH_DELETE_STORAGE_KEY = "club_members_batch_delete_payload";
const ORDER_LICENSE_STORAGE_KEY = "club_members_order_license_payload";
const QUICK_PRINT_STORAGE_KEY = "club_quick_print_payload";

function memberToUpdateBody(member: Member, is_active: boolean) {
  return {
    club: member.club,
    first_name: member.first_name,
    last_name: member.last_name,
    sex: member.sex,
    email: member.email || undefined,
    wt_licenseid: member.wt_licenseid || undefined,
    ltf_licenseid: member.ltf_licenseid || undefined,
    date_of_birth: member.date_of_birth,
    belt_rank: member.belt_rank || undefined,
    is_active,
  };
}

export default function ClubAdminMembersPage() {
  const t = useTranslations("ClubAdmin");
  const importT = useTranslations("Import");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = pathname?.split("/")[1] || "en";
  const { selectedClubId, setSelectedClubId } = useClubSelection();
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const lastSelectedMemberIdRef = useRef<number | null>(null);
  const rowSelectModifierRef = useRef({
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  });
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [memberStatusFilter, setMemberStatusFilter] = useState<MemberStatusFilter>("active");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [statusFilterHydrated, setStatusFilterHydrated] = useState(false);
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<number[]>([]);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [pendingRowStatusMember, setPendingRowStatusMember] = useState<Member | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [actionsHintOpen, setActionsHintOpen] = useState(false);
  const [bulkStatusBusy, setBulkStatusBusy] = useState(false);
  const issue = parseMemberIssue(searchParams.get("issue"), searchParams.get("filter"));

  const pageSizeOptions = ["50", "150", "300", "all"];

  const membersListPageSize = useMemo(() => {
    if (pageSize === "all") {
      return Math.min(Math.max(totalCount, 1), MEMBERS_LIST_PAGE_SIZE_CAP);
    }
    const n = Number(pageSize);
    if (!Number.isFinite(n) || n <= 0) {
      return 50;
    }
    return Math.min(n, MEMBERS_LIST_PAGE_SIZE_CAP);
  }, [pageSize, totalCount]);

  const isActiveFilter = useMemo(() => {
    if (issue) {
      return true;
    }
    if (memberStatusFilter === "all") {
      return undefined;
    }
    if (memberStatusFilter === "active") {
      return true;
    }
    return false;
  }, [issue, memberStatusFilter]);

  const [memberFacetCounts, setMemberFacetCounts] = useState({
    all: 0,
    active: 0,
    inactive: 0,
  });

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
          }),
          getMembersPage({
            page: 1,
            pageSize: 1,
            q,
            clubId,
            isActive: true,
          }),
          getMembersPage({
            page: 1,
            pageSize: 1,
            q,
            clubId,
            isActive: false,
          }),
        ]);
      setMembers(membersResponse.results);
      setTotalCount(membersResponse.count);
      setMemberFacetCounts({
        all: allCountRes.count,
        active: activeCountRes.count,
        inactive: inactiveCountRes.count,
      });
      const assignedClubId = resolveAssignedClubId(clubsResponse, selectedClubId);
      if (assignedClubId !== selectedClubId) {
        setSelectedClubId(assignedClubId);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setIsLoading(false);
    }
  }, [
    currentPage,
    membersListPageSize,
    searchQuery,
    selectedClubId,
    setSelectedClubId,
    isActiveFilter,
    issue,
  ]);

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

  useEffect(() => {
    let isMounted = true;
    const loadCurrentUserRole = async () => {
      try {
        const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
        if (isMounted) {
          setCurrentRole(me.role);
        }
      } catch {
        if (isMounted) {
          setCurrentRole(null);
        }
      }
    };
    loadCurrentUserRole();
    return () => {
      isMounted = false;
    };
  }, []);

  const canManageMembers = currentRole === "club_admin";

  const selectedIdsStorageKey = useMemo(
    () => `club_members_selected_ids:${selectedClubId ?? "all"}`,
    [selectedClubId]
  );
  const statusSwitchesStorageKey = useMemo(
    () => `club_members_status_switches:${selectedClubId ?? "all"}`,
    [selectedClubId]
  );

  const statusUpdatingSet = useMemo(
    () => new Set(statusUpdatingIds),
    [statusUpdatingIds]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / membersListPageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubId, pageSize, isActiveFilter, issue]);

  const dismissIssueFilter = () => {
    router.replace(`/${locale}/dashboard/club/members`);
  };

  useEffect(() => {
    setSelectionHydrated(false);
    if (typeof window === "undefined") {
      setSelectionHydrated(true);
      return;
    }
    try {
      const storedValue = window.sessionStorage.getItem(selectedIdsStorageKey);
      if (!storedValue) {
        setSelectedIds([]);
        lastSelectedMemberIdRef.current = null;
        return;
      }
      const parsedValue = JSON.parse(storedValue);
      if (Array.isArray(parsedValue)) {
        const restoredIds = parsedValue
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0);
        setSelectedIds(restoredIds);
        lastSelectedMemberIdRef.current = restoredIds.at(-1) ?? null;
        return;
      }
      setSelectedIds([]);
      lastSelectedMemberIdRef.current = null;
    } catch {
      setSelectedIds([]);
      lastSelectedMemberIdRef.current = null;
    } finally {
      setSelectionHydrated(true);
    }
  }, [selectedIdsStorageKey]);

  useEffect(() => {
    setStatusFilterHydrated(false);
    if (typeof window === "undefined") {
      setStatusFilterHydrated(true);
      return;
    }
    if (issue) {
      setMemberStatusFilter("active");
      setStatusFilterHydrated(true);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(statusSwitchesStorageKey);
      if (!raw) {
        setMemberStatusFilter("active");
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && parsed !== null) {
          const record = parsed as { memberStatusFilter?: unknown; showActive?: unknown; showInactive?: unknown };
          if (isMemberStatusFilter(record.memberStatusFilter)) {
            setMemberStatusFilter(record.memberStatusFilter);
            return;
          }
          if (typeof record.showActive === "boolean" && typeof record.showInactive === "boolean") {
            setMemberStatusFilter(
              memberStatusFilterFromLegacySwitches({
                showActive: record.showActive,
                showInactive: record.showInactive,
              })
            );
            return;
          }
        }
      } catch {
        /* legacy string */
      }
      if (raw === "inactive") {
        setMemberStatusFilter("inactive");
      } else if (raw === "all") {
        setMemberStatusFilter("all");
      } else {
        setMemberStatusFilter("active");
      }
    } finally {
      setStatusFilterHydrated(true);
    }
  }, [issue, searchParams, statusSwitchesStorageKey]);

  useEffect(() => {
    if (!selectionHydrated || typeof window === "undefined") {
      return;
    }
    if (selectedIds.length > 0) {
      window.sessionStorage.setItem(selectedIdsStorageKey, JSON.stringify(selectedIds));
    } else {
      window.sessionStorage.removeItem(selectedIdsStorageKey);
    }
  }, [selectedIds, selectedIdsStorageKey, selectionHydrated]);

  useEffect(() => {
    if (!statusFilterHydrated || typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem(
      statusSwitchesStorageKey,
      JSON.stringify({ memberStatusFilter })
    );
  }, [memberStatusFilter, statusFilterHydrated, statusSwitchesStorageKey]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    const validIds = new Set(members.map((member) => member.id));
    setSelectedIds((previous) => {
      const next = previous.filter((id) => validIds.has(id));
      if (next.length !== previous.length) {
        lastSelectedMemberIdRef.current = next.at(-1) ?? null;
      }
      return next.length === previous.length ? previous : next;
    });
  }, [members, isLoading]);

  const allFilteredIds = useMemo(
    () => members.map((member) => member.id),
    [members]
  );
  const selectedVisibleCount = useMemo(
    () => allFilteredIds.filter((id) => selectedIds.includes(id)).length,
    [allFilteredIds, selectedIds]
  );
  const hiddenSelectedCount = Math.max(selectedIds.length - selectedVisibleCount, 0);
  const allSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id));

  const selectedStatusBreakdown = useMemo(() => {
    const selectedOnPage = members.filter((member) => selectedIds.includes(member.id));
    const activeCount = selectedOnPage.filter((member) => member.is_active).length;
    const inactiveCount = selectedOnPage.filter((member) => !member.is_active).length;
    const unknownCount = Math.max(0, selectedIds.length - selectedOnPage.length);
    const unknownLikelyActive = memberStatusFilter === "active";
    const unknownLikelyInactive = memberStatusFilter === "inactive";
    const effectiveActive = activeCount + (unknownLikelyActive ? unknownCount : 0);
    const effectiveInactive = inactiveCount + (unknownLikelyInactive ? unknownCount : 0);
    const unknownMixed = unknownCount > 0 && memberStatusFilter === "all";
    return {
      total: selectedIds.length,
      showActivate: effectiveInactive > 0 || unknownMixed,
      showDeactivate: effectiveActive > 0 || unknownMixed,
    };
  }, [memberStatusFilter, members, selectedIds]);

  const toggleSelectAll = () => {
    if (!canManageMembers) {
      return;
    }
    if (allSelected) {
      setSelectedIds([]);
      lastSelectedMemberIdRef.current = null;
    } else {
      setSelectedIds(allFilteredIds);
      lastSelectedMemberIdRef.current = allFilteredIds.at(-1) ?? null;
    }
  };

  const clearSelection = () => {
    setSelectedIds([]);
    lastSelectedMemberIdRef.current = null;
  };

  const toggleSelectRow = (
    id: number,
    modifierState?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ) => {
    if (!canManageMembers) {
      return;
    }
    const hasRangeModifier = Boolean(modifierState?.shiftKey);
    setSelectedIds((prev) => {
      const isSelected = prev.includes(id);
      const next = new Set(prev);
      const nextCheckedState = !isSelected;
      let appliedRangeSelection = false;

      if (hasRangeModifier && lastSelectedMemberIdRef.current !== null) {
        const orderedIds = members.map((member) => member.id);
        const anchorIndex = orderedIds.indexOf(lastSelectedMemberIdRef.current);
        const targetIndex = orderedIds.indexOf(id);
        if (anchorIndex !== -1 && targetIndex !== -1) {
          const [from, to] =
            anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
          const rangeIds = orderedIds.slice(from, to + 1);
          if (nextCheckedState) {
            rangeIds.forEach((rowId) => next.add(rowId));
          } else {
            rangeIds.forEach((rowId) => next.delete(rowId));
          }
          appliedRangeSelection = true;
        }
      }

      if (!appliedRangeSelection) {
        if (isSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return Array.from(next);
    });
    lastSelectedMemberIdRef.current = id;
  };

  const startCreate = () => {
    if (!canManageMembers) {
      return;
    }
    router.push(`/${locale}/dashboard/club/members/new`);
  };

  const handleDelete = (member: Member) => {
    if (!canManageMembers) {
      return;
    }
    router.push(`/${locale}/dashboard/club/members/${member.id}/delete`);
  };

  const openBatchDeletePage = () => {
    if (!canManageMembers || selectedIds.length === 0) {
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        BATCH_DELETE_STORAGE_KEY,
        JSON.stringify({
          selectedIds,
          selectedClubId,
        })
      );
    }
    router.push(`/${locale}/dashboard/club/members/batch-delete`);
  };

  const openOrderPage = () => {
    if (!canManageMembers || selectedIds.length === 0) {
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        ORDER_LICENSE_STORAGE_KEY,
        JSON.stringify({
          selectedIds,
          selectedClubId,
          year: new Date().getFullYear(),
        })
      );
    }
    router.push(`/${locale}/dashboard/club/members/order-licenses`);
  };

  const openQuickPrintPage = () => {
    if (!canManageMembers || selectedIds.length === 0 || !selectedClubId) {
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        QUICK_PRINT_STORAGE_KEY,
        JSON.stringify({
          source: "members",
          selectedClubId,
          memberIds: selectedIds,
          licenseIds: [],
          printerProfileId: null,
        })
      );
    }
    router.push(`/${locale}/dashboard/club/print-jobs/quick-print`);
  };

  const applyMemberStatus = async (member: Member, nextIsActive: boolean) => {
    if (!canManageMembers) {
      return;
    }
    if (statusUpdatingSet.has(member.id)) {
      return;
    }
    setErrorMessage(null);
    setMembers((previous) =>
      previous.map((item) => (item.id === member.id ? { ...item, is_active: nextIsActive } : item))
    );
    setStatusUpdatingIds((previous) => [...previous, member.id]);
    try {
      const updatedMember = await updateMember(member.id, memberToUpdateBody(member, nextIsActive));
      setMembers((previous) =>
        previous.map((item) => (item.id === updatedMember.id ? updatedMember : item))
      );
    } catch (error) {
      setMembers((previous) =>
        previous.map((item) => (item.id === member.id ? { ...item, is_active: member.is_active } : item))
      );
      setErrorMessage(error instanceof Error ? error.message : "Failed to update member status.");
    } finally {
      setStatusUpdatingIds((previous) => previous.filter((id) => id !== member.id));
    }
  };

  const confirmRowStatusChange = () => {
    if (!pendingRowStatusMember) {
      return;
    }
    const next = !pendingRowStatusMember.is_active;
    void applyMemberStatus(pendingRowStatusMember, next);
    setPendingRowStatusMember(null);
  };

  const runBulkStatusChange = async (targetActive: boolean) => {
    if (!canManageMembers || selectedIds.length === 0) {
      return;
    }
    setBulkStatusBusy(true);
    setErrorMessage(null);
    let ok = 0;
    let failed = 0;
    try {
      for (const id of selectedIds) {
        try {
          const cached = members.find((member) => member.id === id);
          if (cached && cached.is_active === targetActive) {
            ok += 1;
            continue;
          }
          const m = cached ?? (await getMember(id));
          if (m.is_active === targetActive) {
            ok += 1;
            continue;
          }
          await updateMember(id, memberToUpdateBody(m, targetActive));
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        setErrorMessage(t("bulkStatusPartialResult", { ok, failed }));
      }
      await loadData();
    } finally {
      setBulkStatusBusy(false);
      setBulkStatusOpen(false);
    }
  };

  return (
    <ClubAdminLayout title={t("membersTitle")} subtitle={t("membersSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <Modal
        isOpen={Boolean(pendingRowStatusMember)}
        onClose={() => setPendingRowStatusMember(null)}
        title={t("memberRowStatusConfirmTitle")}
        description={
          pendingRowStatusMember
            ? t("memberRowStatusConfirmDescription", {
                name: `${pendingRowStatusMember.first_name} ${pendingRowStatusMember.last_name}`.trim(),
                nextStatus: pendingRowStatusMember.is_active ? t("inactiveLabel") : t("activeLabel"),
              })
            : undefined
        }
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setPendingRowStatusMember(null)}>
            {common("deleteCancelButton")}
          </Button>
          <Button onClick={confirmRowStatusChange}>{t("memberRowStatusConfirmAction")}</Button>
        </div>
      </Modal>

      <Modal
        isOpen={bulkStatusOpen}
        onClose={() => !bulkStatusBusy && setBulkStatusOpen(false)}
        title={t("bulkChangeStatusTitle")}
        description={
          selectedStatusBreakdown.showActivate && !selectedStatusBreakdown.showDeactivate
            ? t("bulkChangeStatusSetActiveDescription", { count: selectedStatusBreakdown.total })
            : selectedStatusBreakdown.showDeactivate && !selectedStatusBreakdown.showActivate
              ? t("bulkChangeStatusSetInactiveDescription", { count: selectedStatusBreakdown.total })
              : t("bulkChangeStatusMixedDescription", { count: selectedStatusBreakdown.total })
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button
            variant="outline"
            disabled={bulkStatusBusy}
            onClick={() => setBulkStatusOpen(false)}
          >
            {common("deleteCancelButton")}
          </Button>
          {selectedStatusBreakdown.showActivate ? (
            <Button
              variant={selectedStatusBreakdown.showDeactivate ? "secondary" : "default"}
              disabled={bulkStatusBusy}
              onClick={() => void runBulkStatusChange(true)}
            >
              {t("bulkActivateSelected")}
            </Button>
          ) : null}
          {selectedStatusBreakdown.showDeactivate ? (
            <Button
              variant="destructive"
              disabled={bulkStatusBusy}
              onClick={() => void runBulkStatusChange(false)}
            >
              {t("bulkDeactivateSelected")}
            </Button>
          ) : null}
        </div>
      </Modal>

      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex min-w-[12rem] flex-1 flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <Input
                  className="w-full max-w-xs"
                  placeholder={t("searchMembersPlaceholder")}
                  aria-label={t("searchMembersPlaceholder")}
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>
              <div>
                <Select value={pageSize} onValueChange={setPageSize}>
                  <SelectTrigger className="w-[150px]" aria-label={common("rowsPerPageLabel")}>
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
              </div>
            </div>

            <div className="min-w-0 flex-1 border-t border-[var(--border)] pt-4 sm:border-t-0 sm:pt-0">
              <FilterPills
                ariaLabel={t("membersStatusFilterAriaLabel")}
                disabled={!statusFilterHydrated || Boolean(issue)}
                value={memberStatusFilter}
                onChange={setMemberStatusFilter}
                options={[
                  {
                    value: "all",
                    title: t("filterAllTitle"),
                    count: memberFacetCounts.all,
                  },
                  {
                    value: "active",
                    title: t("filterActiveTitle"),
                    count: memberFacetCounts.active,
                  },
                  {
                    value: "inactive",
                    title: t("filterInactiveTitle"),
                    count: memberFacetCounts.inactive,
                  },
                ]}
              />
            </div>
          </div>

          {issue ? (
            <div className="flex items-start justify-between gap-3 rounded-[var(--radius-form)] border px-4 py-3 text-sm banner-info">
              <p className="min-w-0 flex-1">
                {issue === "missing_ltf_licenseid"
                  ? t("membersMissingLtfLicenseIdFilterMessage")
                  : t("membersWithoutValidLicenseFilterMessage")}
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

          <div className="flex flex-wrap items-center justify-between gap-4">
            {canManageMembers ? (
              <div className="flex min-h-[var(--control-height)] flex-wrap items-center gap-3">
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value === "create") {
                      startCreate();
                    }
                    if (value === "import") {
                      router.push(`/${locale}/dashboard/club/members/import`);
                    }
                  }}
                >
                  <SelectTrigger className="min-w-[11rem]" aria-label={t("membersMenuLabel")}>
                    <SelectValue placeholder={t("membersMenuLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">{t("createMember")}</SelectItem>
                    <SelectItem value="import">{importT("importMembers")}</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value=""
                  disabled={selectedIds.length === 0}
                  onValueChange={(value) => {
                    if (value === "delete") {
                      openBatchDeletePage();
                    }
                    if (value === "print-cards") {
                      openQuickPrintPage();
                    }
                    if (value === "order-license") {
                      openOrderPage();
                    }
                    if (value === "change-status") {
                      if (selectedIds.length > 0) {
                        setBulkStatusOpen(true);
                      }
                    }
                  }}
                >
                  <SelectTrigger className="min-w-[11rem]" aria-label={common("batchActionsLabel")}>
                    <SelectValue placeholder={common("batchActionsLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete">{common("batchDeleteLabel")}</SelectItem>
                    <SelectItem value="print-cards" disabled={!selectedClubId}>
                      {t("actionPrintCards")}
                    </SelectItem>
                    <SelectItem value="order-license">{t("actionOrderLicense")}</SelectItem>
                    <SelectItem value="change-status">{t("actionChangeStatus")}</SelectItem>
                  </SelectContent>
                </Select>

                {selectedIds.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
                    <span className="font-medium text-[var(--foreground)]">
                      {t("selectedMembersCountLabel", { count: selectedIds.length })}
                    </span>
                    {hiddenSelectedCount > 0 ? (
                      <span className="font-medium text-warning">
                        {t("hiddenSelectedMembersCountLabel", { count: hiddenSelectedCount })}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="min-h-[var(--control-height)] rounded-[var(--radius-form)] px-2 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
                      onClick={clearSelection}
                    >
                      {t("clearSelection")}
                    </button>
                  </div>
                ) : (
                  <div className="group relative">
                    <button
                      type="button"
                      className="inline-flex h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] items-center justify-center rounded-[var(--radius-form)] text-muted transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label={t("membersSelectionHintAriaLabel")}
                      aria-expanded={actionsHintOpen}
                      onClick={() => setActionsHintOpen((open) => !open)}
                      onBlur={() => setActionsHintOpen(false)}
                    >
                      <CircleAlert className="h-4 w-4" />
                    </button>
                    <span
                      role="tooltip"
                      className={`absolute left-0 top-full z-20 mt-2 w-max max-w-xs rounded-[var(--radius-form)] border border-border bg-surface px-3 py-2 text-sm text-muted shadow-[var(--shadow-card)] ${
                        actionsHintOpen ? "visible" : "invisible group-hover:visible group-focus-within:visible"
                      }`}
                    >
                      {t("membersSelectionHintShort")}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div />
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              <span>{t("pageLabel", { current: currentPage, total: totalPages })}</span>
              <Button
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              >
                {t("previousPage")}
              </Button>
              <Button
                variant="outline"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : members.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noMembersResultsSubtitle")} />
        ) : (
          <EntityTable
            columns={[
              ...(canManageMembers
                ? [
                    {
                      key: "select",
                      header: (
                        <span className="inline-flex min-h-[var(--control-height)] min-w-[var(--control-height)] items-center justify-center">
                          <Checkbox
                            aria-label={common("selectAllLabel")}
                            checked={allSelected}
                            onCheckedChange={() => toggleSelectAll()}
                          />
                        </span>
                      ),
                      render: (member: Member) => (
                        <span
                          className="inline-flex min-h-[var(--control-height)] min-w-[var(--control-height)] items-center justify-center"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            aria-label={common("selectRowLabel")}
                            checked={selectedIds.includes(member.id)}
                            onPointerDown={(event) => {
                              rowSelectModifierRef.current = {
                                shiftKey: event.shiftKey,
                                ctrlKey: event.ctrlKey,
                                metaKey: event.metaKey,
                              };
                            }}
                            onCheckedChange={() =>
                              toggleSelectRow(member.id, rowSelectModifierRef.current)
                            }
                          />
                        </span>
                      ),
                    },
                  ]
                : []),
              { key: "first_name", header: t("firstNameLabel") },
              { key: "last_name", header: t("lastNameLabel") },
              {
                key: "sex",
                header: t("sexLabel"),
                render: (member) => (
                  <span
                    className="inline-flex h-[var(--control-height)] w-[var(--control-height)] items-center justify-center text-2xl font-semibold leading-none"
                    aria-label={member.sex === "F" ? "Female" : "Male"}
                    title={member.sex === "F" ? "Female" : "Male"}
                  >
                    {member.sex === "F" ? "♀" : "♂"}
                  </span>
                ),
              },
              { key: "belt_rank", header: t("beltRankLabel") },
              { key: "ltf_licenseid", header: t("ltfLicenseLabel") },
              {
                key: "current_licenses",
                header: t("licensesColumnLabel"),
                render: (member: Member) => {
                  const licenses = member.current_licenses ?? [];
                  if (licenses.length === 0) {
                    return <span className="text-muted">—</span>;
                  }
                  return (
                    <div className="flex flex-wrap gap-1">
                      {licenses.map((license) => (
                        <StatusBadge
                          key={license.id}
                          label={`${license.license_type_name} ${license.year}`}
                          tone={license.status === "active" ? "success" : "warning"}
                        />
                      ))}
                    </div>
                  );
                },
              },
              {
                key: "date_of_birth",
                header: t("dobLabel"),
                render: (member) => formatDisplayDate(member.date_of_birth),
              },
              {
                key: "is_active",
                header: t("isActiveLabel"),
                render: (member) => {
                  const isUpdating = statusUpdatingSet.has(member.id);
                  if (!canManageMembers) {
                    return (
                      <StatusBadge
                        label={member.is_active ? t("activeLabel") : t("inactiveLabel")}
                        tone={member.is_active ? "success" : "neutral"}
                      />
                    );
                  }
                  return (
                    <button
                      type="button"
                      disabled={isUpdating}
                      aria-label={t("actionChangeStatus")}
                      className={`inline-flex min-h-[var(--control-height)] min-w-[5.5rem] items-center justify-center rounded-[var(--radius-chip)] border px-2.5 text-xs font-semibold hover:opacity-80 ${
                        member.is_active ? "badge-success" : "bg-secondary text-[var(--default-foreground)]"
                      } ${isUpdating ? "cursor-wait opacity-70" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingRowStatusMember(member);
                      }}
                    >
                      {member.is_active ? t("activeLabel") : t("inactiveLabel")}
                    </button>
                  );
                },
              },
              ...(canManageMembers
                ? [
                    {
                      key: "actions",
                      header: t("actionsLabel"),
                      render: (member: Member) => (
                        <div
                          className="flex flex-wrap items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="destructive"
                            className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0 p-0"
                            aria-label={t("deleteAction")}
                            onClick={() => handleDelete(member)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
            rows={members}
            onRowClick={(member) => router.push(`/${locale}/dashboard/club/members/${member.id}`)}
          />
        )}
      </div>
    </ClubAdminLayout>
  );
}
