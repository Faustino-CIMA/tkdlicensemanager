"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import {
  Club,
  License,
  Member,
  createLicense,
  getClubs,
  getLicenses,
  getMembers,
  updateLicense,
} from "@/lib/club-admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const licenseSchema = z.object({
  club: z.string().min(1, "Club is required"),
  member: z.string().min(1, "Member is required"),
  year: z.string().min(4, "Year is required"),
  status: z.enum(["pending", "active", "expired"]),
});

type LicenseFormValues = z.infer<typeof licenseSchema>;

export default function ClubAdminLicensesPage() {
  const t = useTranslations("ClubAdmin");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [editingLicense, setEditingLicense] = useState<License | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSize = 8;

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
      year: new Date().getFullYear().toString(),
      status: "pending",
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

  const filteredMembers = useMemo(() => {
    if (!selectedClubId) {
      return members;
    }
    return members.filter((member) => member.club === selectedClubId);
  }, [members, selectedClubId]);

  const filteredLicenses = useMemo(() => {
    if (!selectedClubId) {
      return licenses;
    }
    return licenses.filter((license) => license.club === selectedClubId);
  }, [licenses, selectedClubId]);

  const searchedLicenses = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return filteredLicenses;
    }
    return filteredLicenses.filter((license) => {
      const member = members.find((item) => item.id === license.member);
      const memberName = member ? `${member.first_name} ${member.last_name}`.toLowerCase() : "";
      const yearText = String(license.year);
      const statusText = license.status.toLowerCase();
      return (
        memberName.includes(normalizedQuery) ||
        yearText.includes(normalizedQuery) ||
        statusText.includes(normalizedQuery)
      );
    });
  }, [filteredLicenses, members, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(searchedLicenses.length / pageSize));
  const pagedLicenses = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return searchedLicenses.slice(startIndex, startIndex + pageSize);
  }, [currentPage, searchedLicenses]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubId]);

  const onSubmit = async (values: LicenseFormValues) => {
    setErrorMessage(null);
    const payload = {
      club: Number(values.club),
      member: Number(values.member),
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
      year: String(license.year),
      status: license.status,
    });
  };

  const startCreate = () => {
    setEditingLicense(null);
    setIsFormOpen(true);
    reset({
      club: selectedClubId ? String(selectedClubId) : "",
      member: "",
      year: new Date().getFullYear().toString(),
      status: "pending",
    });
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
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
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
                key: "member",
                header: t("memberLabel"),
                render: (license) => {
                  const member = members.find((item) => item.id === license.member);
                  return member ? `${member.first_name} ${member.last_name}` : t("unknownMember");
                },
              },
              { key: "year", header: t("yearLabel") },
              { key: "status", header: t("statusLabel") },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (license) => (
                  <Button variant="outline" size="sm" onClick={() => startEdit(license)}>
                    {t("editAction")}
                  </Button>
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
            <label className="text-sm font-medium text-zinc-700">{t("memberLabel")}</label>
            <Select
              value={watch("member")}
              onValueChange={(value) => setValue("member", value, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectMemberPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {filteredMembers.map((member) => (
                  <SelectItem key={member.id} value={String(member.id)}>
                    {member.first_name} {member.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.member ? <p className="text-sm text-red-600">{errors.member.message}</p> : null}
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
    </ClubAdminLayout>
  );
}
