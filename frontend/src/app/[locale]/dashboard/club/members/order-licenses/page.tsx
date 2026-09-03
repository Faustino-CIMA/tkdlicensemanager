"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { ActionNotices, FormPanel, PageNotice } from "@/components/ui/list-page-chrome";
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
  ClubOrderAvailability,
  ClubOrderEligibleLicenseType,
  ClubOrderIneligibleLicenseType,
  createClubOrdersBatch,
  getClubOrderEligibility,
} from "@/lib/club-finance-api";
import { apiRequest } from "@/lib/api";
import { formatDisplayDate } from "@/lib/date-display";
import { cn } from "@/lib/utils";

const ORDER_LICENSE_STORAGE_KEY = "club_members_order_license_payload";

type AuthMeResponse = { role: string };

type OrderPayload = {
  selectedIds: number[];
  selectedClubId: number | null;
  year?: number;
};

type LicenseTypeAvailability = "available" | "needs_review" | "already_licensed" | "unavailable";

type CreatedOrder = {
  id: number;
  orderNumber: string;
  memberCount: number;
  year: string;
  licenseTypeName: string;
};

const STRUCTURAL_REASON_CODES = new Set([
  "no_active_price",
  "current_year_disabled",
  "next_year_disabled",
  "window_closed",
  "invalid_target_year",
  "invalid_policy_configuration",
]);

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

function classifyIneligibleType(
  licenseType: ClubOrderIneligibleLicenseType,
  selectedCount: number
): LicenseTypeAvailability {
  const blockedIds = new Set(licenseType.ineligible_members.map((item) => item.member_id));
  const allBlocked = selectedCount > 0 && blockedIds.size >= selectedCount;
  if (!allBlocked && blockedIds.size > 0) {
    return "needs_review";
  }
  const reasonCodes = licenseType.reason_counts.map((reason) => reason.code);
  if (
    reasonCodes.length > 0 &&
    reasonCodes.every((code) => code === "duplicate_pending_or_active")
  ) {
    return "already_licensed";
  }
  return "unavailable";
}

function addMonths(source: Date, months: number) {
  const next = new Date(source.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function remainingCountdownParts(from: Date, to: Date) {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  let cursor = addMonths(from, months);
  if (cursor > to) {
    months -= 1;
    cursor = addMonths(from, months);
  }
  const remainingMs = Math.max(to.getTime() - cursor.getTime(), 0);
  return {
    months: Math.max(months, 0),
    days: Math.floor(remainingMs / 86_400_000),
    hours: Math.floor((remainingMs % 86_400_000) / 3_600_000),
  };
}

function formatPrice(amount: string, currency: string, locale: string) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    return `${amount} ${currency}`;
  }
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(parsed);
  } catch {
    return `${amount} ${currency}`;
  }
}

