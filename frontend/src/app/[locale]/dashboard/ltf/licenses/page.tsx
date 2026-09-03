"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import {
  ListActionsRow,
  ListPagination,
  ListToolbarPanel,
  PageSizeSelect,
  SelectionMeta,
  resolveListPageSize,
  ActionNotices
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClubSelection } from "@/components/club-selection-provider";
import {
  Club,
  License,
  LicenseType,
  Member,
  createLicense,
  getClubs,
  getLicenseTypes,
  getLicensesPage,
  getMembersList,
  updateLicense,
} from "@/lib/ltf-admin-api";
import { formatDisplayDate } from "@/lib/date-display";

const licenseSchema = z.object({
  club: z.string().min(1, "Club is required"),
  member: z.string().min(1, "Member is required"),
  license_type: z.string().min(1, "License type is required"),
  year: z.string().min(4, "Year is required"),
  status: z.enum(["pending", "active", "expired"]),
});

type LicenseFormValues = z.infer<typeof licenseSchema>;
type LicenseStatusFilter = "all" | "active" | "pending" | "expired";

const BATCH_DELETE_STORAGE_KEY = "ltf_licenses_batch_delete_ids";

export default function LtfAdminLicensesPage() {
  const t = useTranslations("LtfAdmin");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [clubMembers, setClubMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [licenseTypes, setLicenseTypes] = useState<LicenseType[]>([]);
  const [editingLicense, setEditingLicense] = useState<License | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [licenseStatusFilter, setLicenseStatusFilter] = useState<LicenseStatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [licenseFacetCounts, setLicenseFacetCounts] = useState({
    all: 0,
    active: 0,
    pending: 0,
    expired: 0,
  });
  const lastSelectedLicenseIdRef = useRef<number | null>(null);
  const rowSelectModifierRef = useRef({ shiftKey: false });
  const { selectedClubId: headerClubId } = useClubSelection();

  const licensesListPageSize = useMemo(
    () => resolveListPageSize(pageSize, totalCount),
    [pageSize, totalCount]
  );
  const statusFilterParam = licenseStatusFilter === "all" ? undefined : licenseStatusFilter;

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
      const q = searchQuery || undefined;
      const clubId = headerClubId ?? undefined;
      const [
        clubsResponse,
        licensesResponse,
        licenseTypesResponse,
        allCountRes,
        activeCountRes,
        pendingCountRes,
        expiredCountRes,
      ] = await Promise.all([
        getClubs(),
        getLicensesPage({
          page: currentPage,
          pageSize: licensesListPageSize,
          q,
          clubId,
          status: statusFilterParam,
        }),
        getLicenseTypes(),
        getLicensesPage({ page: 1, pageSize: 1, q, clubId }),
        getLicensesPage({ page: 1, pageSize: 1, q, clubId, status: "active" }),
        getLicensesPage({ page: 1, pageSize: 1, q, clubId, status: "pending" }),
        getLicensesPage({ page: 1, pageSize: 1, q, clubId, status: "expired" }),
      ]);
      setLicenseFacetCounts({
        all: allCountRes.count,
        active: activeCountRes.count,
        pending: pendingCountRes.count,
        expired: expiredCountRes.count,
      });

      const visibleMemberIds = Array.from(
        new Set(licensesResponse.results.map((license) => license.member))
      );
      const membersResponse =
        visibleMemberIds.length > 0 ? await getMembersList({ ids: visibleMemberIds }) : [];
      setClubs(clubsResponse);
      setMembers(membersResponse);
      setLicenses(licensesResponse.results);
      setTotalCount(licensesResponse.count);
      setLicenseTypes(licenseTypesResponse);
      if (headerClubId) {
        setValue("club", String(headerClubId));
      } else if (clubsResponse.length > 0 && !watch("club")) {
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
  }, [currentPage, headerClubId, licensesListPageSize, searchQuery, setValue, statusFilterParam, watch]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [headerClubId, searchQuery, pageSize, statusFilterParam]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const selectedClubId = Number(watch("club")) || null;

  useEffect(() => {
    if (!selectedClubId) {
      setClubMembers([]);
      return;
    }

    let cancelled = false;
    void getMembersList({ clubId: selectedClubId })
      .then((response) => {
        if (!cancelled) {
          setClubMembers(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClubMembers([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClubId]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clubById = useMemo(() => new Map(clubs.map((club) => [club.id, club])), [clubs]);
  const licenseTypeById = useMemo(
    () => new Map(licenseTypes.map((licenseType) => [licenseType.id, licenseType])),
    [licenseTypes]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / licensesListPageSize));

  const allFilteredIds = useMemo(() => licenses.map((license) => license.id), [licenses]);
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
        const startIndex = allFilteredIds.indexOf(anchorId);
        const endIndex = allFilteredIds.indexOf(id);
        if (startIndex !== -1 && endIndex !== -1) {
          const [fromIndex, toIndex] =
            startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
          const rangeIds = allFilteredIds.slice(fromIndex, toIndex + 1);
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
      return previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
    });
    lastSelectedLicenseIdRef.current = id;
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
    const editableStatus = license.status === "revoked" ? "expired" : license.status;
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

  const getStatusTone = (status: License["status"]): "success" | "warning" | "neutral" | "danger" => {
    if (status === "active") {
      return "success";
    }
    if (status === "pending") {
      return "warning";
    }
    if (status === "expired") {
      return "neutral";
    }
    return "danger";
  };

  const formatIssuedAt = (value: string | null) => {
    if (!value) {
      return "—";
    }
    return formatDisplayDate(value);
  };

  const columns = [
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
      render: (license: License) => (
        <span
          className="inline-flex min-h-[var(--control-height)] min-w-[var(--control-height)] items-center justify-center"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            aria-label={common("selectRowLabel")}
            checked={selectedIds.includes(license.id)}
            onPointerDown={(event) => {
              rowSelectModifierRef.current = {
                shiftKey: event.shiftKey,
              };
            }}
            onCheckedChange={() =>
              toggleSelectRow(license.id, {
                shiftKey: rowSelectModifierRef.current.shiftKey,
              })
            }
          />
        </span>
      ),
    },
    {
      key: "member",
      header: t("memberLabel"),
      render: (license: License) => {
        const member = memberById.get(license.member);
        return member ? `${member.first_name} ${member.last_name}` : t("unknownMember");
      },
    },
    {
      key: "club",
      header: t("clubLabel"),
      render: (license: License) => clubById.get(license.club)?.name ?? t("unknownClub"),
    },
    {
      key: "license_type",
      header: t("licenseTypeLabel"),
      render: (license: License) =>
        licenseTypeById.get(license.license_type)?.name ?? t("unknownLicenseType"),
    },
    { key: "year", header: t("yearLabel") },
    {
      key: "status",
      header: t("statusLabel"),
      render: (license: License) => (
        <StatusBadge label={getStatusLabel(license.status)} tone={getStatusTone(license.status)} />
      ),
    },
    {
      key: "issued_at",
      header: t("issuedAtLabel"),
      render: (license: License) => formatIssuedAt(license.issued_at),
    },
    {
      key: "actions",
      header: t("actionsLabel"),
      render: (license: License) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0 p-0"
            aria-label={t("editAction")}
            onClick={() => startEdit(license)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="destructive"
            className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0 p-0"
            aria-label={t("deleteAction")}
            onClick={() => handleDelete(license)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <LtfAdminLayout title={t("licensesTitle")} subtitle={t("licensesSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <ListToolbarPanel
            search={
              <Input
                className="w-full max-w-xs"
                placeholder={t("searchLicensesPlaceholder")}
                aria-label={t("searchLicensesPlaceholder")}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
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
            filters={
              <FilterPills
                ariaLabel={t("licensesStatusFilterAriaLabel")}
                value={licenseStatusFilter}
                onChange={setLicenseStatusFilter}
                options={[
                  { value: "all", title: t("filterAllTitle"), count: licenseFacetCounts.all },
                  { value: "active", title: t("filterActiveTitle"), count: licenseFacetCounts.active },
                  { value: "pending", title: t("filterPendingTitle"), count: licenseFacetCounts.pending },
                  { value: "expired", title: t("filterExpiredTitle"), count: licenseFacetCounts.expired },
                ]}
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
                      startCreate();
                    }
                  }}
                >
                  <SelectTrigger className="min-w-[11rem]" aria-label={t("licensesMenuLabel")}>
                    <SelectValue placeholder={t("licensesMenuLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">{t("createLicense")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value=""
                  disabled={selectedIds.length === 0}
                  onValueChange={(value) => {
                    if (value === "delete") {
                      openBatchDeletePage();
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
                  onClear={() => {
                    setSelectedIds([]);
                    lastSelectedLicenseIdRef.current = null;
                  }}
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
        ) : licenses.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noLicensesResultsSubtitle")} />
        ) : (
          <EntityTable columns={columns} rows={licenses} />
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
            <label className="text-sm font-medium text-foreground">{t("clubLabel")}</label>
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
            {errors.club ? <p className="text-sm text-destructive">{errors.club.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("memberLabel")}</label>
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
            {errors.member ? <p className="text-sm text-destructive">{errors.member.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("licenseTypeLabel")}</label>
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
              <p className="text-sm text-destructive">{errors.license_type.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("yearLabel")}</label>
            <Input type="number" min="2000" {...register("year")} />
            {errors.year ? <p className="text-sm text-destructive">{errors.year.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("statusLabel")}</label>
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
