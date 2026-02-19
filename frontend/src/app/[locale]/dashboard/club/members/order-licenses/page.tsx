"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Club, Member, getClubs, getMembersList } from "@/lib/club-admin-api";
import {
  ClubOrderEligibleLicenseType,
  ClubOrderIneligibleLicenseType,
  createClubOrdersBatch,
  getClubOrderEligibility,
} from "@/lib/club-finance-api";
import { apiRequest } from "@/lib/api";

const ORDER_LICENSE_STORAGE_KEY = "club_members_order_license_payload";

type AuthMeResponse = { role: string };

type OrderPayload = {
  selectedIds: number[];
  selectedClubId: number | null;
  year?: number;
};

function parseOrderPayload(): OrderPayload {
  if (typeof window === "undefined") {
    return { selectedIds: [], selectedClubId: null };
  }
  try {
    const rawValue = window.sessionStorage.getItem(ORDER_LICENSE_STORAGE_KEY);
    if (!rawValue) {
      return { selectedIds: [], selectedClubId: null };
    }
    const parsedValue = JSON.parse(rawValue) as {
      selectedIds?: unknown;
      selectedClubId?: unknown;
      year?: unknown;
    };
    const selectedIds = Array.isArray(parsedValue.selectedIds)
      ? parsedValue.selectedIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const selectedClubId = Number(parsedValue.selectedClubId);
    const yearValue = Number(parsedValue.year);
    return {
      selectedIds: Array.from(new Set(selectedIds)),
      selectedClubId: Number.isInteger(selectedClubId) && selectedClubId > 0 ? selectedClubId : null,
      year: Number.isInteger(yearValue) && yearValue > 2000 ? yearValue : undefined,
    };
  } catch {
    return { selectedIds: [], selectedClubId: null };
  }
}

