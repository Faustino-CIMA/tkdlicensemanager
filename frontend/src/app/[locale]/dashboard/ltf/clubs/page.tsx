"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2, X } from "lucide-react";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  PageNotice,
  PageSizeSelect,
  SelectionMeta,
} from "@/components/ui/list-page-chrome";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClubSelection } from "@/components/club-selection-provider";
import { Club, deleteClub, getClubs } from "@/lib/ltf-admin-api";

export default function LtfAdminClubsPage() {
  const t = useTranslations("LtfAdmin");
  const importT = useTranslations("Import");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = pathname?.split("/")[1] || "en";
  const issue = searchParams.get("issue") === "no_admin" ? "no_admin" : null;
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubToDelete, setClubToDelete] = useState<Club | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { selectedClubId } = useClubSelection();

  const loadClubs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const clubsResponse = await getClubs(issue ? { issue } : undefined);
      setClubs(clubsResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load clubs.");
    } finally {
      setIsLoading(false);
    }
  }, [issue]);

  useEffect(() => {
    void loadClubs();
  }, [loadClubs]);

  const dismissIssueFilter = () => {
    router.replace(`/${locale}/dashboard/ltf/clubs`);
  };

  const searchedClubs = useMemo(() => {
    const scopedClubs = selectedClubId
      ? clubs.filter((club) => club.id === selectedClubId)
      : clubs;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return scopedClubs;
    }
    return scopedClubs.filter((club) => {
      const name = club.name.toLowerCase();
      const locality = (club.locality || club.city || "").toLowerCase();
      const postalCode = (club.postal_code || "").toLowerCase();
      const address = (club.address_line1 || club.address || "").toLowerCase();
      return (
        name.includes(normalizedQuery) ||
        locality.includes(normalizedQuery) ||
        postalCode.includes(normalizedQuery) ||
        address.includes(normalizedQuery)
      );
    });
  }, [clubs, searchQuery, selectedClubId]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedClubs.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedClubs.length / resolvedPageSize));
  const pagedClubs = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedClubs.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedClubs, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize, selectedClubId]);

  const allFilteredIds = useMemo(() => searchedClubs.map((club) => club.id), [searchedClubs]);
  const allSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allFilteredIds);
    }
  };

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleDelete = (club: Club) => {
    setClubToDelete(club);
    setIsDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!clubToDelete) {
      return;
    }
    try {
      await deleteClub(clubToDelete.id);
      setIsDeleteOpen(false);
      setClubToDelete(null);
      await loadClubs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete club.");
    }
  };

  const selectedClubs = clubs.filter((club) => selectedIds.includes(club.id));

  const confirmBatchDelete = async () => {
    try {
      await Promise.all(selectedClubs.map((club) => deleteClub(club.id)));
      setSelectedIds([]);
      await loadClubs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete clubs.");
    }
  };

  const selectedClubItems = selectedClubs.map((club) =>
    club.locality || club.city ? `${club.name} · ${club.locality || club.city}` : club.name
  );

  return (
    <LtfAdminLayout title={t("clubsTitle")} subtitle={t("clubsSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

      <div className="space-y-6">
        {issue === "no_admin" ? (
          <div className="flex items-start justify-between gap-3 rounded-[var(--radius-form)] border px-4 py-3 text-sm banner-info">
            <p className="min-w-0 flex-1">{t("clubsWithoutAdminFilterMessage")}</p>
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
                placeholder={t("searchClubsPlaceholder")}
                aria-label={t("searchClubsPlaceholder")}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
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
          />

          <ListActionsRow
            actions={
              <>
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value === "create") {
                      router.push(`/${locale}/dashboard/ltf/clubs/new`);
                    }
                    if (value === "import-clubs") {
                      router.push(`/${locale}/dashboard/ltf/import?type=clubs`);
                    }
                    if (value === "import-members") {
                      router.push(`/${locale}/dashboard/ltf/import?type=members`);
                    }
                  }}
                >
                  <SelectTrigger className="min-w-[11rem]" aria-label={t("clubsMenuLabel")}>
                    <SelectValue placeholder={t("clubsMenuLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">{t("createClub")}</SelectItem>
                    <SelectItem value="import-clubs">{importT("importClubs")}</SelectItem>
                    <SelectItem value="import-members">{importT("importMembers")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value=""
                  disabled={selectedIds.length === 0}
                  onValueChange={(value) => {
                    if (value === "delete") {
                      setIsBatchDeleteOpen(true);
                    }
                  }}
                >
                  <SelectTrigger className="min-w-[11rem]" aria-label={common("batchActionsLabel")}>
                    <SelectValue placeholder={common("batchActionsLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete">{common("batchDeleteLabel")}</SelectItem>
                  </SelectContent>
                </Select>
                <SelectionMeta
                  count={selectedIds.length}
                  countLabel={t("selectedCountLabel", { count: selectedIds.length })}
                  clearLabel={t("clearSelection")}
                  onClear={() => setSelectedIds([])}
                />
              </>
            }
            pagination={
              <ListPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPrevious={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                onNext={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                pageLabel={t("pageLabel", { current: currentPage, total: totalPages })}
                previousLabel={t("previousPage")}
                nextLabel={t("nextPage")}
              />
            }
          />
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : searchedClubs.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noClubsResultsSubtitle")} />
        ) : (
          <EntityTable
            columns={[
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
                render: (club) => (
                  <span
                    className="inline-flex min-h-[var(--control-height)] min-w-[var(--control-height)] items-center justify-center"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      aria-label={common("selectRowLabel")}
                      checked={selectedIds.includes(club.id)}
                      onCheckedChange={() => toggleSelectRow(club.id)}
                    />
                  </span>
                ),
              },
              { key: "name", header: t("clubNameLabel") },
              { key: "postal_code", header: t("postalCodeLabel") },
              {
                key: "locality",
                header: t("localityLabel"),
                render: (club) => club.locality || club.city,
              },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (club) => (
                  <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <Button
                      variant="destructive"
                      className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0 p-0"
                      aria-label={t("deleteAction")}
                      onClick={() => handleDelete(club)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={pagedClubs}
            onRowClick={(club) => router.push(`/${locale}/dashboard/ltf/clubs/${club.id}`)}
          />
        )}
      </div>

      <DeleteConfirmModal
        isOpen={isDeleteOpen}
        title={common("deleteTitle", { item: common("itemClub") })}
        description={common("deleteDescriptionWithName", {
          name: clubToDelete?.name ?? "",
        })}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={confirmDelete}
        onCancel={() => {
          setIsDeleteOpen(false);
          setClubToDelete(null);
        }}
      />

      <DeleteConfirmModal
        isOpen={isBatchDeleteOpen}
        title={common("deleteTitle", { item: common("itemClub") })}
        description={common("deleteSelectedDescription", {
          count: selectedClubs.length,
          item: common("itemClub"),
        })}
        listTitle={common("batchDeleteListTitle")}
        listItems={selectedClubItems}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={() => {
          setIsBatchDeleteOpen(false);
          confirmBatchDelete();
        }}
        onCancel={() => setIsBatchDeleteOpen(false)}
      />
    </LtfAdminLayout>
  );
}
