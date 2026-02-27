"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { useClubSelection } from "@/components/club-selection-provider";
import {
  Member,
  getClubs,
  getMembersPage,
  updateMember,
} from "@/lib/club-admin-api";
import { apiRequest } from "@/lib/api";
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
type AuthMeResponse = { role: string };

const BATCH_DELETE_STORAGE_KEY = "club_members_batch_delete_payload";
const ORDER_LICENSE_STORAGE_KEY = "club_members_order_license_payload";
const QUICK_PRINT_STORAGE_KEY = "club_quick_print_payload";

export default function ClubAdminMembersPage() {
  const t = useTranslations("ClubAdmin");
  const importT = useTranslations("Import");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const { selectedClubId, setSelectedClubId } = useClubSelection();
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const lastSelectedMemberIdRef = useRef<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [statusFilterHydrated, setStatusFilterHydrated] = useState(false);
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<number[]>([]);
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const pageSizeOptions = ["10", "25", "50", "100", "150", "200"];

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [clubsResponse, membersResponse] = await Promise.all([
        getClubs(),
        getMembersPage({
          page: currentPage,
          pageSize: Number(pageSize),
          q: searchQuery || undefined,
          clubId: selectedClubId ?? undefined,
          isActive:
            statusFilter === "all" ? undefined : statusFilter === "active",
        }),
      ]);
      setMembers(membersResponse.results);
      setTotalCount(membersResponse.count);
      if (clubsResponse.length > 0 && !selectedClubId) {
        const firstClubId = clubsResponse[0].id;
        setSelectedClubId(firstClubId);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, searchQuery, selectedClubId, setSelectedClubId, statusFilter]);

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
  const statusFilterStorageKey = useMemo(
    () => `club_members_status_filter:${selectedClubId ?? "all"}`,
    [selectedClubId]
  );

  const statusCounts = useMemo(() => {
    const activeCount = members.filter((member) => member.is_active).length;
    return {
      all: totalCount,
      active: activeCount,
      inactive: members.length - activeCount,
    };
  }, [members, totalCount]);
  const statusUpdatingSet = useMemo(
    () => new Set(statusUpdatingIds),
    [statusUpdatingIds]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / Number(pageSize)));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubId, pageSize, statusFilter]);
  
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
    try {
      const storedValue = window.sessionStorage.getItem(statusFilterStorageKey);
      if (storedValue === "active" || storedValue === "inactive" || storedValue === "all") {
        setStatusFilter(storedValue);
      } else {
        setStatusFilter("active");
      }
    } finally {
      setStatusFilterHydrated(true);
    }
  }, [statusFilterStorageKey]);

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
    window.sessionStorage.setItem(statusFilterStorageKey, statusFilter);
  }, [statusFilter, statusFilterHydrated, statusFilterStorageKey]);

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
        })
      );
    }
    router.push(`/${locale}/dashboard/club/print-jobs/quick-print`);
  };

  const toggleMemberStatus = async (member: Member) => {
    if (!canManageMembers) {
      return;
    }
    if (statusUpdatingSet.has(member.id)) {
      return;
    }
    const nextIsActive = !member.is_active;
    setErrorMessage(null);
    setMembers((previous) =>
      previous.map((item) => (item.id === member.id ? { ...item, is_active: nextIsActive } : item))
    );
    setStatusUpdatingIds((previous) => [...previous, member.id]);
    try {
      const updatedMember = await updateMember(member.id, {
        club: member.club,
        first_name: member.first_name,
        last_name: member.last_name,
        sex: member.sex,
        email: member.email || undefined,
        wt_licenseid: member.wt_licenseid || undefined,
        ltf_licenseid: member.ltf_licenseid || undefined,
        date_of_birth: member.date_of_birth,
        belt_rank: member.belt_rank || undefined,
        is_active: nextIsActive,
      });
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

  return (
    <ClubAdminLayout title={t("membersTitle")} subtitle={t("membersSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchMembersPlaceholder")}
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
            {canManageMembers ? (
              <>
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value === "delete") {
                      openBatchDeletePage();
                    }
                  }}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder={common("batchActionsLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete" disabled={selectedIds.length === 0}>
                      {common("batchDeleteLabel")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={startCreate}>{t("createMember")}</Button>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/${locale}/dashboard/club/members/import`)}
                >
                  {importT("importMembers")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={selectedIds.length === 0 || !selectedClubId}
                  onClick={openOrderPage}
                >
                  {t("orderLicenseButton", { year: new Date().getFullYear() })}
                </Button>
                <Button
                  variant="outline"
                  disabled={selectedIds.length === 0 || !selectedClubId}
                  onClick={openQuickPrintPage}
                >
                  {t("quickPrintSelectedCardsAction")}
                </Button>
              </>
            ) : null}
            {(
              [
                { id: "active", label: t("activeLabel"), count: statusCounts.active },
                { id: "inactive", label: t("inactiveLabel"), count: statusCounts.inactive },
                { id: "all", label: common("rowsPerPageAll"), count: statusCounts.all },
              ] as const
            ).map((chip) => {
              const isActive = statusFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    isActive
                      ? "border-zinc-700 bg-zinc-800 text-white"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                  }`}
                  onClick={() => setStatusFilter(chip.id)}
                >
                  {chip.label} ({chip.count})
                </button>
              );
            })}
          </div>
          {canManageMembers ? (
            <div className="space-y-1 text-xs text-zinc-500">
              <p>{t("selectionTip")}</p>
              <p>{t("selectionPersistenceHint")}</p>
              {selectedIds.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-700">
                    {t("selectedMembersCountLabel", { count: selectedIds.length })}
                  </span>
                  {hiddenSelectedCount > 0 ? (
                    <span className="font-medium text-amber-700">
                      {t("hiddenSelectedMembersCountLabel", { count: hiddenSelectedCount })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-zinc-700"
                    onClick={clearSelection}
                  >
                    {t("clearSelection")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
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
                        <input
                          type="checkbox"
                          aria-label={common("selectAllLabel")}
                          checked={allSelected}
                          onChange={toggleSelectAll}
                        />
                      ),
                      render: (member: Member) => (
                        <input
                          type="checkbox"
                          aria-label={common("selectRowLabel")}
                          checked={selectedIds.includes(member.id)}
                          readOnly
                          onClick={(event) =>
                            toggleSelectRow(member.id, {
                              shiftKey: event.shiftKey,
                              ctrlKey: event.ctrlKey,
                              metaKey: event.metaKey,
                            })
                          }
                        />
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
                    className="inline-flex h-7 w-7 items-center justify-center text-2xl font-semibold leading-none"
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
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                          member.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-zinc-300 bg-zinc-100 text-zinc-700"
                        }`}
                      >
                        {member.is_active ? t("activeLabel") : t("inactiveLabel")}
                      </span>
                    );
                  }
                  return (
                    <button
                      type="button"
                      disabled={isUpdating}
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        member.is_active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border-zinc-300 bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                      } ${isUpdating ? "cursor-wait opacity-70" : ""}`}
                      onClick={() => toggleMemberStatus(member)}
                    >
                      {member.is_active ? t("activeLabel") : t("inactiveLabel")}
                    </button>
                  );
                },
              },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (member) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t("editAction")}
                      onClick={() =>
                        router.push(
                          `/${locale}/dashboard/club/members/${member.id}?tab=overview&edit=1`
                        )
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {canManageMembers ? (
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        aria-label={t("deleteAction")}
                        onClick={() => handleDelete(member)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={members}
            onRowClick={(member) => router.push(`/${locale}/dashboard/club/members/${member.id}`)}
          />
        )}
      </div>
    </ClubAdminLayout>
  );
}