export default function ClubMembersOrderLicensesPage() {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";

  const [payload] = useState<OrderPayload>(() => parseOrderPayload());
  const [workingSelectedIds, setWorkingSelectedIds] = useState<number[]>(() => payload.selectedIds);
  const [targetYear, setTargetYear] = useState(
    String(payload.year ?? new Date().getFullYear())
  );
  const [selectedLicenseTypeId, setSelectedLicenseTypeId] = useState("");

  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [eligibleTypes, setEligibleTypes] = useState<ClubOrderEligibleLicenseType[]>([]);
  const [ineligibleTypes, setIneligibleTypes] = useState<ClubOrderIneligibleLicenseType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const eligibilityRequestIdRef = useRef(0);
  const canManageMembers = currentRole === "club_admin";

  const selectedClub = useMemo(
    () => clubs.find((club) => club.id === payload.selectedClubId) ?? null,
    [clubs, payload.selectedClubId]
  );

  const selectedClubMembers = useMemo(() => {
    if (!payload.selectedClubId) {
      return [];
    }
    return members.filter((member) => member.club === payload.selectedClubId);
  }, [members, payload.selectedClubId]);

  const validSelectedIds = useMemo(() => {
    const validIdSet = new Set(selectedClubMembers.map((member) => member.id));
    return workingSelectedIds.filter((id) => validIdSet.has(id));
  }, [selectedClubMembers, workingSelectedIds]);

  const selectedMembers = useMemo(() => {
    const memberById = new Map(selectedClubMembers.map((member) => [member.id, member]));
    return validSelectedIds
      .map((id) => memberById.get(id))
      .filter((member): member is Member => Boolean(member));
  }, [selectedClubMembers, validSelectedIds]);

  const selectedTypeIdNumber = Number(selectedLicenseTypeId);
  const selectedEligibleType = useMemo(
    () => eligibleTypes.find((item) => item.id === selectedTypeIdNumber) ?? null,
    [eligibleTypes, selectedTypeIdNumber]
  );
  const selectedIneligibleType = useMemo(
    () => ineligibleTypes.find((item) => item.id === selectedTypeIdNumber) ?? null,
    [ineligibleTypes, selectedTypeIdNumber]
  );

  const ineligibleByMemberId = useMemo(() => {
    const map = new Map<number, { reasonCodes: string[]; messages: string[] }>();
    if (!selectedIneligibleType) {
      return map;
    }
    selectedIneligibleType.ineligible_members.forEach((item) => {
      const existing = map.get(item.member_id);
      if (!existing) {
        map.set(item.member_id, { reasonCodes: [item.reason_code], messages: [item.message] });
        return;
      }
      if (!existing.reasonCodes.includes(item.reason_code)) {
        existing.reasonCodes.push(item.reason_code);
      }
      if (!existing.messages.includes(item.message)) {
        existing.messages.push(item.message);
      }
    });
    return map;
  }, [selectedIneligibleType]);

  const blockedMemberIds = useMemo(
    () => new Set(Array.from(ineligibleByMemberId.keys())),
    [ineligibleByMemberId]
  );
  const duplicateBlockedMemberIds = useMemo(() => {
    const ids: number[] = [];
    ineligibleByMemberId.forEach((value, memberId) => {
      if (value.reasonCodes.includes("duplicate_pending_or_active")) {
        ids.push(memberId);
      }
    });
    return new Set(ids);
  }, [ineligibleByMemberId]);

  const hasAnyEligibleType = eligibleTypes.length > 0;
  const hasSelectedTypeBlockedMembers = selectedIneligibleType
    ? selectedIneligibleType.ineligible_members.length > 0
    : false;

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const membersPromise =
        payload.selectedIds.length > 0
          ? getMembersList({
              clubId: payload.selectedClubId ?? undefined,
              ids: payload.selectedIds,
            })
          : Promise.resolve<Member[]>([]);
      const [me, clubsResponse, membersResponse] = await Promise.all([
        apiRequest<AuthMeResponse>("/api/auth/me/"),
        getClubs(),
        membersPromise,
      ]);
      setCurrentRole(me.role);
      setClubs(clubsResponse);
      setMembers(membersResponse);
    } catch (error) {
      setCurrentRole(null);
      setErrorMessage(error instanceof Error ? error.message : t("orderLicenseError"));
    } finally {
      setIsLoading(false);
    }
  }, [payload.selectedClubId, payload.selectedIds, t]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    setWorkingSelectedIds((previous) => Array.from(new Set(previous)));
  }, []);

  useEffect(() => {
    if (!payload.selectedClubId || validSelectedIds.length === 0) {
      setEligibleTypes([]);
      setIneligibleTypes([]);
      return;
    }
    const parsedYear = Number(targetYear);
    if (!Number.isInteger(parsedYear)) {
      return;
    }
    const requestId = eligibilityRequestIdRef.current + 1;
    eligibilityRequestIdRef.current = requestId;
    setIsCheckingEligibility(true);
    setErrorMessage(null);

    void getClubOrderEligibility({
      club: payload.selectedClubId,
      member_ids: validSelectedIds,
      year: parsedYear,
    })
      .then((response) => {
        if (requestId !== eligibilityRequestIdRef.current) {
          return;
        }
        setEligibleTypes(response.eligible_license_types);
        setIneligibleTypes(response.ineligible_license_types);
      })
      .catch((error) => {
        if (requestId !== eligibilityRequestIdRef.current) {
          return;
        }
        setEligibleTypes([]);
        setIneligibleTypes([]);
        setErrorMessage(error instanceof Error ? error.message : t("orderLicenseError"));
      })
      .finally(() => {
        if (requestId === eligibilityRequestIdRef.current) {
          setIsCheckingEligibility(false);
        }
      });
  }, [payload.selectedClubId, targetYear, t, validSelectedIds]);

  useEffect(() => {
    setSelectedLicenseTypeId((previous) => {
      if (
        previous &&
        (eligibleTypes.some((item) => String(item.id) === previous) ||
          ineligibleTypes.some((item) => String(item.id) === previous))
      ) {
        return previous;
      }
      if (eligibleTypes.length > 0) {
        return String(eligibleTypes[0].id);
      }
      if (ineligibleTypes.length > 0) {
        return String(ineligibleTypes[0].id);
      }
      return "";
    });
  }, [eligibleTypes, ineligibleTypes]);

  const clearOrderPayload = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(ORDER_LICENSE_STORAGE_KEY);
  };

  const removeBlockedMembers = () => {
    if (blockedMemberIds.size === 0) {
      return;
    }
    setWorkingSelectedIds((previous) => previous.filter((id) => !blockedMemberIds.has(id)));
  };

  const removeDuplicateMembers = () => {
    if (duplicateBlockedMemberIds.size === 0) {
      return;
    }
    setWorkingSelectedIds((previous) => previous.filter((id) => !duplicateBlockedMemberIds.has(id)));
  };

  const resetSelection = () => {
    setWorkingSelectedIds(payload.selectedIds);
    setSuccessMessage(null);
    setErrorMessage(null);
  };

  const handleCreateOrder = async () => {
    if (!canManageMembers || !payload.selectedClubId) {
      return;
    }
    if (validSelectedIds.length === 0) {
      setErrorMessage(t("orderLicenseNoMembersAfterFiltering"));
      return;
    }
    if (!selectedLicenseTypeId) {
      setErrorMessage(t("licenseTypeRequiredError"));
      return;
    }
    if (!selectedEligibleType) {
      setErrorMessage(t("orderLicenseSelectedTypeBlockedError"));
      return;
    }
    const parsedYear = Number(targetYear);
    if (!Number.isInteger(parsedYear)) {
      setErrorMessage(t("orderYearRequiredError"));
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      await createClubOrdersBatch({
        club: payload.selectedClubId,
        license_type: Number(selectedLicenseTypeId),
        member_ids: validSelectedIds,
        year: parsedYear,
        quantity: 1,
        tax_total: "0.00",
      });
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(
          `club_members_selected_ids:${payload.selectedClubId ?? "all"}`
        );
      }
      clearOrderPayload();
      setSuccessMessage(t("orderLicenseSuccess", { count: validSelectedIds.length }));
      setWorkingSelectedIds([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("orderLicenseError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const memberRows = useMemo(
    () =>
      selectedMembers.map((member) => {
        const blocked = ineligibleByMemberId.get(member.id);
        return {
          id: member.id,
          memberName: `${member.first_name} ${member.last_name}`,
          status: blocked ? "blocked" : "ready",
          reason: blocked ? blocked.messages.join(" • ") : "—",
        };
      }),
    [ineligibleByMemberId, selectedMembers]
  );

  if (isLoading) {
    return (
      <ClubAdminLayout title={t("orderLicenseModalTitle")} subtitle={t("orderLicenseModalSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </ClubAdminLayout>
    );
  }

  if (!canManageMembers) {
    return (
      <ClubAdminLayout title={t("orderLicenseModalTitle")} subtitle={t("orderLicenseModalSubtitle")}>
        <EmptyState
          title={t("orderLicenseForbiddenTitle")}
          description={t("orderLicenseForbiddenSubtitle")}
        />
      </ClubAdminLayout>
    );
  }

  if (!payload.selectedClubId || payload.selectedIds.length === 0) {
    return (
      <ClubAdminLayout title={t("orderLicenseModalTitle")} subtitle={t("orderLicenseModalSubtitle")}>
        <EmptyState
          title={t("orderLicenseNoSelectionTitle")}
          description={t("orderLicenseNoSelectionSubtitle")}
        />
        <div className="mt-4">
          <Button variant="outline" onClick={() => router.push(`/${locale}/dashboard/club/members`)}>
            {t("backToMembers")}
          </Button>
        </div>
      </ClubAdminLayout>
    );
  }

  return (
    <ClubAdminLayout title={t("orderLicenseModalTitle")} subtitle={t("orderLicensePageSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

      <div className="space-y-4">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <p className="text-sm text-zinc-600">
              <span className="font-medium text-zinc-800">{t("clubLabel")}:</span>{" "}
              {selectedClub?.name ?? payload.selectedClubId}
            </p>
            <p className="text-sm text-zinc-600">
              <span className="font-medium text-zinc-800">{t("orderLicenseOriginalSelectionLabel")}:</span>{" "}
              {payload.selectedIds.length}
            </p>
            <p className="text-sm text-zinc-600">
              <span className="font-medium text-zinc-800">{t("orderLicenseWorkingSelectionLabel")}:</span>{" "}
              {validSelectedIds.length}
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-600">
                {t("yearLabel")}
              </label>
              <Select value={targetYear} onValueChange={setTargetYear}>
                <SelectTrigger>
                  <SelectValue placeholder={t("yearLabel")} />
                </SelectTrigger>
                <SelectContent>
                  {[new Date().getFullYear(), new Date().getFullYear() + 1].map((yearValue) => (
                    <SelectItem key={yearValue} value={String(yearValue)}>
                      {yearValue}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-sm font-medium text-zinc-800">{t("licenseTypeLabel")}</p>
          <p className="mt-1 text-xs text-zinc-500">{t("orderLicenseTypePickerHelp")}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {eligibleTypes.map((licenseType) => (
              <button
                key={`eligible-${licenseType.id}`}
                type="button"
                onClick={() => setSelectedLicenseTypeId(String(licenseType.id))}
                className={`rounded-xl border p-3 text-left transition ${
                  selectedLicenseTypeId === String(licenseType.id)
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-zinc-200 bg-white hover:bg-zinc-50"
                }`}
              >
                <p className="text-sm font-medium text-zinc-900">{licenseType.name}</p>
                <p className="mt-1 text-xs text-emerald-700">{t("orderLicenseStatusReady")}</p>
                <p className="mt-1 text-xs text-zinc-600">
                  {licenseType.active_price.amount} {licenseType.active_price.currency}
                </p>
              </button>
            ))}
            {ineligibleTypes.map((licenseType) => (
              <button
                key={`ineligible-${licenseType.id}`}
                type="button"
                onClick={() => setSelectedLicenseTypeId(String(licenseType.id))}
                className={`rounded-xl border p-3 text-left transition ${
                  selectedLicenseTypeId === String(licenseType.id)
                    ? "border-amber-400 bg-amber-50"
                    : "border-zinc-200 bg-white hover:bg-zinc-50"
                }`}
              >
                <p className="text-sm font-medium text-zinc-900">{licenseType.name}</p>
                <p className="mt-1 text-xs text-amber-700">{t("orderLicenseStatusBlocked")}</p>
                <p className="mt-1 text-xs text-zinc-600">
                  {licenseType.reason_counts
                    .slice(0, 2)
                    .map((reason) => `${reason.message} (${reason.count})`)
                    .join(" • ")}
                </p>
              </button>
            ))}
          </div>
          {isCheckingEligibility ? (
            <p className="mt-3 text-sm text-zinc-600">{t("orderEligibilityLoading")}</p>
          ) : null}
          {!isCheckingEligibility && !hasAnyEligibleType ? (
            <p className="mt-3 text-sm text-amber-700">{t("orderEligibilityNoOptions")}</p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={removeBlockedMembers}
              disabled={!hasSelectedTypeBlockedMembers}
            >
              {t("orderLicenseResolveBlockedAction")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={removeDuplicateMembers}
              disabled={duplicateBlockedMemberIds.size === 0}
            >
              {t("orderLicenseResolveDuplicatesAction")}
            </Button>
            <Button type="button" variant="ghost" onClick={resetSelection}>
              {t("orderLicenseResetSelectionAction")}
            </Button>
          </div>

          {selectedLicenseTypeId ? (
            <div className="mt-3">
              <EntityTable
                columns={[
                  { key: "memberName", header: t("memberNameLabel") },
                  {
                    key: "status",
                    header: t("statusLabel"),
                    render: (row: { status: string }) => (
                      <StatusBadge
                        label={
                          row.status === "blocked"
                            ? t("orderLicenseStatusBlocked")
                            : t("orderLicenseStatusReady")
                        }
                        tone={row.status === "blocked" ? "warning" : "success"}
                      />
                    ),
                  },
                  { key: "reason", header: t("orderLicenseReasonLabel") },
                ]}
                rows={memberRows}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-600">{t("orderLicenseNoTypeSelected")}</p>
          )}
        </section>

        <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-4 backdrop-blur">
          <Button
            onClick={handleCreateOrder}
            disabled={
              isSubmitting ||
              isCheckingEligibility ||
              !selectedEligibleType ||
              validSelectedIds.length === 0
            }
          >
            {isSubmitting
              ? t("orderLicenseProcessing")
              : t("orderLicenseButton", { year: targetYear })}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearOrderPayload();
              router.push(`/${locale}/dashboard/club/members`);
            }}
          >
            {t("backToMembers")}
          </Button>
        </div>
      </div>
    </ClubAdminLayout>
  );
}