function AvailabilityDetails({
  availability,
  reason,
  kind,
  year,
}: {
  availability?: ClubOrderAvailability;
  reason: string;
  kind: "already_licensed" | "unavailable";
  year: string;
}) {
  const t = useTranslations("ClubAdmin");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const windowStart = availability?.window_start ?? null;
  const windowEnd = availability?.window_end ?? null;
  const opensAt = availability?.opens_at ?? null;
  const opensAtDate = opensAt ? new Date(opensAt) : null;
  const hasValidOpen = Boolean(opensAtDate && !Number.isNaN(opensAtDate.getTime()));
  const windowIsOpen = availability?.is_open === true;

  const countdownLabel = (() => {
    if (!hasValidOpen || !opensAtDate) {
      return null;
    }
    if (opensAtDate.getTime() <= now.getTime()) {
      return t("orderLicenseCountdownSoon");
    }
    const parts = remainingCountdownParts(now, opensAtDate);
    const units: string[] = [];
    if (parts.months > 0) {
      units.push(t("orderLicenseCountdownMonths", { count: parts.months }));
    }
    if (parts.days > 0) {
      units.push(t("orderLicenseCountdownDays", { count: parts.days }));
    }
    if (parts.hours > 0 || units.length === 0) {
      units.push(t("orderLicenseCountdownHours", { count: parts.hours }));
    }
    return units.join(", ");
  })();

  if (kind === "already_licensed") {
    return (
      <div className="space-y-1.5">
        <p className="font-medium text-foreground">{reason}</p>
        <p>{t("orderLicenseAlreadyLicensedHelp", { year })}</p>
        {windowIsOpen && windowStart && windowEnd ? (
          <p>
            {t("orderLicenseWindowOpenNow", {
              start: formatDisplayDate(windowStart),
              end: formatDisplayDate(windowEnd),
            })}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">{reason}</p>
      {windowIsOpen && windowStart && windowEnd ? (
        <p>
          {t("orderLicenseWindowOpenNow", {
            start: formatDisplayDate(windowStart),
            end: formatDisplayDate(windowEnd),
          })}
        </p>
      ) : windowStart && windowEnd ? (
        <p>
          {t("orderLicenseWindowLabel", {
            start: formatDisplayDate(windowStart),
            end: formatDisplayDate(windowEnd),
          })}
        </p>
      ) : null}
      {hasValidOpen && opensAtDate ? (
        <>
          <p>{t("orderLicenseOpensOn", { date: formatDisplayDate(opensAtDate) })}</p>
          {countdownLabel ? (
            <p className="font-semibold text-foreground">
              {t("orderLicenseOpensIn", { countdown: countdownLabel })}
            </p>
          ) : null}
        </>
      ) : windowIsOpen ? null : (
        <p>{t("orderLicenseNotScheduled")}</p>
      )}
    </div>
  );
}

export default function ClubMembersOrderLicensesPage() {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";

  const [payload] = useState<OrderPayload>(() => parseOrderPayload());
  const [workingSelectedIds, setWorkingSelectedIds] = useState<number[]>(() => payload.selectedIds);
  const [targetYear, setTargetYear] = useState(String(payload.year ?? new Date().getFullYear()));
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
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);

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

  const reviewTypes = useMemo(
    () =>
      ineligibleTypes.filter(
        (licenseType) => classifyIneligibleType(licenseType, validSelectedIds.length) === "needs_review"
      ),
    [ineligibleTypes, validSelectedIds.length]
  );
  const unavailableTypes = useMemo(
    () =>
      ineligibleTypes.filter(
        (licenseType) => classifyIneligibleType(licenseType, validSelectedIds.length) === "unavailable"
      ),
    [ineligibleTypes, validSelectedIds.length]
  );
  const alreadyLicensedTypes = useMemo(
    () =>
      ineligibleTypes.filter(
        (licenseType) =>
          classifyIneligibleType(licenseType, validSelectedIds.length) === "already_licensed"
      ),
    [ineligibleTypes, validSelectedIds.length]
  );

  const selectedTypeIdNumber = Number(selectedLicenseTypeId);
  const selectedEligibleType = useMemo(
    () => eligibleTypes.find((item) => item.id === selectedTypeIdNumber) ?? null,
    [eligibleTypes, selectedTypeIdNumber]
  );
  const selectedReviewType = useMemo(
    () => reviewTypes.find((item) => item.id === selectedTypeIdNumber) ?? null,
    [reviewTypes, selectedTypeIdNumber]
  );

  const ineligibleByMemberId = useMemo(() => {
    const map = new Map<number, { reasonCodes: string[]; messages: string[] }>();
    if (!selectedReviewType) {
      return map;
    }
    selectedReviewType.ineligible_members.forEach((item) => {
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
  }, [selectedReviewType]);

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

  const reasonLabel = useCallback(
    (code: string) => {
      switch (code) {
        case "no_active_price":
          return t("orderLicenseUnavailableReasonNoPrice");
        case "current_year_disabled":
          return t("orderLicenseUnavailableReasonCurrentYear");
        case "next_year_disabled":
          return t("orderLicenseUnavailableReasonNextYear");
        case "window_closed":
          return t("orderLicenseUnavailableReasonWindow");
        case "invalid_target_year":
          return t("orderLicenseUnavailableReasonYear");
        case "duplicate_pending_or_active":
          return t("orderLicenseUnavailableReasonDuplicate");
        case "invalid_policy_configuration":
          return t("orderLicenseUnavailableReasonPolicy");
        default:
          return t("orderLicenseUnavailableReasonGeneric");
      }
    },
    [t]
  );

  const unavailableReasonForType = (licenseType: ClubOrderIneligibleLicenseType) => {
    const preferred = licenseType.reason_counts.find((reason) =>
      STRUCTURAL_REASON_CODES.has(reason.code)
    );
    return reasonLabel(preferred?.code ?? licenseType.reason_counts[0]?.code ?? "not_eligible");
  };

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
    if (createdOrder || !payload.selectedClubId || validSelectedIds.length === 0) {
      if (!createdOrder) {
        setEligibleTypes([]);
        setIneligibleTypes([]);
      }
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
  }, [createdOrder, payload.selectedClubId, targetYear, t, validSelectedIds]);

  useEffect(() => {
    if (createdOrder) {
      return;
    }
    setSelectedLicenseTypeId((previous) => {
      if (previous && eligibleTypes.some((item) => String(item.id) === previous)) {
        return previous;
      }
      if (previous && reviewTypes.some((item) => String(item.id) === previous)) {
        return previous;
      }
      if (eligibleTypes.length === 1 && reviewTypes.length === 0) {
        return String(eligibleTypes[0].id);
      }
      return previous && eligibleTypes.some((item) => String(item.id) === previous) ? previous : "";
    });
  }, [createdOrder, eligibleTypes, reviewTypes]);

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
    setCreatedOrder(null);
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
    if (!selectedEligibleType) {
      setErrorMessage(
        selectedReviewType ? t("orderLicenseSelectedTypeBlockedError") : t("licenseTypeRequiredError")
      );
      return;
    }
    const parsedYear = Number(targetYear);
    if (!Number.isInteger(parsedYear)) {
      setErrorMessage(t("orderYearRequiredError"));
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const order = await createClubOrdersBatch({
        club: payload.selectedClubId,
        license_type: selectedEligibleType.id,
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
      setCreatedOrder({
        id: order.id,
        orderNumber: order.order_number,
        memberCount: validSelectedIds.length,
        year: targetYear,
        licenseTypeName: selectedEligibleType.name,
      });
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
          reason: blocked ? blocked.messages.join(" • ") : t("orderLicenseReadyReason"),
        };
      }),
    [ineligibleByMemberId, selectedMembers, t]
  );

  const goToMembers = () => {
    clearOrderPayload();
    router.push(`/${locale}/dashboard/club/members`);
  };

  if (isLoading) {
    return (
      <ClubAdminLayout title={t("orderLicenseModalTitle")} subtitle={t("orderLicenseModalSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
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
          <Button variant="outline" onClick={goToMembers}>
            {t("backToMembers")}
          </Button>
        </div>
      </ClubAdminLayout>
    );
  }

  if (createdOrder) {
    return (
      <ClubAdminLayout title={t("orderLicenseModalTitle")} subtitle={t("orderLicensePageSubtitle")}>
        <FormPanel className="mx-auto max-w-xl text-center">
          <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--success)_16%,white)] text-[color-mix(in_oklab,var(--success)_62%,black)]">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <h2 className="text-section text-foreground">{t("orderLicenseSuccessTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("orderLicenseSuccessSubtitle")}</p>
          <p className="mt-4 text-sm font-medium text-foreground">
            {t("orderLicenseSuccess", { count: createdOrder.memberCount })}
          </p>
          <p className="mt-1 text-sm text-muted">
            {createdOrder.licenseTypeName} · {createdOrder.year}
            {createdOrder.orderNumber ? ` · ${createdOrder.orderNumber}` : ""}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={() => router.push(`/${locale}/dashboard/club/orders/${createdOrder.id}`)}>
              {t("orderLicenseViewOrderAction")}
            </Button>
            <Button variant="outline" onClick={goToMembers}>
              {t("backToMembers")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCreatedOrder(null);
                setWorkingSelectedIds(payload.selectedIds);
                setErrorMessage(null);
              }}
            >
              {t("orderLicenseOrderAnotherAction")}
            </Button>
          </div>
        </FormPanel>
      </ClubAdminLayout>
    );
  }

  const canSubmit =
    Boolean(selectedEligibleType) && validSelectedIds.length > 0 && !isSubmitting && !isCheckingEligibility;

  return (
    <ClubAdminLayout title={t("orderLicenseModalTitle")} subtitle={t("orderLicensePageSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <div className="space-y-6">
        <FormPanel>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t("clubLabel")}</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {selectedClub?.name ?? payload.selectedClubId}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t("orderLicenseWorkingSelectionLabel")}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {t("orderLicenseMembersCountLabel", { count: validSelectedIds.length })}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted">
                {t("yearLabel")}
              </label>
              <Select value={targetYear} onValueChange={setTargetYear}>
                <SelectTrigger aria-label={t("yearLabel")}>
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
              <p className="text-xs text-muted">{t("orderLicenseYearHelp")}</p>
            </div>
          </div>
        </FormPanel>

        <FormPanel>
          <h2 className="text-section text-foreground">{t("orderLicenseAvailableTypesTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("orderLicenseTypePickerHelp")}</p>

          {isCheckingEligibility ? (
            <p className="mt-4 text-sm text-muted">{t("orderEligibilityLoading")}</p>
          ) : null}

          {!isCheckingEligibility && eligibleTypes.length === 0 && reviewTypes.length === 0 ? (
            <div className="mt-4">
              <PageNotice tone="info">
                {t("orderLicenseNoAvailableTypesSubtitle", { year: targetYear })}
              </PageNotice>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {eligibleTypes.map((licenseType) => {
                const selected = selectedLicenseTypeId === String(licenseType.id);
                return (
                  <button
                    key={`eligible-${licenseType.id}`}
                    type="button"
                    onClick={() => setSelectedLicenseTypeId(String(licenseType.id))}
                    className={cn(
                      "rounded-[var(--radius-card)] border p-4 text-left transition-colors",
                      selected
                        ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,white)] shadow-sm"
                        : "border-border bg-surface hover:bg-secondary"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{licenseType.name}</p>
                      <StatusBadge label={t("orderLicenseStatusAvailable")} tone="success" />
                    </div>
                    <p className="mt-3 text-sm font-medium text-foreground">
                      {formatPrice(
                        licenseType.active_price.amount,
                        licenseType.active_price.currency,
                        locale
                      )}
                    </p>
                  </button>
                );
              })}
              {reviewTypes.map((licenseType) => {
                const selected = selectedLicenseTypeId === String(licenseType.id);
                const blockedCount = new Set(licenseType.ineligible_members.map((item) => item.member_id))
                  .size;
                const readyCount = Math.max(validSelectedIds.length - blockedCount, 0);
                return (
                  <button
                    key={`review-${licenseType.id}`}
                    type="button"
                    onClick={() => setSelectedLicenseTypeId(String(licenseType.id))}
                    className={cn(
                      "rounded-[var(--radius-card)] border p-4 text-left transition-colors",
                      selected
                        ? "border-[var(--warning)] bg-[color-mix(in_oklab,var(--warning)_12%,white)] shadow-sm"
                        : "border-border bg-surface hover:bg-secondary"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{licenseType.name}</p>
                      <StatusBadge label={t("orderLicenseStatusNeedsReview")} tone="warning" />
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      {t("orderLicenseNeedsReviewHelp", {
                        ready: readyCount,
                        total: validSelectedIds.length,
                      })}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {alreadyLicensedTypes.length > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground">
                {t("orderLicenseAlreadyLicensedTitle")}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {t("orderLicenseAlreadyLicensedHelp", { year: targetYear })}
              </p>
              <ul className="mt-3 space-y-2">
                {alreadyLicensedTypes.map((licenseType) => (
                  <li
                    key={`already-${licenseType.id}`}
                    className="rounded-[var(--radius-form)] border border-border bg-secondary/50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{licenseType.name}</p>
                      <div className="flex items-center gap-1">
                        <InfoHint ariaLabel={t("orderLicenseAvailabilityHintAriaLabel")}>
                          <AvailabilityDetails
                            availability={licenseType.availability}
                            reason={t("orderLicenseUnavailableReasonDuplicate")}
                            kind="already_licensed"
                            year={targetYear}
                          />
                        </InfoHint>
                        <StatusBadge label={t("orderLicenseStatusAlreadyLicensed")} tone="info" />
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {licenseType.ineligible_members.map((item) => (
                        <li key={`${licenseType.id}-${item.member_id}`} className="text-sm text-muted">
                          {item.license_status === "pending"
                            ? t("orderLicenseAlreadyLicensedMemberPending", {
                                name: item.member_name,
                                type: licenseType.name,
                                year: targetYear,
                              })
                            : t("orderLicenseAlreadyLicensedMemberActive", {
                                name: item.member_name,
                                type: licenseType.name,
                                year: targetYear,
                              })}{" "}
                          <Link
                            href={`/${locale}/dashboard/club/members/${item.member_id}`}
                            className="font-medium text-[var(--accent)] underline-offset-4 hover:underline"
                          >
                            {t("orderLicenseViewMemberAction")}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {unavailableTypes.length > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground">
                {t("orderLicenseUnavailableTypesTitle")}
              </h3>
              <p className="mt-1 text-xs text-muted">{t("orderLicenseUnavailableTypesHelp")}</p>
              <ul className="mt-3 space-y-2">
                {unavailableTypes.map((licenseType) => (
                  <li
                    key={`unavailable-${licenseType.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-form)] border border-border bg-secondary/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{licenseType.name}</p>
                      <p className="text-xs text-muted">{unavailableReasonForType(licenseType)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <InfoHint ariaLabel={t("orderLicenseAvailabilityHintAriaLabel")}>
                        <AvailabilityDetails
                          availability={licenseType.availability}
                          reason={unavailableReasonForType(licenseType)}
                          kind="unavailable"
                          year={targetYear}
                        />
                      </InfoHint>
                      <StatusBadge label={t("orderLicenseStatusUnavailable")} tone="neutral" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </FormPanel>

        <FormPanel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-section text-foreground">{t("orderLicenseReviewTitle")}</h2>
              <p className="mt-1 text-sm text-muted">{t("orderLicenseReviewSubtitle")}</p>
            </div>
            {selectedReviewType ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={removeBlockedMembers}
                  disabled={blockedMemberIds.size === 0}
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
            ) : validSelectedIds.length !== payload.selectedIds.length ? (
              <Button type="button" variant="ghost" onClick={resetSelection}>
                {t("orderLicenseResetSelectionAction")}
              </Button>
            ) : null}
          </div>

          {selectedEligibleType || selectedReviewType ? (
            <div className="mt-4">
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
            <p className="mt-4 text-sm text-muted">{t("orderLicenseNoTypeSelected")}</p>
          )}
        </FormPanel>

        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-[var(--surface)]/95 p-4 shadow-sm backdrop-blur">
          <div className="min-w-0">
            {selectedEligibleType ? (
              <p className="text-sm font-medium text-foreground">
                {t("orderLicenseCreateActionDetail", {
                  count: validSelectedIds.length,
                  type: selectedEligibleType.name,
                  year: targetYear,
                })}
              </p>
            ) : selectedReviewType ? (
              <p className="text-sm text-muted">
                {t("orderLicenseNeedsReviewHelp", {
                  ready: Math.max(validSelectedIds.length - blockedMemberIds.size, 0),
                  total: validSelectedIds.length,
                })}
              </p>
            ) : (
              <p className="text-sm text-muted">{t("orderLicenseSelectTypeFirst")}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={goToMembers}>
              {t("backToMembers")}
            </Button>
            <Button variant="primary" onClick={handleCreateOrder} disabled={!canSubmit}>
              {isSubmitting ? t("orderLicenseProcessing") : t("orderLicenseButton", { year: targetYear })}
            </Button>
          </div>
        </div>
      </div>
    </ClubAdminLayout>
  );
}
