"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";

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
import {
  Club,
  License,
  LicenseType,
  Member,
  createLicense,
  deleteLicense,
  getClubs,
  getLicenseTypes,
  getLicenses,
  getMembers,
  updateLicense,
} from "@/lib/nma-admin-api";

const licenseSchema = z.object({
  club: z.string().min(1, "Club is required"),
  member: z.string().min(1, "Member is required"),
  license_type: z.string().min(1, "License type is required"),
  year: z.string().min(4, "Year is required"),
  status: z.enum(["pending", "active", "expired"]),
});

type LicenseFormValues = z.infer<typeof licenseSchema>;

export default function NmaAdminLicensesPage() {
  const t = useTranslations("NmaAdmin");
  const common = useTranslations("Common");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [licenseTypes, setLicenseTypes] = useState<LicenseType[]>([]);
  const [editingLicense, setEditingLicense] = useState<License | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [licenseToDelete, setLicenseToDelete] = useState<License | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSizeOptions = ["25", "50", "100", "150", "200", "all"];

  const {
    handleSubmit,
    reset,
    setValue,
    watch,
    register,
    formState: { errors, isSubmitting },
  } = useForm<LicenseFormValues>({
    resolver: zodResolver(licenseSchema),
    defaultValues: {
      club: "",
      member: "",
      license_type: "",
      year: new Date().getFullYear().toString(),
      status: "pending",
    },
  });

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [clubsResponse, membersResponse, licensesResponse, licenseTypesResponse] =
        await Promise.all([getClubs(), getMembers(), getLicenses(), getLicenseTypes()]);
      setClubs(clubsResponse);
      setMembers(membersResponse);
      setLicenses(licensesResponse);
      setLicenseTypes(licenseTypesResponse);
      if (clubsResponse.length > 0 && !watch("club")) {
        setValue("club", String(clubsResponse[0].id));
      }
      if (licenseTypesResponse.length > 0 && !watch("license_type")) {
        setValue("license_type", String(licenseTypesResponse[0].id));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load licenses.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedClubId = Number(watch("club")) || null;
  const clubMembers = useMemo(() => {
    if (!selectedClubId) {
      return members;
    }
    return members.filter((member) => member.club === selectedClubId);
  }, [members, selectedClubId]);

  const searchedLicenses = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return licenses;
    }
    return licenses.filter((license) => {
      const member = members.find((item) => item.id === license.member);
      const club = clubs.find((item) => item.id === license.club);
      const licenseType = licenseTypes.find((item) => item.id === license.license_type);
      const memberName = member ? `${member.first_name} ${member.last_name}`.toLowerCase() : "";
      const clubName = club?.name.toLowerCase() ?? "";
      const yearText = String(license.year);
      const statusText = license.status.toLowerCase();
      const licenseTypeName = licenseType?.name.toLowerCase() ?? "";
      return (
        memberName.includes(normalizedQuery) ||
        clubName.includes(normalizedQuery) ||
        yearText.includes(normalizedQuery) ||
        statusText.includes(normalizedQuery) ||
        licenseTypeName.includes(normalizedQuery)
      );
    });
  }, [clubs, licenseTypes, licenses, members, searchQuery]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(searchedLicenses.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(searchedLicenses.length / resolvedPageSize));
  const pagedLicenses = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return searchedLicenses.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, searchedLicenses, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const allFilteredIds = useMemo(
    () => searchedLicenses.map((license) => license.id),
    [searchedLicenses]
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

  const onSubmit = async (values: LicenseFormValues) => {
    setErrorMessage(null);
    const payload = {
      club: Number(values.club),
      member: Number(values.member),
      license_type: Number(values.license_type),
      year: Number(values.year),
      status: values.status,
    };
    try {
      if (editingLicense) {
        await updateLicense(editingLicense.id, payload);
      } else {
        await createLicense(payload);
      }
      setEditingLicense(null);
      setIsFormOpen(false);
      reset({
        club: values.club,
        member: "",
        license_type: values.license_type,
        year: new Date().getFullYear().toString(),
        status: "pending",
      });
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save license.");
    }
  };

  const startEdit = (license: License) => {
    setEditingLicense(license);
    setIsFormOpen(true);
    reset({
      club: String(license.club),
      member: String(license.member),
      license_type: String(license.license_type),
      year: String(license.year),
      status: license.status,
    });
  };

  const startCreate = () => {
    setEditingLicense(null);
    setIsFormOpen(true);
    reset({
      club: clubs[0] ? String(clubs[0].id) : "",
      member: "",
      license_type: licenseTypes[0] ? String(licenseTypes[0].id) : "",
      year: new Date().getFullYear().toString(),
      status: "pending",
    });
  };

  const handleDelete = (license: License) => {
    setLicenseToDelete(license);
    setIsDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!licenseToDelete) {
      return;
    }
    try {
      await deleteLicense(licenseToDelete.id);
      setIsDeleteOpen(false);
      setLicenseToDelete(null);
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete license.");
    }
  };

  const selectedLicenses = licenses.filter((license) => selectedIds.includes(license.id));

  const confirmBatchDelete = async () => {
    try {
      await Promise.all(selectedLicenses.map((license) => deleteLicense(license.id)));
      setSelectedIds([]);
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete licenses.");
    }
  };

  const licenseStatusLabel =
    licenseToDelete?.status === "active"
      ? t("statusActive")
      : licenseToDelete?.status === "expired"
      ? t("statusExpired")
      : t("statusPending");
  const licenseLabel = licenseToDelete
    ? `${licenseToDelete.year} · ${licenseStatusLabel}`
    : "";
  const selectedLicenseItems = selectedLicenses.map((license) => {
    const member = members.find((item) => item.id === license.member);
    const club = clubs.find((item) => item.id === license.club);
    const memberLabel = member ? `${member.first_name} ${member.last_name}` : t("unknownMember");
    const clubLabel = club ? club.name : t("unknownClub");
    const statusLabel =
      license.status === "active"
        ? t("statusActive")
        : license.status === "expired"
        ? t("statusExpired")
        : t("statusPending");
    return `${memberLabel} · ${clubLabel} — ${license.year} · ${statusLabel}`;
  });

  return (
    <NmaAdminLayout title={t("licensesTitle")} subtitle={t("licensesSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchLicensesPlaceholder")}
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
            <Button onClick={startCreate}>{t("createLicense")}</Button>
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
        ) : searchedLicenses.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noLicensesResultsSubtitle")} />
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
                render: (license) => (
                  <input
                    type="checkbox"
                    aria-label={common("selectRowLabel")}
                    checked={selectedIds.includes(license.id)}
                    onChange={() => toggleSelectRow(license.id)}
                  />
                ),
              },
              {
                key: "member",
                header: t("memberLabel"),
                render: (license) => {
                  const member = members.find((item) => item.id === license.member);
                  return member ? `${member.first_name} ${member.last_name}` : t("unknownMember");
                },
              },
              {
                key: "club",
                header: t("clubLabel"),
                render: (license) => {
                  const club = clubs.find((item) => item.id === license.club);
                  return club ? club.name : t("unknownClub");
                },
              },
              { key: "year", header: t("yearLabel") },
              {
                key: "license_type",
                header: t("licenseTypeLabel"),
                render: (license) => {
                  const licenseType = licenseTypes.find((item) => item.id === license.license_type);
                  return licenseType ? licenseType.name : t("unknownLicenseType");
                },
              },
              { key: "status", header: t("statusLabel") },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (license) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t("editAction")}
                      onClick={() => startEdit(license)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={t("deleteAction")}
                      onClick={() => handleDelete(license)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={pagedLicenses}
          />
        )}
      </div>

      <Modal
        title={editingLicense ? t("updateLicense") : t("createLicense")}
        description={t("licenseFormSubtitle")}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
      >
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-zinc-700">{t("clubLabel")}</label>
            <Select
              value={watch("club")}
              onValueChange={(value) => setValue("club", value, { shouldValidate: true })}
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
            <label className="text-sm font-medium text-zinc-700">{t("memberLabel")}</label>
            <Select
              value={watch("member")}
              onValueChange={(value) => setValue("member", value, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectMemberPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {clubMembers.map((member) => (
                  <SelectItem key={member.id} value={String(member.id)}>
                    {member.first_name} {member.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.member ? <p className="text-sm text-red-600">{errors.member.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("licenseTypeLabel")}</label>
            <Select
              value={watch("license_type")}
              onValueChange={(value) => setValue("license_type", value, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectLicenseTypePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {licenseTypes.map((licenseType) => (
                  <SelectItem key={licenseType.id} value={String(licenseType.id)}>
                    {licenseType.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.license_type ? (
              <p className="text-sm text-red-600">{errors.license_type.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("yearLabel")}</label>
            <Input type="number" min="2000" {...register("year")} />
            {errors.year ? <p className="text-sm text-red-600">{errors.year.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("statusLabel")}</label>
            <Select
              value={watch("status")}
              onValueChange={(value) =>
                setValue("status", value as "pending" | "active" | "expired", {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectStatusPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">{t("statusPending")}</SelectItem>
                <SelectItem value="active">{t("statusActive")}</SelectItem>
                <SelectItem value="expired">{t("statusExpired")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {editingLicense ? t("updateLicense") : t("createLicense")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingLicense(null);
                setIsFormOpen(false);
                reset({
                  club: watch("club"),
                  member: "",
                  license_type: watch("license_type"),
                  year: new Date().getFullYear().toString(),
                  status: "pending",
                });
              }}
            >
              {t("cancelEdit")}
            </Button>
          </div>
        </form>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteOpen}
        title={common("deleteTitle", { item: common("itemLicense") })}
        description={common("deleteDescriptionWithName", { name: licenseLabel })}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={confirmDelete}
        onCancel={() => {
          setIsDeleteOpen(false);
          setLicenseToDelete(null);
        }}
      />

      <DeleteConfirmModal
        isOpen={isBatchDeleteOpen}
        title={common("deleteTitle", { item: common("itemLicense") })}
        description={common("deleteSelectedDescription", {
          count: selectedLicenses.length,
          item: common("itemLicense"),
        })}
        listTitle={common("batchDeleteListTitle")}
        listItems={selectedLicenseItems}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={() => {
          setIsBatchDeleteOpen(false);
          confirmBatchDelete();
        }}
        onCancel={() => setIsBatchDeleteOpen(false)}
      />
    </NmaAdminLayout>
  );
}
