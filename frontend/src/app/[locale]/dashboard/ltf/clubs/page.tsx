"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Club, deleteClub, getClubs } from "@/lib/ltf-admin-api";

export default function LtfAdminClubsPage() {
  const t = useTranslations("LtfAdmin");
  const importT = useTranslations("Import");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubToDelete, setClubToDelete] = useState<Club | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["10", "25", "50", "100", "150", "200", "all"];

  const loadClubs = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const clubsResponse = await getClubs();
      setClubs(clubsResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load clubs.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadClubs();
  }, []);

  const searchedClubs = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return clubs;
    }
    return clubs.filter((club) => {
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
  }, [clubs, searchQuery]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedClubs.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedClubs.length / resolvedPageSize));
  const pagedClubs = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedClubs.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedClubs, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

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
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchClubsPlaceholder")}
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
            <Select
              value=""
              onValueChange={(value) => {
                if (value === "delete") {
                  setIsBatchDeleteOpen(true);
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
            <Button onClick={() => router.push(`/${locale}/dashboard/ltf/clubs/new`)}>
              {t("createClub")}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/${locale}/dashboard/ltf/import?type=clubs`)}
            >
              {importT("importClubs")}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/${locale}/dashboard/ltf/import?type=members`)}
            >
              {importT("importMembers")}
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
        ) : searchedClubs.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noClubsResultsSubtitle")} />
        ) : (
          <EntityTable
            columns={[
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
                render: (club) => (
                  <input
                    type="checkbox"
                    aria-label={common("selectRowLabel")}
                    checked={selectedIds.includes(club.id)}
                    onChange={() => toggleSelectRow(club.id)}
                  />
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
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      size="icon-sm"
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
