"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
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
  getClubs,
  getLicenseTypes,
  getLicenses,
  getMembers,
  updateLicense,
} from "@/lib/ltf-admin-api";

const licenseSchema = z.object({
  club: z.string().min(1, "Club is required"),
  member: z.string().min(1, "Member is required"),
  license_type: z.string().min(1, "License type is required"),
  year: z.string().min(4, "Year is required"),
  status: z.enum(["pending", "active", "expired"]),
});

type LicenseFormValues = z.infer<typeof licenseSchema>;

function getYearKey(clubId: number, year: number) {
  return `${clubId}:${year}`;
}

const BATCH_DELETE_STORAGE_KEY = "ltf_licenses_batch_delete_ids";

export default function LtfAdminLicensesPage() {
  const t = useTranslations("LtfAdmin");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [licenseTypes, setLicenseTypes] = useState<LicenseType[]>([]);
  const [expandedClubIds, setExpandedClubIds] = useState<number[]>([]);
  const [expandedYearKeys, setExpandedYearKeys] = useState<string[]>([]);
  const [editingLicense, setEditingLicense] = useState<License | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastSelectedLicenseIdRef = useRef<number | null>(null);

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

  const loadData = useCallback(async () => {
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
  }, [setValue, watch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedClubId = Number(watch("club")) || null;
  const clubMembers = useMemo(() => {
    if (!selectedClubId) {
      return members;
    }
    return members.filter((member) => member.club === selectedClubId);
  }, [members, selectedClubId]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clubById = useMemo(() => new Map(clubs.map((club) => [club.id, club])), [clubs]);
  const licenseTypeById = useMemo(
    () => new Map(licenseTypes.map((licenseType) => [licenseType.id, licenseType])),
    [licenseTypes]
  );

  const searchedLicenses = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return licenses;
    }
    return licenses.filter((license) => {
      const member = memberById.get(license.member);
      const club = clubById.get(license.club);
      const licenseType = licenseTypeById.get(license.license_type);
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
  }, [clubById, licenseTypeById, licenses, memberById, searchQuery]);

  const groupedClubRows = useMemo(() => {
    const grouped = new Map<
      number,
      {
        clubName: string;
        yearsMap: Map<number, License[]>;
      }
    >();

    for (const license of searchedLicenses) {
      const clubName = clubById.get(license.club)?.name ?? t("unknownClub");
      const clubEntry = grouped.get(license.club);
      if (!clubEntry) {
        grouped.set(license.club, {
          clubName,
          yearsMap: new Map([[license.year, [license]]]),
        });
        continue;
      }
      const yearEntry = clubEntry.yearsMap.get(license.year);
      if (yearEntry) {
        yearEntry.push(license);
      } else {
        clubEntry.yearsMap.set(license.year, [license]);
      }
    }

    return Array.from(grouped.entries())
      .map(([clubId, clubEntry]) => {
        const years = Array.from(clubEntry.yearsMap.entries())
          .map(([year, yearLicenses]) => {
            const licensesForYear = [...yearLicenses].sort((left, right) => {
              const leftName = memberById.get(left.member)
                ? `${memberById.get(left.member)!.first_name} ${memberById.get(left.member)!.last_name}`
                : t("unknownMember");
              const rightName = memberById.get(right.member)
                ? `${memberById.get(right.member)!.first_name} ${memberById.get(right.member)!.last_name}`
                : t("unknownMember");
              const byName = leftName.localeCompare(rightName);
              if (byName !== 0) {
                return byName;
              }
              return right.id - left.id;
            });
            const activeCount = licensesForYear.filter((license) => license.status === "active").length;
            const pendingCount = licensesForYear.filter((license) => license.status === "pending").length;
            const expiredCount = licensesForYear.filter((license) => license.status === "expired").length;
            return {
              year,
              licenses: licensesForYear,
              total: licensesForYear.length,
              activeCount,
              pendingCount,
              expiredCount,
            };
          })
          .sort((left, right) => right.year - left.year);

        const total = years.reduce((sum, year) => sum + year.total, 0);
        const activeCount = years.reduce((sum, year) => sum + year.activeCount, 0);
        const pendingCount = years.reduce((sum, year) => sum + year.pendingCount, 0);
        const expiredCount = years.reduce((sum, year) => sum + year.expiredCount, 0);

        return {
          clubId,
          clubName: clubEntry.clubName,
          years,
          total,
          activeCount,
          pendingCount,
          expiredCount,
        };
      })
      .sort((left, right) => left.clubName.localeCompare(right.clubName));
  }, [clubById, memberById, searchedLicenses, t]);

  const resolvedPageSize =
    pageSize === "all" ? Math.max(groupedClubRows.length, 1) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(groupedClubRows.length / resolvedPageSize));
  const pagedClubRows = useMemo(() => {
    const startIndex = (currentPage - 1) * resolvedPageSize;
    return groupedClubRows.slice(startIndex, startIndex + resolvedPageSize);
  }, [currentPage, groupedClubRows, resolvedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  useEffect(() => {
    const validClubIds = new Set(groupedClubRows.map((clubGroup) => clubGroup.clubId));
    setExpandedClubIds((previous) => previous.filter((clubId) => validClubIds.has(clubId)));
    const validYearKeys = new Set(
      groupedClubRows.flatMap((clubGroup) =>
        clubGroup.years.map((yearGroup) => getYearKey(clubGroup.clubId, yearGroup.year))
      )
    );
    setExpandedYearKeys((previous) => previous.filter((yearKey) => validYearKeys.has(yearKey)));
  }, [groupedClubRows]);

  const expandedClubSet = useMemo(() => new Set(expandedClubIds), [expandedClubIds]);
  const expandedYearSet = useMemo(() => new Set(expandedYearKeys), [expandedYearKeys]);

  const allFilteredIds = useMemo(
    () => searchedLicenses.map((license) => license.id),
    [searchedLicenses]
  );
  const visibleLeafLicenseIds = useMemo(() => {
    const ids: number[] = [];
    for (const clubGroup of pagedClubRows) {
      if (!expandedClubSet.has(clubGroup.clubId)) {
        continue;
      }
      for (const yearGroup of clubGroup.years) {
        const yearKey = getYearKey(clubGroup.clubId, yearGroup.year);
        if (expandedYearSet.has(yearKey)) {
          ids.push(...yearGroup.licenses.map((license) => license.id));
        }
      }
    }
    return ids;
  }, [expandedClubSet, expandedYearSet, pagedClubRows]);
  const allSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allFilteredIds);
    }
    lastSelectedLicenseIdRef.current = null;
  };

  useEffect(() => {
    if (
      lastSelectedLicenseIdRef.current !== null &&
      !allFilteredIds.includes(lastSelectedLicenseIdRef.current)
    ) {
      lastSelectedLicenseIdRef.current = null;
    }
  }, [allFilteredIds]);

  const toggleSelectRow = (id: number, options?: { shiftKey?: boolean }) => {
    const shiftKey = options?.shiftKey ?? false;
    setSelectedIds((previous) => {
      if (shiftKey && lastSelectedLicenseIdRef.current !== null) {
        const anchorId = lastSelectedLicenseIdRef.current;
        const order = visibleLeafLicenseIds.length > 0 ? visibleLeafLicenseIds : allFilteredIds;
        const startIndex = order.indexOf(anchorId);
        const endIndex = order.indexOf(id);
        if (startIndex !== -1 && endIndex !== -1) {
          const [fromIndex, toIndex] =
            startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
          const rangeIds = order.slice(fromIndex, toIndex + 1);
          const rangeSet = new Set(rangeIds);
          const allRangeSelected = rangeIds.every((rangeId) => previous.includes(rangeId));
          if (allRangeSelected) {
            return previous.filter((existingId) => !rangeSet.has(existingId));
          }
          const merged = new Set(previous);
          for (const rangeId of rangeIds) {
            merged.add(rangeId);
          }
          return Array.from(merged);
        }
      }
      return previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id];
    });
    lastSelectedLicenseIdRef.current = id;
  };

  const toggleClubExpanded = (clubId: number) => {
    setExpandedClubIds((previous) =>
      previous.includes(clubId)
        ? previous.filter((id) => id !== clubId)
        : [...previous, clubId]
    );
  };

  const toggleYearExpanded = (clubId: number, year: number) => {
    const key = getYearKey(clubId, year);
    setExpandedYearKeys((previous) =>
      previous.includes(key)
        ? previous.filter((id) => id !== key)
        : [...previous, key]
    );
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
    const editableStatus =
      license.status === "revoked" ? "expired" : license.status;
    setEditingLicense(license);
    setIsFormOpen(true);
    reset({
      club: String(license.club),
      member: String(license.member),
      license_type: String(license.license_type),
      year: String(license.year),
      status: editableStatus,
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
    router.push(`/${locale}/dashboard/ltf/licenses/${license.id}/delete`);
  };

  const openBatchDeletePage = () => {
    if (selectedIds.length === 0) {
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(BATCH_DELETE_STORAGE_KEY, JSON.stringify(selectedIds));
    }
    router.push(`/${locale}/dashboard/ltf/licenses/batch-delete`);
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

  const formatIssuedAt = (value: string | null) => {
    if (!value) {
      return "—";
    }
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return "—";
    }
    return parsedDate.toLocaleDateString();
  };

  return (
    <LtfAdminLayout title={t("licensesTitle")} subtitle={t("licensesSubtitle")}>
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
        ) : groupedClubRows.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noLicensesResultsSubtitle")} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-100 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="w-10 px-4 py-3 font-medium" />
                  <th className="px-4 py-3 font-medium">{t("clubLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("totalLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusActive")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusPending")}</th>
                  <th className="px-4 py-3 font-medium">{t("statusExpired")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {pagedClubRows.map((clubGroup) => {
                  const clubExpanded = expandedClubSet.has(clubGroup.clubId);
                  return (
                    <Fragment key={clubGroup.clubId}>
                      <tr
                        className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
                        onClick={() => toggleClubExpanded(clubGroup.clubId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleClubExpanded(clubGroup.clubId);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={clubExpanded}
                      >
                        <td className="px-4 py-3 text-zinc-500">
                          {clubExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">{clubGroup.clubName}</td>
                        <td className="px-4 py-3">{clubGroup.total}</td>
                        <td className="px-4 py-3">{clubGroup.activeCount}</td>
                        <td className="px-4 py-3">{clubGroup.pendingCount}</td>
                        <td className="px-4 py-3">{clubGroup.expiredCount}</td>
                      </tr>
                      {clubExpanded ? (
                        <tr className="bg-zinc-50/60">
                          <td colSpan={6} className="px-6 py-3">
                            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                                  <tr>
                                    <th className="w-10 px-4 py-2 font-medium" />
                                    <th className="px-4 py-2 font-medium">{t("yearLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("totalLabel")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusActive")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusPending")}</th>
                                    <th className="px-4 py-2 font-medium">{t("statusExpired")}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                  {clubGroup.years.map((yearGroup) => {
                                    const yearKey = getYearKey(clubGroup.clubId, yearGroup.year);
                                    const yearExpanded = expandedYearSet.has(yearKey);
                                    return (
                                      <Fragment key={yearKey}>
                                        <tr
                                          className="cursor-pointer text-zinc-700 hover:bg-zinc-50"
                                          onClick={() => toggleYearExpanded(clubGroup.clubId, yearGroup.year)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              toggleYearExpanded(clubGroup.clubId, yearGroup.year);
                                            }
                                          }}
                                          tabIndex={0}
                                          role="button"
                                          aria-expanded={yearExpanded}
                                        >
                                          <td className="px-4 py-2 text-zinc-500">
                                            {yearExpanded ? (
                                              <ChevronDown className="h-4 w-4" />
                                            ) : (
                                              <ChevronRight className="h-4 w-4" />
                                            )}
                                          </td>
                                          <td className="px-4 py-2 font-medium">{yearGroup.year}</td>
                                          <td className="px-4 py-2">{yearGroup.total}</td>
                                          <td className="px-4 py-2">{yearGroup.activeCount}</td>
                                          <td className="px-4 py-2">{yearGroup.pendingCount}</td>
                                          <td className="px-4 py-2">{yearGroup.expiredCount}</td>
                                        </tr>
                                        {yearExpanded ? (
                                          <tr className="bg-zinc-50/50">
                                            <td colSpan={6} className="px-6 py-3">
                                              <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
                                                <table className="min-w-full text-left text-sm">
                                                  <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
                                                    <tr>
                                                      <th className="w-10 px-4 py-2 font-medium">
                                                        <input
                                                          type="checkbox"
                                                          aria-label={common("selectAllLabel")}
                                                          checked={allSelected}
                                                          onChange={toggleSelectAll}
                                                        />
                                                      </th>
                                                      <th className="px-4 py-2 font-medium">{t("memberLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("licenseTypeLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("statusLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("issuedAtLabel")}</th>
                                                      <th className="px-4 py-2 font-medium">{t("actionsLabel")}</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-zinc-100">
                                                    {yearGroup.licenses.map((license) => {
                                                      const member = memberById.get(license.member);
                                                      const licenseType = licenseTypeById.get(
                                                        license.license_type
                                                      );
                                                      return (
                                                        <tr key={license.id} className="text-zinc-700">
                                                          <td className="px-4 py-2">
                                                            <input
                                                              type="checkbox"
                                                              aria-label={common("selectRowLabel")}
                                                              checked={selectedIds.includes(license.id)}
                                                              readOnly
                                                              onClick={(event) => {
                                                                event.stopPropagation();
                                                                toggleSelectRow(license.id, {
                                                                  shiftKey: event.shiftKey,
                                                                });
                                                              }}
                                                            />
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {member
                                                              ? `${member.first_name} ${member.last_name}`
                                                              : t("unknownMember")}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {licenseType
                                                              ? licenseType.name
                                                              : t("unknownLicenseType")}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {getStatusLabel(license.status)}
                                                          </td>
                                                          <td className="px-4 py-2">
                                                            {formatIssuedAt(license.issued_at)}
                                                          </td>
                                                          <td className="px-4 py-2">
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
                                                          </td>
                                                        </tr>
                                                      );
                                                    })}
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
    </LtfAdminLayout>
  );
}
