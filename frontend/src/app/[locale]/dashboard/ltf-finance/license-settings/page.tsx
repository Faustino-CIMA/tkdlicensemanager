"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CircleDollarSign,
  IdCard,
  Receipt,
  ScrollText,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ActionNotices,
  FormPanel,
  ListActionsRow,
  ListToolbarPanel,
  PageNotice,
} from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import {
  ClubFeeBillingSchedule,
  ClubFeeCadence,
  ClubFeePrice,
  ClubFeeType,
  FinanceLicenseType,
  LicensePrice,
  createClubFeeBilling,
  createClubFeePrice,
  createClubFeeType,
  createLicensePrice,
  deleteClubFeeType,
  deleteFinanceLicenseType,
  getClubFeeBillingSchedules,
  getClubFeePrices,
  getClubFeeTypes,
  getFinanceLicenseTypes,
  getLicensePrices,
  updateClubFeeBillingSchedule,
} from "@/lib/ltf-finance-api";
import { Club, getClubs, updateClub } from "@/lib/club-admin-api";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-display";

const SETTINGS_TABS = ["license-types", "license-prices", "club-fees", "billing"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function parseSettingsTab(value: string | null): SettingsTab {
  if (value && (SETTINGS_TABS as readonly string[]).includes(value)) {
    return value as SettingsTab;
  }
  return "license-types";
}

function formatWindow(startMonth: number, startDay: number, endMonth: number, endDay: number) {
  return `${String(startDay).padStart(2, "0")}/${String(startMonth).padStart(2, "0")} - ${String(
    endDay
  ).padStart(2, "0")}/${String(endMonth).padStart(2, "0")}`;
}

type PriceDraft = {
  amount: string;
  effectiveFrom: string;
};

export default function LtfFinanceLicenseSettingsPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const missingPriceIssue = searchParams.get("issue") === "missing_price";
  const urlTab = parseSettingsTab(searchParams.get("tab"));
  const [activeTab, setActiveTabState] = useState<SettingsTab>(urlTab);
  const [licenseTypes, setLicenseTypes] = useState<FinanceLicenseType[]>([]);
  const [prices, setPrices] = useState<LicensePrice[]>([]);
  const [clubFeeTypes, setClubFeeTypes] = useState<ClubFeeType[]>([]);
  const [clubFeePrices, setClubFeePrices] = useState<ClubFeePrice[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [licenseTypeToDelete, setLicenseTypeToDelete] = useState<FinanceLicenseType | null>(null);
  const [feeTypeToDelete, setFeeTypeToDelete] = useState<ClubFeeType | null>(null);

  const [priceDrafts, setPriceDrafts] = useState<Record<number, PriceDraft>>({});
  const [savingPriceByType, setSavingPriceByType] = useState<Record<number, boolean>>({});
  const [feePriceDrafts, setFeePriceDrafts] = useState<Record<number, PriceDraft>>({});
  const [savingFeePriceByType, setSavingFeePriceByType] = useState<Record<number, boolean>>({});
  const [newFeeName, setNewFeeName] = useState("");
  const [newFeeDescription, setNewFeeDescription] = useState("");
  const [newFeeCadence, setNewFeeCadence] = useState<ClubFeeCadence>("one_off");
  const [newFeeAmount, setNewFeeAmount] = useState("");
  const [newFeeActive, setNewFeeActive] = useState(true);
  const [isCreatingFee, setIsCreatingFee] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [schedules, setSchedules] = useState<ClubFeeBillingSchedule[]>([]);
  const [selectedFeeIds, setSelectedFeeIds] = useState<number[]>([]);
  const [selectedClubIds, setSelectedClubIds] = useState<number[]>([]);
  const [billAllActiveClubs, setBillAllActiveClubs] = useState(true);
  const [billingDate, setBillingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billingRecurring, setBillingRecurring] = useState(false);
  const [billingRecurrence, setBillingRecurrence] = useState<"monthly" | "annual">("annual");
  const [isBilling, setIsBilling] = useState(false);

  useEffect(() => {
    setActiveTabState(urlTab);
  }, [urlTab]);

  const setActiveTab = useCallback(
    (tab: SettingsTab) => {
      setActiveTabState(tab);
      const nextParams = new URLSearchParams(searchParams.toString());
      if (tab === "license-types") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", tab);
      }
      const nextQuery = nextParams.toString();
      const currentQuery = searchParams.toString();
      if (nextQuery === currentQuery) {
        return;
      }
      router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [
        licenseTypesResponse,
        pricesResponse,
        feeTypesResponse,
        feePricesResponse,
        clubsResponse,
        schedulesResponse,
      ] = await Promise.all([
          getFinanceLicenseTypes(),
          getLicensePrices(),
          getClubFeeTypes(),
          getClubFeePrices(),
          getClubs(),
          getClubFeeBillingSchedules(),
        ]);
      setLicenseTypes(licenseTypesResponse);
      setPrices(pricesResponse);
      setClubFeeTypes(feeTypesResponse);
      setClubFeePrices(feePricesResponse);
      setClubs(clubsResponse);
      setSchedules(schedulesResponse);
      setPriceDrafts((previous) => {
        const next: Record<number, PriceDraft> = {};
        licenseTypesResponse.forEach((licenseType) => {
          next[licenseType.id] = previous[licenseType.id] ?? {
            amount: "",
            effectiveFrom: "",
          };
        });
        return next;
      });
      setFeePriceDrafts((previous) => {
        const next: Record<number, PriceDraft> = {};
        feeTypesResponse.forEach((feeType) => {
          next[feeType.id] = previous[feeType.id] ?? {
            amount: "",
            effectiveFrom: "",
          };
        });
        return next;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("licenseSettingsLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredLicenseTypes = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const pricedTypeIds = new Set(
      prices
        .filter((price) => price.effective_from <= today)
        .map((price) => price.license_type)
    );
    const normalized = searchQuery.trim().toLowerCase();
    return licenseTypes.filter((licenseType) => {
      if (missingPriceIssue && pricedTypeIds.has(licenseType.id)) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return (
        licenseType.name.toLowerCase().includes(normalized) ||
        licenseType.code.toLowerCase().includes(normalized)
      );
    });
  }, [licenseTypes, missingPriceIssue, prices, searchQuery]);

  const pricesByLicenseType = useMemo(() => {
    const grouped: Record<number, LicensePrice[]> = {};
    licenseTypes.forEach((licenseType) => {
      grouped[licenseType.id] = [];
    });
    prices.forEach((price) => {
      if (!grouped[price.license_type]) {
        grouped[price.license_type] = [];
      }
      grouped[price.license_type].push(price);
    });
    Object.keys(grouped).forEach((licenseTypeId) => {
      grouped[Number(licenseTypeId)].sort((left, right) => {
        const byEffectiveDate = right.effective_from.localeCompare(left.effective_from);
        if (byEffectiveDate !== 0) {
          return byEffectiveDate;
        }
        return right.created_at.localeCompare(left.created_at);
      });
    });
    return grouped;
  }, [licenseTypes, prices]);

  const openDeleteTypeModal = (licenseType: FinanceLicenseType) => {
    setFeeTypeToDelete(null);
    setLicenseTypeToDelete(licenseType);
    setIsDeleteOpen(true);
  };

  const confirmDeleteType = async () => {
    if (!licenseTypeToDelete) {
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteFinanceLicenseType(licenseTypeToDelete.id);
      setIsDeleteOpen(false);
      setLicenseTypeToDelete(null);
      setSuccessMessage(t("licenseTypeDeletedMessage"));
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("licenseTypeDeleteError"));
    }
  };

  const updatePriceDraft = (licenseTypeId: number, patch: Partial<PriceDraft>) => {
    setPriceDrafts((previous) => ({
      ...previous,
      [licenseTypeId]: {
        amount: previous[licenseTypeId]?.amount ?? "",
        effectiveFrom: previous[licenseTypeId]?.effectiveFrom ?? "",
        ...patch,
      },
    }));
  };

  const savePrice = async (licenseTypeId: number) => {
    const draft = priceDrafts[licenseTypeId] ?? { amount: "", effectiveFrom: "" };
    if (!draft.amount.trim()) {
      setErrorMessage(t("priceAmountRequiredError"));
      return;
    }
    const currentPrice = pricesByLicenseType[licenseTypeId]?.[0] ?? null;
    setErrorMessage(null);
    setSuccessMessage(null);
    setSavingPriceByType((previous) => ({
      ...previous,
      [licenseTypeId]: true,
    }));
    try {
      await createLicensePrice({
        license_type: licenseTypeId,
        amount: draft.amount,
        currency: currentPrice?.currency ?? "EUR",
        effective_from: draft.effectiveFrom || undefined,
      });
      updatePriceDraft(licenseTypeId, { amount: "", effectiveFrom: "" });
      setSuccessMessage(t("priceSaved"));
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("priceSaveError"));
    } finally {
      setSavingPriceByType((previous) => ({
        ...previous,
        [licenseTypeId]: false,
      }));
    }
  };

  const pricesByFeeType = useMemo(() => {
    const grouped: Record<number, ClubFeePrice[]> = {};
    clubFeeTypes.forEach((feeType) => {
      grouped[feeType.id] = [];
    });
    clubFeePrices.forEach((price) => {
      if (!grouped[price.fee_type]) {
        grouped[price.fee_type] = [];
      }
      grouped[price.fee_type].push(price);
    });
    Object.keys(grouped).forEach((feeTypeId) => {
      grouped[Number(feeTypeId)].sort((left, right) => {
        const byEffectiveDate = right.effective_from.localeCompare(left.effective_from);
        if (byEffectiveDate !== 0) {
          return byEffectiveDate;
        }
        return right.created_at.localeCompare(left.created_at);
      });
    });
    return grouped;
  }, [clubFeePrices, clubFeeTypes]);

  const cadenceLabel = (cadence: ClubFeeCadence) => {
    if (cadence === "annual") {
      return t("clubFeeCadenceAnnual");
    }
    if (cadence === "per_member") {
      return t("clubFeeCadencePerMember");
    }
    if (cadence === "per_event") {
      return t("clubFeeCadencePerEvent");
    }
    return t("clubFeeCadenceOneOff");
  };

  const updateFeePriceDraft = (feeTypeId: number, patch: Partial<PriceDraft>) => {
    setFeePriceDrafts((previous) => ({
      ...previous,
      [feeTypeId]: {
        amount: previous[feeTypeId]?.amount ?? "",
        effectiveFrom: previous[feeTypeId]?.effectiveFrom ?? "",
        ...patch,
      },
    }));
  };

  const createFee = async () => {
    if (!newFeeName.trim()) {
      setErrorMessage(t("clubFeeNameRequiredError"));
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsCreatingFee(true);
    try {
      await createClubFeeType({
        name: newFeeName.trim(),
        description: newFeeDescription.trim(),
        cadence: newFeeCadence,
        is_active: newFeeActive,
        initial_amount: newFeeAmount.trim() || undefined,
        initial_currency: "EUR",
      });
      setNewFeeName("");
      setNewFeeDescription("");
      setNewFeeCadence("one_off");
      setNewFeeAmount("");
      setNewFeeActive(true);
      setSuccessMessage(t("clubFeeCreatedMessage"));
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("clubFeeCreateError"));
    } finally {
      setIsCreatingFee(false);
    }
  };

  const saveFeePrice = async (feeTypeId: number) => {
    const draft = feePriceDrafts[feeTypeId] ?? { amount: "", effectiveFrom: "" };
    if (!draft.amount.trim()) {
      setErrorMessage(t("priceAmountRequiredError"));
      return;
    }
    const currentPrice = pricesByFeeType[feeTypeId]?.[0] ?? null;
    setErrorMessage(null);
    setSuccessMessage(null);
    setSavingFeePriceByType((previous) => ({ ...previous, [feeTypeId]: true }));
    try {
      await createClubFeePrice({
        fee_type: feeTypeId,
        amount: draft.amount,
        currency: currentPrice?.currency ?? "EUR",
        effective_from: draft.effectiveFrom || undefined,
      });
      updateFeePriceDraft(feeTypeId, { amount: "", effectiveFrom: "" });
      setSuccessMessage(t("clubFeePriceSaved"));
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("clubFeePriceSaveError"));
    } finally {
      setSavingFeePriceByType((previous) => ({ ...previous, [feeTypeId]: false }));
    }
  };

  const confirmDelete = async () => {
    if (licenseTypeToDelete) {
      await confirmDeleteType();
      return;
    }
    if (!feeTypeToDelete) {
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteClubFeeType(feeTypeToDelete.id);
      setIsDeleteOpen(false);
      setFeeTypeToDelete(null);
      setSuccessMessage(t("clubFeeDeletedMessage"));
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("clubFeeDeleteError"));
    }
  };

  const toggleFeeId = (feeId: number) => {
    setSelectedFeeIds((current) =>
      current.includes(feeId) ? current.filter((id) => id !== feeId) : [...current, feeId]
    );
  };

  const toggleClubId = (clubId: number) => {
    setSelectedClubIds((current) =>
      current.includes(clubId) ? current.filter((id) => id !== clubId) : [...current, clubId]
    );
  };

  const submitBilling = async () => {
    if (selectedFeeIds.length === 0) {
      setErrorMessage(t("clubFeeBillingNoFees"));
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsBilling(true);
    try {
      const result = await createClubFeeBilling({
        fee_type_ids: selectedFeeIds,
        club_ids: billAllActiveClubs ? undefined : selectedClubIds,
        billed_on: billingDate,
        recurring: billingRecurring,
        recurrence: billingRecurring ? billingRecurrence : null,
      });
      setSuccessMessage(t("clubFeeBillingSuccess", { count: result.invoice_count }));
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("clubFeeBillingError"));
    } finally {
      setIsBilling(false);
    }
  };

  const toggleClubActive = async (club: Club, nextActive: boolean) => {
    setErrorMessage(null);
    try {
      const updated = await updateClub(club.id, { is_active: nextActive });
      setClubs((current) => current.map((item) => (item.id === club.id ? { ...item, ...updated } : item)));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("clubFeeBillingError"));
    }
  };

  const toggleSchedule = async (schedule: ClubFeeBillingSchedule) => {
    setErrorMessage(null);
    try {
      await updateClubFeeBillingSchedule(schedule.id, { is_active: !schedule.is_active });
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("clubFeeBillingError"));
    }
  };

  return (
    <LtfFinanceLayout title={t("licenseSettingsTitle")} subtitle={t("licenseSettingsSubtitle")}>
      <ActionNotices error={errorMessage} success={successMessage} onDismiss={() => { setErrorMessage(null); setSuccessMessage(null); }} />
      {missingPriceIssue ? (
        <PageNotice tone="info">{t("missingActivePriceFilterMessage")}</PageNotice>
      ) : null}

      <UnderlineTabs
        idPrefix="finance-settings"
        ariaLabel={t("settingsTabsAriaLabel")}
        value={activeTab}
        onChange={setActiveTab}
        options={[
          { value: "license-types", label: t("settingsTabLicenseTypes"), icon: IdCard },
          { value: "license-prices", label: t("settingsTabLicensePrices"), icon: CircleDollarSign },
          { value: "club-fees", label: t("settingsTabClubFees"), icon: Receipt },
          { value: "billing", label: t("settingsTabBilling"), icon: ScrollText },
        ]}
      />

      {activeTab === "license-types" ? (
      <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <ListToolbarPanel
          search={
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchLicenseTypesPlaceholder")}
              aria-label={t("searchLicenseTypesPlaceholder")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          }
        />
        <ListActionsRow
          actions={
            <Button
              variant="primary"
              onClick={() => router.push(`/${locale}/dashboard/ltf-finance/license-settings/new`)}
            >
              {t("createLicenseType")}
            </Button>
          }
        />
      </div>

      <div>
        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : filteredLicenseTypes.length === 0 ? (
          <EmptyState title={t("noLicenseTypesTitle")} description={t("noLicenseTypesSubtitle")} />
        ) : (
          <EntityTable
            columns={[
              { key: "name", header: t("licenseTypeNameLabel") },
              { key: "code", header: t("licenseTypeCodeLabel") },
              {
                key: "current_window",
                header: t("currentYearWindowLabel"),
                render: (licenseType: FinanceLicenseType) =>
                  licenseType.policy?.allow_current_year_order
                    ? formatWindow(
                        licenseType.policy.current_start_month,
                        licenseType.policy.current_start_day,
                        licenseType.policy.current_end_month,
                        licenseType.policy.current_end_day
                      )
                    : t("windowDisabledLabel"),
              },
              {
                key: "next_window",
                header: t("nextYearWindowLabel"),
                render: (licenseType: FinanceLicenseType) =>
                  licenseType.policy?.allow_next_year_preorder
                    ? formatWindow(
                        licenseType.policy.next_start_month,
                        licenseType.policy.next_start_day,
                        licenseType.policy.next_end_month,
                        licenseType.policy.next_end_day
                      )
                    : t("windowDisabledLabel"),
              },
              {
                key: "actions",
                header: t("actionLabel"),
                render: (licenseType: FinanceLicenseType) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={t("deleteAction")}
                      onClick={() => openDeleteTypeModal(licenseType)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={filteredLicenseTypes}
            onRowClick={(row) =>
              router.push(`/${locale}/dashboard/ltf-finance/license-settings/${row.id}`)
            }
          />
        )}
      </div>
      </div>
      ) : null}

      {activeTab === "license-prices" ? (
      <FormPanel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-section text-foreground">{t("priceHistoryTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("priceModalSubtitle")}</p>
          </div>
        </div>

        {licenseTypes.length === 0 ? (
          <EmptyState title={t("priceHistoryEmptyTitle")} description={t("priceHistoryEmptySubtitle")} />
        ) : (
          <div className="space-y-5">
            {licenseTypes.map((licenseType) => {
              const rows = pricesByLicenseType[licenseType.id] ?? [];
              const draft = priceDrafts[licenseType.id] ?? { amount: "", effectiveFrom: "" };
              const currentPrice = rows[0] ?? null;
              const isSavingPrice = Boolean(savingPriceByType[licenseType.id]);
              return (
                <article key={licenseType.id} className="overflow-hidden rounded-[var(--radius-card)] border border-border">
                  <div className="space-y-1 border-b border-border bg-secondary px-4 py-3">
                    <h3 className="text-sm font-semibold text-foreground">{licenseType.name}</h3>
                    <p className="text-xs text-muted">
                      {currentPrice
                        ? `${t("licensePriceLabel")}: ${currentPrice.amount} ${currentPrice.currency}`
                        : t("noPriceLabel")}
                    </p>
                  </div>
                  {rows.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">{t("priceHistoryEmptySubtitle")}</p>
                  ) : (
                    <EntityTable
                      columns={[
                        {
                          key: "amount",
                          header: t("priceAmountLabel"),
                          render: (row: LicensePrice) => `${row.amount} ${row.currency}`,
                        },
                        {
                          key: "effective_from",
                          header: t("priceEffectiveFromLabel"),
                          render: (row: LicensePrice) => formatDisplayDate(row.effective_from),
                        },
                        {
                          key: "created_at",
                          header: t("createdAtLabel"),
                          render: (row: LicensePrice) => formatDisplayDateTime(row.created_at),
                        },
                      ]}
                      rows={rows}
                    />
                  )}
                  <div className="border-t border-border bg-secondary px-4 py-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-foreground">{t("priceAmountLabel")}</label>
                        <Input
                          value={draft.amount}
                          onChange={(event) =>
                            updatePriceDraft(licenseType.id, { amount: event.target.value })
                          }
                          placeholder="30.00"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-foreground">
                          {t("priceEffectiveFromLabel")}
                        </label>
                        <Input
                          type="date"
                          value={draft.effectiveFrom}
                          onChange={(event) =>
                            updatePriceDraft(licenseType.id, { effectiveFrom: event.target.value })
                          }
                        />
                        <p className="text-xs text-muted">{t("priceEffectiveFromHint")}</p>
                      </div>
                      <div className="flex items-end">
                        <Button onClick={() => savePrice(licenseType.id)} disabled={isSavingPrice}>
                          {isSavingPrice ? t("priceSaving") : t("priceSaveButton")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </FormPanel>
      ) : null}

      {activeTab === "club-fees" ? (
        <div className="space-y-6">
          <FormPanel>
            <h2 className="text-section text-foreground">{t("clubFeesTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("clubFeesSubtitle")}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="club-fee-name">{t("clubFeeNameLabel")}</Label>
                <Input
                  id="club-fee-name"
                  value={newFeeName}
                  onChange={(event) => setNewFeeName(event.target.value)}
                  placeholder={t("clubFeeNameLabel")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("clubFeeCadenceLabel")}</Label>
                <Select
                  value={newFeeCadence}
                  onValueChange={(value) => setNewFeeCadence(value as ClubFeeCadence)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_off">{t("clubFeeCadenceOneOff")}</SelectItem>
                    <SelectItem value="annual">{t("clubFeeCadenceAnnual")}</SelectItem>
                    <SelectItem value="per_member">{t("clubFeeCadencePerMember")}</SelectItem>
                    <SelectItem value="per_event">{t("clubFeeCadencePerEvent")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="club-fee-amount">{t("clubFeeAmountLabel")}</Label>
                <Input
                  id="club-fee-amount"
                  value={newFeeAmount}
                  onChange={(event) => setNewFeeAmount(event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="club-fee-description">{t("clubFeeDescriptionLabel")}</Label>
                <Input
                  id="club-fee-description"
                  value={newFeeDescription}
                  onChange={(event) => setNewFeeDescription(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <Checkbox
                  id="club-fee-active"
                  checked={newFeeActive}
                  onCheckedChange={(value) => setNewFeeActive(Boolean(value))}
                />
                <Label htmlFor="club-fee-active">{t("clubFeeActiveLabel")}</Label>
              </div>
            </div>
            <div className="mt-4">
              <Button onClick={() => void createFee()} disabled={isCreatingFee}>
                {t("clubFeeCreateAction")}
              </Button>
            </div>
          </FormPanel>

          {clubFeeTypes.length === 0 ? (
            <EmptyState title={t("clubFeeEmptyTitle")} description={t("clubFeeEmptySubtitle")} />
          ) : (
            <div className="space-y-5">
              {clubFeeTypes.map((feeType) => {
                const rows = pricesByFeeType[feeType.id] ?? [];
                const draft = feePriceDrafts[feeType.id] ?? { amount: "", effectiveFrom: "" };
                const isSavingFeePrice = Boolean(savingFeePriceByType[feeType.id]);
                return (
                  <article
                    key={feeType.id}
                    className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-secondary px-4 py-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">{feeType.name}</h3>
                        <p className="text-xs text-muted">
                          {cadenceLabel(feeType.cadence)}
                          {" · "}
                          {feeType.current_amount
                            ? `${feeType.current_amount} ${feeType.current_currency ?? "EUR"}`
                            : t("clubFeeNoAmountLabel")}
                          {feeType.is_active ? "" : ` · ${t("clubFeeInactiveLabel")}`}
                        </p>
                        {feeType.description ? (
                          <p className="text-xs text-muted">{feeType.description}</p>
                        ) : null}
                      </div>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        aria-label={t("deleteAction")}
                        onClick={() => {
                          setFeeTypeToDelete(feeType);
                          setLicenseTypeToDelete(null);
                          setIsDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {rows.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-muted">{t("priceHistoryEmptySubtitle")}</p>
                    ) : (
                      <EntityTable
                        columns={[
                          {
                            key: "amount",
                            header: t("clubFeeAmountLabel"),
                            render: (row: ClubFeePrice) => `${row.amount} ${row.currency}`,
                          },
                          {
                            key: "effective_from",
                            header: t("priceEffectiveFromLabel"),
                            render: (row: ClubFeePrice) => formatDisplayDate(row.effective_from),
                          },
                          {
                            key: "created_at",
                            header: t("createdAtLabel"),
                            render: (row: ClubFeePrice) => formatDisplayDateTime(row.created_at),
                          },
                        ]}
                        rows={rows}
                      />
                    )}
                    <div className="border-t border-border bg-secondary px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-foreground">
                            {t("clubFeeAmountLabel")}
                          </label>
                          <Input
                            value={draft.amount}
                            onChange={(event) =>
                              updateFeePriceDraft(feeType.id, { amount: event.target.value })
                            }
                            placeholder="0.00"
                            inputMode="decimal"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-foreground">
                            {t("priceEffectiveFromLabel")}
                          </label>
                          <Input
                            type="date"
                            value={draft.effectiveFrom}
                            onChange={(event) =>
                              updateFeePriceDraft(feeType.id, { effectiveFrom: event.target.value })
                            }
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            onClick={() => void saveFeePrice(feeType.id)}
                            disabled={isSavingFeePrice}
                          >
                            {isSavingFeePrice ? t("priceSaving") : t("priceSaveButton")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "billing" ? (
        <div className="space-y-6">
          <FormPanel>
            <h2 className="text-section text-foreground">{t("clubFeeBillingTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("clubFeeBillingSubtitle")}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="billing-date">{t("clubFeeBillingDateLabel")}</Label>
                <Input
                  id="billing-date"
                  type="date"
                  value={billingDate}
                  onChange={(event) => setBillingDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 pt-7">
                  <Checkbox
                    id="billing-recurring"
                    checked={billingRecurring}
                    onCheckedChange={(value) => setBillingRecurring(Boolean(value))}
                  />
                  <Label htmlFor="billing-recurring">{t("clubFeeBillingRecurringLabel")}</Label>
                </div>
                {billingRecurring ? (
                  <Select
                    value={billingRecurrence}
                    onValueChange={(value) => setBillingRecurrence(value as "monthly" | "annual")}
                  >
                    <SelectTrigger aria-label={t("clubFeeBillingRecurrenceLabel")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">{t("clubFeeBillingRecurrenceMonthly")}</SelectItem>
                      <SelectItem value="annual">{t("clubFeeBillingRecurrenceAnnual")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-foreground">{t("clubFeeBillingFeesLabel")}</p>
              {clubFeeTypes.filter((fee) => fee.is_active && fee.current_amount).length === 0 ? (
                <p className="text-sm text-muted">{t("clubFeeEmptySubtitle")}</p>
              ) : (
                clubFeeTypes
                  .filter((fee) => fee.is_active)
                  .map((fee) => (
                    <label key={fee.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedFeeIds.includes(fee.id)}
                        onCheckedChange={() => toggleFeeId(fee.id)}
                      />
                      <span>
                        {fee.name}
                        {fee.current_amount
                          ? ` · ${fee.current_amount} ${fee.current_currency ?? "EUR"}`
                          : ` · ${t("clubFeeNoAmountLabel")}`}
                      </span>
                    </label>
                  ))
              )}
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-foreground">{t("clubFeeBillingClubsLabel")}</p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={billAllActiveClubs}
                  onCheckedChange={(value) => setBillAllActiveClubs(Boolean(value))}
                />
                {t("clubFeeBillingAllActiveClubs")}
              </label>
              {!billAllActiveClubs
                ? clubs.map((club) => (
                    <label key={club.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedClubIds.includes(club.id)}
                        onCheckedChange={() => toggleClubId(club.id)}
                      />
                      <span>
                        {club.name}
                        {" · "}
                        {club.is_active ? t("clubStatusActive") : t("clubStatusInactive")}
                      </span>
                    </label>
                  ))
                : null}
            </div>
            <div className="mt-4">
              <Button onClick={() => void submitBilling()} disabled={isBilling}>
                {t("clubFeeBillingSubmit")}
              </Button>
            </div>
          </FormPanel>

          <FormPanel>
            <h2 className="text-section text-foreground">{t("clubFeeBillingClubsLabel")}</h2>
            <p className="mt-1 text-sm text-muted">{t("clubStatusHint")}</p>
            <div className="mt-4 space-y-2">
              {clubs.map((club) => (
                <div key={club.id} className="flex items-center justify-between gap-3 border-b border-border py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{club.name}</p>
                    <StatusBadge
                      label={club.is_active ? t("clubStatusActive") : t("clubStatusInactive")}
                      tone={club.is_active ? "success" : "neutral"}
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void toggleClubActive(club, !club.is_active)}
                  >
                    {club.is_active ? t("clubStatusInactive") : t("clubStatusActive")}
                  </Button>
                </div>
              ))}
            </div>
          </FormPanel>

          <FormPanel>
            <h2 className="text-section text-foreground">{t("clubFeeSchedulesTitle")}</h2>
            {schedules.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t("clubFeeSchedulesEmpty")}</p>
            ) : (
              <div className="mt-3 space-y-2">
                {schedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{schedule.fee_type_name}</p>
                      <p className="text-xs text-muted">
                        {schedule.recurrence === "monthly"
                          ? t("clubFeeBillingRecurrenceMonthly")
                          : t("clubFeeBillingRecurrenceAnnual")}
                        {" · "}
                        {t("clubFeeScheduleNextLabel")}: {formatDisplayDate(schedule.next_run_on)}
                      </p>
                    </div>
                    <Button variant="outline" onClick={() => void toggleSchedule(schedule)}>
                      {schedule.is_active ? t("clubFeeSchedulePause") : t("clubFeeScheduleResume")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </FormPanel>
        </div>
      ) : null}

      <DeleteConfirmModal
        isOpen={isDeleteOpen}
        title={common("deleteTitle", {
          item: feeTypeToDelete ? t("clubFeesTitle") : t("licenseTypeLabel"),
        })}
        description={common("deleteDescriptionWithName", {
          name: feeTypeToDelete?.name ?? licenseTypeToDelete?.name ?? "",
        })}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => {
          setIsDeleteOpen(false);
          setLicenseTypeToDelete(null);
          setFeeTypeToDelete(null);
        }}
      />
    </LtfFinanceLayout>
  );
}
