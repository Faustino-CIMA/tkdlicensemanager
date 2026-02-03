"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { useClubSelection } from "@/components/club-selection-provider";
import {
  Club,
  License,
  Member,
  createMember,
  deleteMember,
  getClubs,
  getLicenses,
  getMembers,
  updateMember,
} from "@/lib/club-admin-api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImportCsvModal } from "@/components/import/import-csv-modal";

const memberSchema = z.object({
  club: z.string().min(1, "Club is required"),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  sex: z.enum(["M", "F"]),
  ltf_licenseid: z.string().optional(),
  date_of_birth: z.string().optional(),
  belt_rank: z.string().optional(),
  is_active: z.boolean(),
});

type MemberFormValues = z.infer<typeof memberSchema>;

export default function ClubAdminMembersPage() {
  const t = useTranslations("ClubAdmin");
  const importT = useTranslations("Import");
  const common = useTranslations("Common");
  const { selectedClubId, setSelectedClubId } = useClubSelection();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];

  const importFields = [
    { key: "first_name", label: t("firstNameLabel"), required: true },
    { key: "last_name", label: t("lastNameLabel"), required: true },
    { key: "sex", label: t("sexLabel") },
    { key: "email", label: importT("emailLabel") },
    { key: "date_of_birth", label: t("dobLabel") },
    { key: "belt_rank", label: t("beltRankLabel") },
    { key: "wt_licenseid", label: importT("wtLicenseLabel") },
    { key: "ltf_licenseid", label: importT("ltfLicenseLabel") },
    { key: "is_active", label: t("isActiveLabel") },
  ];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: {
      club: "",
      first_name: "",
      last_name: "",
      sex: "M",
      ltf_licenseid: "",
      date_of_birth: "",
      belt_rank: "",
      is_active: true,
    },
  });

  const loadData = async () => {
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
      if (clubsResponse.length > 0 && !selectedClubId) {
        const firstClubId = clubsResponse[0].id;
        setSelectedClubId(firstClubId);
        setValue("club", String(firstClubId));
      } else if (selectedClubId) {
        setValue("club", String(selectedClubId));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredMembers = useMemo(() => {
    if (!selectedClubId) {
      return members;
    }
    return members.filter((member) => member.club === selectedClubId);
  }, [members, selectedClubId]);

  const searchedMembers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return filteredMembers;
    }
    return filteredMembers.filter((member) => {
      const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
      return fullName.includes(normalizedQuery);
    });
  }, [filteredMembers, searchQuery]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedMembers.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedMembers.length / resolvedPageSize));
  const pagedMembers = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedMembers.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedMembers, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubId, pageSize]);

  useEffect(() => {
    if (selectedClubId && !watch("club")) {
      setValue("club", String(selectedClubId));
    }
  }, [selectedClubId, setValue, watch]);

  const allFilteredIds = useMemo(
    () => searchedMembers.map((member) => member.id),
    [searchedMembers]
  );
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

  const onSubmit = async (values: MemberFormValues) => {
    setErrorMessage(null);
    const payload = {
      club: Number(values.club),
      first_name: values.first_name,
      last_name: values.last_name,
      sex: values.sex,
      ltf_licenseid: values.ltf_licenseid ?? "",
      date_of_birth: values.date_of_birth ? values.date_of_birth : null,
      belt_rank: values.belt_rank ?? "",
      is_active: values.is_active,
    };
    try {
      if (editingMember) {
        await updateMember(editingMember.id, payload);
      } else {
        await createMember(payload);
      }
      setEditingMember(null);
      setIsFormOpen(false);
      reset();
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save member.");
    }
  };

  const startEdit = (member: Member) => {
    setEditingMember(member);
    setIsFormOpen(true);
    reset({
      club: String(member.club),
      first_name: member.first_name,
      last_name: member.last_name,
      sex: member.sex,
      ltf_licenseid: member.ltf_licenseid ?? "",
      date_of_birth: member.date_of_birth ?? "",
      belt_rank: member.belt_rank ?? "",
      is_active: member.is_active,
    });
  };

  const startCreate = () => {
    setEditingMember(null);
    setIsFormOpen(true);
    reset({
      club: selectedClubId ? String(selectedClubId) : "",
      first_name: "",
      last_name: "",
      sex: "M",
      ltf_licenseid: "",
      date_of_birth: "",
      belt_rank: "",
      is_active: true,
    });
  };

  const selectedLicenses = useMemo(() => {
    if (!memberToDelete) {
      return [];
    }
    return licenses.filter((license) => license.member === memberToDelete.id);
  }, [licenses, memberToDelete]);

  const licenseItems = selectedLicenses.map((license) => {
    const statusLabel =
      license.status === "active"
        ? t("statusActive")
        : license.status === "expired"
        ? t("statusExpired")
        : t("statusPending");
    return `${license.year} · ${statusLabel}`;
  });

  const handleDelete = (member: Member) => {
    setMemberToDelete(member);
    setIsDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!memberToDelete) {
      return;
    }
    try {
      await deleteMember(memberToDelete.id);
      setIsDeleteOpen(false);
      setMemberToDelete(null);
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete member.");
    }
  };

  const selectedMembers = members.filter((member) => selectedIds.includes(member.id));
  const selectedLicenseItems = selectedMembers.flatMap((member) => {
    const memberName = `${member.first_name} ${member.last_name}`;
    return licenses
      .filter((license) => license.member === member.id)
      .map((license) => {
        const statusLabel =
          license.status === "active"
            ? t("statusActive")
            : license.status === "expired"
            ? t("statusExpired")
            : t("statusPending");
        return `${memberName} — ${license.year} · ${statusLabel}`;
      });
  });

  const confirmBatchDelete = async () => {
    try {
      await Promise.all(selectedMembers.map((member) => deleteMember(member.id)));
      setSelectedIds([]);
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete members.");
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
            <Button onClick={startCreate}>{t("createMember")}</Button>
            <Button variant="outline" onClick={() => setIsImportOpen(true)}>
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
        ) : searchedMembers.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noMembersResultsSubtitle")} />
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
                render: (member) => (
                  <input
                    type="checkbox"
                    aria-label={common("selectRowLabel")}
                    checked={selectedIds.includes(member.id)}
                    onChange={() => toggleSelectRow(member.id)}
                  />
                ),
              },
              { key: "first_name", header: t("firstNameLabel") },
              { key: "last_name", header: t("lastNameLabel") },
              {
                key: "sex",
                header: t("sexLabel"),
                render: (member) => (member.sex === "F" ? t("sexFemale") : t("sexMale")),
              },
              { key: "belt_rank", header: t("beltRankLabel") },
              { key: "ltf_licenseid", header: t("ltfLicenseLabel") },
              { key: "date_of_birth", header: t("dobLabel") },
              {
                key: "is_active",
                header: t("isActiveLabel"),
                render: (member) => (member.is_active ? t("activeLabel") : t("inactiveLabel")),
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
                      onClick={() => startEdit(member)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={t("deleteAction")}
                      onClick={() => handleDelete(member)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={pagedMembers}
          />
        )}
      </div>

      <Modal
        title={editingMember ? t("updateMember") : t("createMember")}
        description={t("memberFormSubtitle")}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
      >
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-zinc-700">{t("clubLabel")}</label>
            <Select
              value={watch("club")}
              onValueChange={(value) => {
                setSelectedClubId(Number(value));
                setValue("club", value, { shouldValidate: true });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectClubPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {clubs.map((club) => (
                  <SelectItem key={club.id} value={String(club.id)}>
                    {club.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.club ? <p className="text-sm text-red-600">{errors.club.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("firstNameLabel")}</label>
            <Input placeholder="Jane" {...register("first_name")} />
            {errors.first_name ? (
              <p className="text-sm text-red-600">{errors.first_name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("lastNameLabel")}</label>
            <Input placeholder="Doe" {...register("last_name")} />
            {errors.last_name ? (
              <p className="text-sm text-red-600">{errors.last_name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("sexLabel")}</label>
            <Select
              value={watch("sex")}
              onValueChange={(value) => setValue("sex", value as "M" | "F", { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("sexLabel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="M">{t("sexMale")}</SelectItem>
                <SelectItem value="F">{t("sexFemale")}</SelectItem>
              </SelectContent>
            </Select>
            {errors.sex ? <p className="text-sm text-red-600">{errors.sex.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("ltfLicenseLabel")}</label>
            <Input placeholder="LTF-12345" {...register("ltf_licenseid")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("dobLabel")}</label>
            <Input type="date" {...register("date_of_birth")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("beltRankLabel")}</label>
            <Input placeholder="1st Dan" {...register("belt_rank")} />
          </div>

          <div className="flex items-center gap-2 md:col-span-2">
            <Checkbox
              checked={watch("is_active")}
              onCheckedChange={(value) => setValue("is_active", Boolean(value))}
              id="member-active"
            />
            <label htmlFor="member-active" className="text-sm font-medium text-zinc-700">
              {t("isActiveLabel")}
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {editingMember ? t("updateMember") : t("createMember")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingMember(null);
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
        title={common("deleteTitle", { item: common("itemMember") })}
        description={common("deleteMemberDescription", {
          name: memberToDelete
            ? `${memberToDelete.first_name} ${memberToDelete.last_name}`
            : "",
        })}
        listTitle={common("deleteCascadeTitle")}
        listItems={licenseItems}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={confirmDelete}
        onCancel={() => {
          setIsDeleteOpen(false);
          setMemberToDelete(null);
        }}
      />

      <DeleteConfirmModal
        isOpen={isBatchDeleteOpen}
        title={common("deleteTitle", { item: common("itemMember") })}
        description={common("deleteSelectedDescription", {
          count: selectedMembers.length,
          item: common("itemMember"),
        })}
        listTitle={common("deleteCascadeTitle")}
        listItems={selectedLicenseItems}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={() => {
          setIsBatchDeleteOpen(false);
          confirmBatchDelete();
        }}
        onCancel={() => setIsBatchDeleteOpen(false)}
      />

      <ImportCsvModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        type="members"
        title={importT("importMembers")}
        subtitle={importT("importMembersSubtitle")}
        fields={importFields}
        fixedClubId={selectedClubId}
        onComplete={loadData}
      />
    </ClubAdminLayout>
  );
}

function getDefaultValues(): MemberFormValues {
  return {
    club: "",
    first_name: "",
    last_name: "",
    date_of_birth: "",
    belt_rank: "",
  };
}
