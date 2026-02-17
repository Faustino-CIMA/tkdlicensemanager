"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Input } from "@/components/ui/input";
import {
  FinanceLicenseType,
  LicensePrice,
  createLicensePrice,
  deleteFinanceLicenseType,
  getFinanceLicenseTypes,
  getLicensePrices,
} from "@/lib/ltf-finance-api";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-display";

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
  const [licenseTypes, setLicenseTypes] = useState<FinanceLicenseType[]>([]);
  const [prices, setPrices] = useState<LicensePrice[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [licenseTypeToDelete, setLicenseTypeToDelete] = useState<FinanceLicenseType | null>(null);

  const [priceDrafts, setPriceDrafts] = useState<Record<number, PriceDraft>>({});
  const [savingPriceByType, setSavingPriceByType] = useState<Record<number, boolean>>({});

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [licenseTypesResponse, pricesResponse] = await Promise.all([
        getFinanceLicenseTypes(),
        getLicensePrices(),
      ]);
      setLicenseTypes(licenseTypesResponse);
      setPrices(pricesResponse);
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
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      return licenseTypes;
    }
    return licenseTypes.filter((licenseType) => {
      return (
        licenseType.name.toLowerCase().includes(normalized) ||
        licenseType.code.toLowerCase().includes(normalized)
      );
    });
  }, [licenseTypes, searchQuery]);

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

  return (
    <LtfFinanceLayout title={t("licenseSettingsTitle")} subtitle={t("licenseSettingsSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

      <section className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchLicenseTypesPlaceholder")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <Button
              onClick={() => router.push(`/${locale}/dashboard/ltf-finance/license-settings/new`)}
            >
              {t("createLicenseType")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
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
      </section>

      <section className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{t("priceHistoryTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-600">{t("priceModalSubtitle")}</p>
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
                <article key={licenseType.id} className="overflow-hidden rounded-2xl border border-zinc-200">
                  <div className="space-y-1 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                    <h3 className="text-sm font-semibold text-zinc-900">{licenseType.name}</h3>
                    <p className="text-xs text-zinc-600">
                      {currentPrice
                        ? `${t("licensePriceLabel")}: ${currentPrice.amount} ${currentPrice.currency}`
                        : t("noPriceLabel")}
                    </p>
                  </div>
                  {rows.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-zinc-600">{t("priceHistoryEmptySubtitle")}</p>
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
                  <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-zinc-700">{t("priceAmountLabel")}</label>
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
                        <label className="text-xs font-medium text-zinc-700">
                          {t("priceEffectiveFromLabel")}
                        </label>
                        <Input
                          type="date"
                          value={draft.effectiveFrom}
                          onChange={(event) =>
                            updatePriceDraft(licenseType.id, { effectiveFrom: event.target.value })
                          }
                        />
                        <p className="text-xs text-zinc-500">{t("priceEffectiveFromHint")}</p>
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
      </section>

      <DeleteConfirmModal
        isOpen={isDeleteOpen}
        title={common("deleteTitle", { item: t("licenseTypeLabel") })}
        description={common("deleteDescriptionWithName", {
          name: licenseTypeToDelete?.name ?? "",
        })}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={confirmDeleteType}
        onCancel={() => {
          setIsDeleteOpen(false);
          setLicenseTypeToDelete(null);
        }}
      />
    </LtfFinanceLayout>
  );
}
