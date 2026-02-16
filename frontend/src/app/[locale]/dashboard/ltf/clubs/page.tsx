"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
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
import {
  Club,
  EligibleMember,
  addClubAdmin,
  createClub,
  deleteClub,
  getClubAdmins,
  getClubs,
  getEligibleMembers,
  removeClubAdmin,
  setClubMaxAdmins,
  updateClub,
} from "@/lib/ltf-admin-api";

const clubSchema = z.object({
  name: z.string().min(1, "Club name is required"),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  postal_code: z.string().optional(),
  locality: z.string().optional(),
});

type ClubFormValues = z.infer<typeof clubSchema>;

export default function LtfAdminClubsPage() {
  const t = useTranslations("LtfAdmin");
  const importT = useTranslations("Import");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [clubToDelete, setClubToDelete] = useState<Club | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [clubAdmins, setClubAdmins] = useState<Array<{ id: number; username: string; email: string }>>([]);
  const [eligibleMembers, setEligibleMembers] = useState<EligibleMember[]>([]);
  const [maxAdmins, setMaxAdmins] = useState<number>(10);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [isEmailPromptOpen, setIsEmailPromptOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClubFormValues>({
    resolver: zodResolver(clubSchema),
    defaultValues: {
      name: "",
      address_line1: "",
      address_line2: "",
      postal_code: "",
      locality: "",
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

  const onSubmit = async (values: ClubFormValues) => {
    setErrorMessage(null);
    const payload = {
      ...values,
      address: values.address_line1 ?? "",
      city: values.locality ?? "",
    };
    try {
      if (editingClub) {
        await updateClub(editingClub.id, payload);
      } else {
        await createClub(payload);
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
      address_line1: club.address_line1 ?? club.address ?? "",
      address_line2: club.address_line2 ?? "",
      postal_code: club.postal_code ?? "",
      locality: club.locality ?? club.city ?? "",
    });
  };

  const startCreate = () => {
    setEditingClub(null);
    setIsFormOpen(true);
    reset({
      name: "",
      address_line1: "",
      address_line2: "",
      postal_code: "",
      locality: "",
    });
  };

  const handleDelete = (club: Club) => {
    setClubToDelete(club);
    setIsDeleteOpen(true);
  };

  const openClubAdmins = async (club: Club) => {
    setSelectedClub(club);
    setSelectedMemberId("");
    setIsEmailPromptOpen(false);
    setEmailInput("");
    setEmailError(null);
    try {
      const [adminsResponse, eligibleResponse] = await Promise.all([
        getClubAdmins(club.id),
        getEligibleMembers(club.id),
      ]);
      setClubAdmins(adminsResponse.admins);
      setMaxAdmins(adminsResponse.max_admins);
      setEligibleMembers(eligibleResponse.eligible);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load club admins.");
    }
  };

  const handleAddAdmin = async () => {
    if (!selectedClub || !selectedMemberId) {
      return;
    }
    const memberId = Number(selectedMemberId);
    if (Number.isNaN(memberId)) {
      return;
    }
    try {
      await addClubAdmin(selectedClub.id, memberId, emailInput || undefined);
      await openClubAdmins(selectedClub);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add club admin.";
      if (message === "email_required") {
        setIsEmailPromptOpen(true);
      } else {
        setErrorMessage(message);
      }
    }
  };

  const handleEmailConfirm = async () => {
    if (!selectedClub || !selectedMemberId) {
      return;
    }
    if (!emailInput || !emailInput.includes("@")) {
      setEmailError(t("emailRequiredError"));
      return;
    }
    try {
      await addClubAdmin(selectedClub.id, Number(selectedMemberId), emailInput, locale);
      setIsEmailPromptOpen(false);
      setEmailInput("");
      setEmailError(null);
      await openClubAdmins(selectedClub);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to add club admin.");
    }
  };

  const handleRemoveAdmin = async (userId: number) => {
    if (!selectedClub) {
      return;
    }
    try {
      await removeClubAdmin(selectedClub.id, userId);
      await openClubAdmins(selectedClub);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to remove club admin.");
    }
  };

  const handleMaxAdminsChange = async (value: string) => {
    if (!selectedClub) {
      return;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }
    try {
      const response = await setClubMaxAdmins(selectedClub.id, parsed);
      setMaxAdmins(response.max_admins);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update admin limit.");
    }
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
            <Button onClick={startCreate}>{t("createClub")}</Button>
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
                key: "address_line1",
                header: t("addressLine1Label"),
                render: (club) => club.address_line1 || club.address,
              },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (club) => (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/${locale}/dashboard/ltf/clubs/${club.id}`}>
                        {t("viewClubAction")}
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t("editAction")}
                      onClick={() => startEdit(club)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("manageAdmins")}
                      onClick={() => openClubAdmins(club)}
                    >
                      {t("manageAdmins")}
                    </Button>
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

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-zinc-700">{t("addressLine1Label")}</label>
            <Input placeholder="12 Rue de la Gare" {...register("address_line1")} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-zinc-700">{t("addressLine2Label")}</label>
            <Input placeholder="Building, floor, unit (optional)" {...register("address_line2")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("postalCodeLabel")}</label>
            <Input placeholder="1234" {...register("postal_code")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("localityLabel")}</label>
            <Input placeholder="Luxembourg" {...register("locality")} />
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

      <Modal
        title={selectedClub ? t("adminsTitle", { club: selectedClub.name }) : t("adminsTitleFallback")}
        description={t("adminsSubtitle")}
        isOpen={Boolean(selectedClub)}
        onClose={() => setSelectedClub(null)}
      >
        <div className="space-y-4">
          {selectedClub ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${locale}/dashboard/ltf/clubs/${selectedClub.id}?tab=admins`}>
                {t("openAdminsPage")}
              </Link>
            </Button>
          ) : null}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("maxAdminsLabel")}</label>
            <Input
              type="number"
              min={1}
              value={String(maxAdmins)}
              onChange={(event) => handleMaxAdminsChange(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("addAdminLabel")}</label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder={t("selectMemberAdminPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleMembers.map((member) => (
                    <SelectItem key={member.id} value={String(member.id)}>
                      {member.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleAddAdmin}>{t("addAdminAction")}</Button>
            </div>
            {isEmailPromptOpen ? (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-medium text-zinc-800">{t("emailRequiredTitle")}</p>
                <p className="mt-1 text-sm text-zinc-600">{t("emailRequiredDescription")}</p>
                <div className="mt-3 space-y-2">
                  <label className="text-sm font-medium text-zinc-700">{t("emailInputLabel")}</label>
                  <Input
                    placeholder={t("emailInputPlaceholder")}
                    value={emailInput}
                    onChange={(event) => {
                      setEmailInput(event.target.value);
                      setEmailError(null);
                    }}
                  />
                  {emailError ? <p className="text-sm text-red-600">{emailError}</p> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={handleEmailConfirm}>
                    {t("emailConfirmAction")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsEmailPromptOpen(false);
                      setEmailInput("");
                      setEmailError(null);
                    }}
                  >
                    {t("emailCancelAction")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-700">{t("currentAdminsLabel")}</p>
            {clubAdmins.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("noAdminsLabel")}</p>
            ) : (
              <div className="space-y-2">
                {clubAdmins.map((admin) => (
                  <div
                    key={admin.id}
                    className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2"
                  >
                    <div className="text-sm text-zinc-700">
                      {admin.username} · {admin.email}
                    </div>
                    <Button variant="destructive" size="sm" onClick={() => handleRemoveAdmin(admin.id)}>
                      {t("removeAdminAction")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

    </LtfAdminLayout>
  );
}
