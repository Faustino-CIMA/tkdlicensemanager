"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { resolveAssignedClubId, useClubSelection } from "@/components/club-selection-provider";
import {
  License,
  LicenseType,
  Member,
  getClubs,
  getLicenseTypes,
  getLicensesPage,
  getMembersList,
} from "@/lib/club-admin-api";
import { formatDisplayDate } from "@/lib/date-display";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterPills } from "@/components/ui/filter-pills";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrinterProfile, getPrinterProfiles } from "@/lib/license-card-api";

type LicenseStatusFilter = "all" | "active" | "pending" | "expired";

/** Matches backend `API_PAGINATION_MAX_PAGE_SIZE`. */
const LICENSES_LIST_PAGE_SIZE_CAP = 200;

type AuthMeResponse = { role: string };
const QUICK_PRINT_STORAGE_KEY = "club_quick_print_payload";
const NO_PRINTER_PROFILE_VALUE = "__no_printer_profile__";

export default function ClubAdminLicensesPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const { selectedClubId, setSelectedClubId } = useClubSelection();
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [selectedLicenseIds, setSelectedLicenseIds] = useState<number[]>([]);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [printerProfiles, setPrinterProfiles] = useState<PrinterProfile[]>([]);
  const [selectedQuickPrintPrinterProfileValue, setSelectedQuickPrintPrinterProfileValue] =
    useState(NO_PRINTER_PROFILE_VALUE);
  const [licenseTypes, setLicenseTypes] = useState<LicenseType[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [licenseStatusFilter, setLicenseStatusFilter] = useState<LicenseStatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionsHintOpen, setActionsHintOpen] = useState(false);
  const [licenseFacetCounts, setLicenseFacetCounts] = useState({
    all: 0,
    active: 0,
    pending: 0,
    expired: 0,
  });

  const pageSizeOptions = ["50", "150", "300", "all"];
  const canManageLicenses = currentRole === "club_admin";
  const statusFilterParam = licenseStatusFilter === "all" ? undefined : licenseStatusFilter;

  const licensesListPageSize = useMemo(() => {
    if (pageSize === "all") {
      return Math.min(Math.max(totalCount, 1), LICENSES_LIST_PAGE_SIZE_CAP);
    }
    const n = Number(pageSize);
    if (!Number.isFinite(n) || n <= 0) {
      return 50;
    }
    return Math.min(n, LICENSES_LIST_PAGE_SIZE_CAP);
  }, [pageSize, totalCount]);

  useEffect(() => {
    if (!canManageLicenses) {
      setPrinterProfiles([]);
      setSelectedQuickPrintPrinterProfileValue(NO_PRINTER_PROFILE_VALUE);
      return;
    }
    let isMounted = true;
    const loadPrinterProfiles = async () => {
      try {
        const profiles = await getPrinterProfiles();
        if (isMounted) {
          setPrinterProfiles(profiles);
        }
      } catch {
        if (isMounted) {
          setPrinterProfiles([]);
        }
      }
    };
    void loadPrinterProfiles();
    return () => {
      isMounted = false;
    };
  }, [canManageLicenses]);

  useEffect(() => {
    if (selectedQuickPrintPrinterProfileValue === NO_PRINTER_PROFILE_VALUE) {
      return;
    }
    const hasSelection = printerProfiles.some(
      (profile) => String(profile.id) === selectedQuickPrintPrinterProfileValue
    );
    if (!hasSelection) {
      setSelectedQuickPrintPrinterProfileValue(NO_PRINTER_PROFILE_VALUE);
    }
  }, [printerProfiles, selectedQuickPrintPrinterProfileValue]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const clubsResponse = await getClubs();
      const effectiveClubId = resolveAssignedClubId(clubsResponse, selectedClubId);
      if (effectiveClubId !== selectedClubId) {
        setSelectedClubId(effectiveClubId);
      }

      const licenseTypesPromise = getLicenseTypes();
      if (!effectiveClubId) {
        const licenseTypesResponse = await licenseTypesPromise;
        setLicenseTypes(licenseTypesResponse);
        setLicenses([]);
        setMembers([]);
        setTotalCount(0);
        setLicenseFacetCounts({ all: 0, active: 0, pending: 0, expired: 0 });
        return;
      }

      const q = searchQuery || undefined;
      const [licensesResponse, allCountRes, activeCountRes, pendingCountRes, expiredCountRes] =
        await Promise.all([
          getLicensesPage({
            page: currentPage,
            pageSize: licensesListPageSize,
            clubId: effectiveClubId,
            q,
            status: statusFilterParam,
          }),
          getLicensesPage({
            page: 1,
            pageSize: 1,
            clubId: effectiveClubId,
            q,
          }),
          getLicensesPage({
            page: 1,
            pageSize: 1,
            clubId: effectiveClubId,
            q,
            status: "active",
          }),
          getLicensesPage({
            page: 1,
            pageSize: 1,
            clubId: effectiveClubId,
            q,
            status: "pending",
          }),
          getLicensesPage({
            page: 1,
            pageSize: 1,
            clubId: effectiveClubId,
            q,
            status: "expired",
          }),
        ]);
      setLicenses(licensesResponse.results);
      setTotalCount(licensesResponse.count);
      setLicenseFacetCounts({
        all: allCountRes.count,
        active: activeCountRes.count,
        pending: pendingCountRes.count,
        expired: expiredCountRes.count,
      });

      const memberIds = Array.from(new Set(licensesResponse.results.map((license) => license.member)));
      if (memberIds.length > 0) {
        const membersResponse = await getMembersList({
          clubId: effectiveClubId,
          ids: memberIds,
        });
        setMembers(membersResponse);
      } else {
        setMembers([]);
      }

      const licenseTypesResponse = await licenseTypesPromise;
      setLicenseTypes(licenseTypesResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load licenses.");
    } finally {
      setIsLoading(false);
    }
  }, [
    currentPage,
    licensesListPageSize,
    searchQuery,
    selectedClubId,
    setSelectedClubId,
    statusFilterParam,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
    void loadCurrentUserRole();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const memberById = useMemo(() => {
    return new Map(members.map((member) => [member.id, member]));
  }, [members]);

  const licenseTypeNameById = useMemo(
    () => new Map(licenseTypes.map((licenseType) => [licenseType.id, licenseType.name])),
    [licenseTypes]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / licensesListPageSize));

  const allLicenseIds = useMemo(() => licenses.map((license) => license.id), [licenses]);
  const allLicensesSelected =
    allLicenseIds.length > 0 &&
    allLicenseIds.every((licenseId) => selectedLicenseIds.includes(licenseId));
  const visibleSelectedCount = selectedLicenseIds.filter((licenseId) =>
    allLicenseIds.includes(licenseId)
  ).length;
  const hiddenSelectedCount = Math.max(selectedLicenseIds.length - visibleSelectedCount, 0);
  const selectedQuickPrintPrinterProfileId = useMemo(() => {
    if (selectedQuickPrintPrinterProfileValue === NO_PRINTER_PROFILE_VALUE) {
      return null;
    }
    const parsedValue = Number(selectedQuickPrintPrinterProfileValue);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }, [selectedQuickPrintPrinterProfileValue]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubId, pageSize, licenseStatusFilter]);

  const toggleSelectAllLicenses = () => {
    if (!canManageLicenses) {
      return;
    }
    if (allLicensesSelected) {
      setSelectedLicenseIds([]);
      return;
    }
    setSelectedLicenseIds(allLicenseIds);
  };

  const clearSelectedLicenses = () => {
    setSelectedLicenseIds([]);
  };

  const toggleSelectLicense = (licenseId: number) => {
    if (!canManageLicenses) {
      return;
    }
    setSelectedLicenseIds((previous) =>
      previous.includes(licenseId)
        ? previous.filter((id) => id !== licenseId)
        : [...previous, licenseId]
    );
  };

  const openQuickPrintPage = () => {
    if (!canManageLicenses || !selectedClubId || selectedLicenseIds.length === 0) {
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        QUICK_PRINT_STORAGE_KEY,
        JSON.stringify({
          source: "licenses",
          selectedClubId,
          memberIds: [],
          licenseIds: selectedLicenseIds,
          printerProfileId: selectedQuickPrintPrinterProfileId,
        })
      );
    }
    router.push(`/${locale}/dashboard/club/print-jobs/quick-print`);
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

  const getStatusTone = (status: License["status"]): "success" | "warning" | "danger" | "neutral" => {
    if (status === "active") {
      return "success";
    }
    if (status === "expired") {
      return "neutral";
    }
    if (status === "pending") {
      return "warning";
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
    ...(canManageLicenses
      ? [
          {
            key: "select",
            header: (
              <span className="inline-flex min-h-[var(--control-height)] min-w-[var(--control-height)] items-center justify-center">
                <Checkbox
                  aria-label={common("selectAllLabel")}
                  checked={allLicensesSelected}
                  onCheckedChange={() => toggleSelectAllLicenses()}
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
                  checked={selectedLicenseIds.includes(license.id)}
                  onCheckedChange={() => toggleSelectLicense(license.id)}
                />
              </span>
            ),
          },
        ]
      : []),
    {
      key: "member",
      header: t("memberLabel"),
      render: (license: License) => {
        const member = memberById.get(license.member);
        return member ? `${member.first_name} ${member.last_name}` : t("unknownMember");
      },
    },
    { key: "year", header: t("yearLabel") },
    {
      key: "license_type",
      header: t("licenseTypeLabel"),
      render: (license: License) =>
        licenseTypeNameById.get(license.license_type) ?? t("unknownLicenseType"),
    },
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
  ];

  return (
    <ClubAdminLayout title={t("licensesTitle")} subtitle={t("licensesSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex min-w-[12rem] flex-1 flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <Input
                  className="w-full max-w-xs"
                  placeholder={t("searchLicensesPlaceholder")}
                  aria-label={t("searchLicensesPlaceholder")}
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>
              <div>
                <Select value={pageSize} onValueChange={setPageSize}>
                  <SelectTrigger className="w-[150px]" aria-label={common("rowsPerPageLabel")}>
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
              </div>
            </div>

            <div className="min-w-0 flex-1 border-t border-[var(--border)] pt-4 sm:border-t-0 sm:pt-0">
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
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-h-[var(--control-height)] flex-wrap items-center gap-3">
              {canManageLicenses ? (
                <>
                  <Select
                    value=""
                    disabled={selectedLicenseIds.length === 0}
                    onValueChange={(value) => {
                      if (value === "print-cards") {
                        openQuickPrintPage();
                      }
                    }}
                  >
                    <SelectTrigger className="min-w-[11rem]" aria-label={common("batchActionsLabel")}>
                      <SelectValue placeholder={common("batchActionsLabel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="print-cards" disabled={!selectedClubId}>
                        {t("actionPrintCards")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedQuickPrintPrinterProfileValue}
                    onValueChange={setSelectedQuickPrintPrinterProfileValue}
                  >
                    <SelectTrigger
                      className="min-w-[11rem]"
                      aria-label={t("quickPrintEntryPrinterProfileLabel")}
                    >
                      <SelectValue placeholder={t("quickPrintEntryPrinterProfilePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PRINTER_PROFILE_VALUE}>
                        {t("quickPrintPrinterProfileNoneOption")}
                      </SelectItem>
                      {printerProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={String(profile.id)}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}

              {canManageLicenses && selectedLicenseIds.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
                  <span className="font-medium text-[var(--foreground)]">
                    {t("selectedMembersCountLabel", { count: selectedLicenseIds.length })}
                  </span>
                  {hiddenSelectedCount > 0 ? (
                    <span className="font-medium text-warning">
                      {t("hiddenSelectedMembersCountLabel", { count: hiddenSelectedCount })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="min-h-[var(--control-height)] rounded-[var(--radius-form)] px-2 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
                    onClick={clearSelectedLicenses}
                  >
                    {t("clearSelection")}
                  </button>
                </div>
              ) : canManageLicenses ? (
                <div className="group relative">
                  <button
                    type="button"
                    className="inline-flex h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] items-center justify-center rounded-[var(--radius-form)] text-muted transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label={t("licensesSelectionHintAriaLabel")}
                    aria-expanded={actionsHintOpen}
                    onClick={() => setActionsHintOpen((open) => !open)}
                    onBlur={() => setActionsHintOpen(false)}
                  >
                    <CircleAlert className="h-4 w-4" />
                  </button>
                  <span
                    role="tooltip"
                    className={`absolute left-0 top-full z-20 mt-2 w-max max-w-xs rounded-[var(--radius-form)] border border-border bg-surface px-3 py-2 text-sm text-muted shadow-[var(--shadow-card)] ${
                      actionsHintOpen ? "visible" : "invisible group-hover:visible group-focus-within:visible"
                    }`}
                  >
                    {t("licensesSelectionHintShort")}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              <span>{t("pageLabel", { current: currentPage, total: totalPages })}</span>
              <Button
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              >
                {t("previousPage")}
              </Button>
              <Button
                variant="outline"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : licenses.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noLicensesResultsSubtitle")} />
        ) : (
          <EntityTable
            columns={columns}
            rows={licenses}
            onRowClick={(license) =>
              router.push(`/${locale}/dashboard/club/members/${license.member}`)
            }
          />
        )}
      </div>
    </ClubAdminLayout>
  );
}
