"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { NmaAdminLayout } from "@/components/nma-admin/nma-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImportCsvModal } from "@/components/import/import-csv-modal";
import { Club, createClub, deleteClub, getClubs, updateClub } from "@/lib/nma-admin-api";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  city: z.string().optional(),
  address: z.string().optional(),
});

type ClubFormValues = z.infer<typeof clubSchema>;

export default function NmaAdminClubsPage() {
  const t = useTranslations("NmaAdmin");
  const importT = useTranslations("Import");
  const common = useTranslations("Common");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [clubToDelete, setClubToDelete] = useState<Club | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [importType, setImportType] = useState<"clubs" | "members" | null>(null);

  const pageSize = 8;

  const importFields = {
    clubs: [
      { key: "name", label: t("clubNameLabel"), required: true },
      { key: "city", label: t("cityLabel") },
      { key: "address", label: t("addressLabel") },
    ],
    members: [
      { key: "first_name", label: t("firstNameLabel"), required: true },
      { key: "last_name", label: t("lastNameLabel"), required: true },
      { key: "email", label: importT("emailLabel") },
      { key: "date_of_birth", label: t("dobLabel") },
      { key: "belt_rank", label: t("beltRankLabel") },
      { key: "wt_licenseid", label: importT("wtLicenseLabel") },
      { key: "ltf_licenseid", label: importT("ltfLicenseLabel") },
    ],
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClubFormValues>({
    resolver: zodResolver(clubSchema),
    defaultValues: {
      name: "",
      city: "",
      address: "",
    },
  });

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
    loadClubs();
  }, []);

  const searchedClubs = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return clubs;
    }
    return clubs.filter((club) => {
      const name = club.name.toLowerCase();
      const city = club.city?.toLowerCase() ?? "";
      return name.includes(normalizedQuery) || city.includes(normalizedQuery);
    });
  }, [clubs, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(searchedClubs.length / pageSize));
  const pagedClubs = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return searchedClubs.slice(startIndex, startIndex + pageSize);
  }, [currentPage, searchedClubs]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const onSubmit = async (values: ClubFormValues) => {
    setErrorMessage(null);
    try {
      if (editingClub) {
        await updateClub(editingClub.id, values);
      } else {
        await createClub(values);
      }
      setEditingClub(null);
      setIsFormOpen(false);
      reset();
      await loadClubs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save club.");
    }
  };

  const startEdit = (club: Club) => {
    setEditingClub(club);
    setIsFormOpen(true);
    reset({
      name: club.name,
      city: club.city ?? "",
      address: club.address ?? "",
    });
  };

  const startCreate = () => {
    setEditingClub(null);
    setIsFormOpen(true);
    reset({
      name: "",
      city: "",
      address: "",
    });
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

  return (
    <NmaAdminLayout title={t("clubsTitle")} subtitle={t("clubsSubtitle")}>
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
            <Button onClick={startCreate}>{t("createClub")}</Button>
            <Select
              value={importType ?? ""}
              onValueChange={(value) => setImportType(value as "clubs" | "members")}
            >
            <SelectTrigger className="w-40">
              <SelectValue placeholder={importT("importLabel")} />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="clubs">{importT("importClubs")}</SelectItem>
              <SelectItem value="members">{importT("importMembers")}</SelectItem>
              </SelectContent>
            </Select>
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
              { key: "name", header: t("clubNameLabel") },
              { key: "city", header: t("cityLabel") },
              { key: "address", header: t("addressLabel") },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (club) => (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(club)}>
                      {t("editAction")}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(club)}>
                      {t("deleteAction")}
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={pagedClubs}
          />
        )}
      </div>

      <Modal
        title={editingClub ? t("updateClub") : t("createClub")}
        description={t("clubFormSubtitle")}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
      >
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-zinc-700">{t("clubNameLabel")}</label>
            <Input placeholder="LTF Central Club" {...register("name")} />
            {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("cityLabel")}</label>
            <Input placeholder="Luxembourg" {...register("city")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("addressLabel")}</label>
            <Input placeholder="1 Rue de la Fede" {...register("address")} />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {editingClub ? t("updateClub") : t("createClub")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingClub(null);
                setIsFormOpen(false);
                reset();
              }}
            >
              {t("cancelEdit")}
            </Button>
          </div>
        </form>
      </Modal>

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

      <ImportCsvModal
        isOpen={importType === "clubs"}
        onClose={() => setImportType(null)}
        type="clubs"
        title={importT("importClubs")}
        subtitle={importT("importClubsSubtitle")}
        fields={importFields.clubs}
        onComplete={loadClubs}
      />
      <ImportCsvModal
        isOpen={importType === "members"}
        onClose={() => setImportType(null)}
        type="members"
        title={importT("importMembers")}
        subtitle={importT("importMembersSubtitle")}
        fields={importFields.members}
        clubOptions={clubs}
        onComplete={loadClubs}
      />
    </NmaAdminLayout>
  );
}
