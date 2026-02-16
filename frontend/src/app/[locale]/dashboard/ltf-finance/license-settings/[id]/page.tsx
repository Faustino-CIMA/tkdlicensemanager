"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
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
  FinanceLicenseType,
  LicenseTypePolicy,
  getFinanceLicenseTypePolicy,
  getFinanceLicenseTypes,
  updateFinanceLicenseType,
  updateFinanceLicenseTypePolicy,
} from "@/lib/ltf-finance-api";

type PolicyFormState = {
  allow_current_year_order: boolean;
  current_start_month: number;
  current_start_day: number;
  current_end_month: number;
  current_end_day: number;
  allow_next_year_preorder: boolean;
  next_start_month: number;
  next_start_day: number;
  next_end_month: number;
  next_end_day: number;
};

const DEFAULT_POLICY: PolicyFormState = {
  allow_current_year_order: true,
  current_start_month: 1,
  current_start_day: 1,
  current_end_month: 12,
  current_end_day: 31,
  allow_next_year_preorder: false,
  next_start_month: 12,
  next_start_day: 1,
  next_end_month: 12,
  next_end_day: 31,
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);

function toPolicyForm(policy?: LicenseTypePolicy): PolicyFormState {
  if (!policy) {
    return { ...DEFAULT_POLICY };
  }
  return {
    allow_current_year_order: policy.allow_current_year_order,
    current_start_month: policy.current_start_month,
    current_start_day: policy.current_start_day,
    current_end_month: policy.current_end_month,
    current_end_day: policy.current_end_day,
    allow_next_year_preorder: policy.allow_next_year_preorder,
    next_start_month: policy.next_start_month,
    next_start_day: policy.next_start_day,
    next_end_month: policy.next_end_month,
    next_end_day: policy.next_end_day,
  };
}

function getMaxDaysInMonth(month: number) {
  return new Date(2024, month, 0).getDate();
}

function getDayOptions(month: number) {
  return Array.from({ length: getMaxDaysInMonth(month) }, (_, index) => index + 1);
}

export default function LtfFinanceLicenseTypeDetailPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const params = useParams();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [licenseType, setLicenseType] = useState<FinanceLicenseType | null>(null);
  const [licenseTypeName, setLicenseTypeName] = useState("");
  const [policyForm, setPolicyForm] = useState<PolicyFormState>({ ...DEFAULT_POLICY });

  const licenseTypeId = useMemo(() => {
    const rawId = params?.id;
    if (Array.isArray(rawId)) {
      return Number(rawId[0]);
    }
    return Number(rawId);
  }, [params]);

  const loadData = useCallback(async () => {
    if (!licenseTypeId || Number.isNaN(licenseTypeId)) {
      setLicenseType(null);
      setErrorMessage(t("licenseTypeNotFoundSubtitle"));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [licenseTypesResponse, policyResponse] = await Promise.all([
        getFinanceLicenseTypes(),
        getFinanceLicenseTypePolicy(licenseTypeId),
      ]);
      const matchedLicenseType = licenseTypesResponse.find((row) => row.id === licenseTypeId);
      if (!matchedLicenseType) {
        setLicenseType(null);
        setErrorMessage(t("licenseTypeNotFoundSubtitle"));
        return;
      }
      setLicenseType({
        ...matchedLicenseType,
        policy: policyResponse,
      });
      setLicenseTypeName(matchedLicenseType.name);
      setPolicyForm(toPolicyForm(policyResponse));
    } catch (error) {
      setLicenseType(null);
      setErrorMessage(error instanceof Error ? error.message : t("licenseSettingsLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [licenseTypeId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const currentStartDayOptions = useMemo(
    () => getDayOptions(policyForm.current_start_month),
    [policyForm.current_start_month]
  );
  const currentEndDayOptions = useMemo(
    () => getDayOptions(policyForm.current_end_month),
    [policyForm.current_end_month]
  );
  const nextStartDayOptions = useMemo(
    () => getDayOptions(policyForm.next_start_month),
    [policyForm.next_start_month]
  );
  const nextEndDayOptions = useMemo(
    () => getDayOptions(policyForm.next_end_month),
    [policyForm.next_end_month]
  );
  const localizedMonthOptions = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: "long" });
    return MONTH_OPTIONS.map((month) => ({
      value: String(month),
      label: formatter.format(new Date(2024, month - 1, 1)),
    }));
  }, [locale]);

  const updateCurrentStartMonth = (value: string) => {
    const month = Number(value);
    setPolicyForm((previous) => ({
      ...previous,
      current_start_month: month,
      current_start_day: Math.min(previous.current_start_day, getMaxDaysInMonth(month)),
    }));
  };

  const updateCurrentEndMonth = (value: string) => {
    const month = Number(value);
    setPolicyForm((previous) => ({
      ...previous,
      current_end_month: month,
      current_end_day: Math.min(previous.current_end_day, getMaxDaysInMonth(month)),
    }));
  };

  const updateNextStartMonth = (value: string) => {
    const month = Number(value);
    setPolicyForm((previous) => ({
      ...previous,
      next_start_month: month,
      next_start_day: Math.min(previous.next_start_day, getMaxDaysInMonth(month)),
    }));
  };

  const updateNextEndMonth = (value: string) => {
    const month = Number(value);
    setPolicyForm((previous) => ({
      ...previous,
      next_end_month: month,
      next_end_day: Math.min(previous.next_end_day, getMaxDaysInMonth(month)),
    }));
  };

  const saveChanges = async () => {
    if (!licenseType || !licenseTypeId || Number.isNaN(licenseTypeId)) {
      return;
    }
    const trimmedName = licenseTypeName.trim();
    if (!trimmedName) {
      setErrorMessage(t("licenseTypeNameRequiredError"));
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSaving(true);
    try {
      await Promise.all([
        updateFinanceLicenseType(licenseTypeId, { name: trimmedName }),
        updateFinanceLicenseTypePolicy(licenseTypeId, policyForm),
      ]);
      setSuccessMessage(t("licenseTypeDetailSavedMessage"));
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("licenseTypeSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <LtfFinanceLayout title={t("licenseSettingsTitle")} subtitle={t("licenseTypeDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </LtfFinanceLayout>
    );
  }

  if (!licenseType) {
    return (
      <LtfFinanceLayout title={t("licenseSettingsTitle")} subtitle={t("licenseTypeDetailSubtitle")}>
        <div className="mb-6">
          <Button asChild variant="outline">
            <Link href={`/${locale}/dashboard/ltf-finance/license-settings`}>
              {t("backToLicenseSettings")}
            </Link>
          </Button>
        </div>
        <EmptyState
          title={t("licenseTypeNotFoundTitle")}
          description={errorMessage ?? t("licenseTypeNotFoundSubtitle")}
        />
      </LtfFinanceLayout>
    );
  }

  return (
    <LtfFinanceLayout title={licenseType.name} subtitle={t("licenseTypeDetailSubtitle")}>
      <div className="mb-6">
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard/ltf-finance/license-settings`}>
            {t("backToLicenseSettings")}
          </Link>
        </Button>
      </div>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

      <section className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">{t("licenseTypeLabel")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("licenseTypeNameLabel")}</label>
            <Input
              value={licenseTypeName}
              onChange={(event) => setLicenseTypeName(event.target.value)}
              placeholder={t("licenseTypeNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("licenseTypeCodeLabel")}</label>
            <Input value={licenseType.code} disabled />
          </div>
        </div>
      </section>

      <section className="space-y-5 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">{t("editPolicyAction")}</h2>

        <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              type="checkbox"
              checked={policyForm.allow_current_year_order}
              onChange={(event) =>
                setPolicyForm((previous) => ({
                  ...previous,
                  allow_current_year_order: event.target.checked,
                }))
              }
            />
            {t("allowCurrentYearOrderingLabel")}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-600">{t("windowStartLabel")}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={String(policyForm.current_start_month)}
                  onValueChange={updateCurrentStartMonth}
                  disabled={!policyForm.allow_current_year_order}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("monthLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {localizedMonthOptions.map((monthOption) => (
                      <SelectItem key={monthOption.value} value={monthOption.value}>
                        {monthOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(policyForm.current_start_day)}
                  onValueChange={(value) =>
                    setPolicyForm((previous) => ({
                      ...previous,
                      current_start_day: Number(value),
                    }))
                  }
                  disabled={!policyForm.allow_current_year_order}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("dayLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {currentStartDayOptions.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {String(day).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-600">{t("windowEndLabel")}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={String(policyForm.current_end_month)}
                  onValueChange={updateCurrentEndMonth}
                  disabled={!policyForm.allow_current_year_order}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("monthLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {localizedMonthOptions.map((monthOption) => (
                      <SelectItem key={monthOption.value} value={monthOption.value}>
                        {monthOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(policyForm.current_end_day)}
                  onValueChange={(value) =>
                    setPolicyForm((previous) => ({
                      ...previous,
                      current_end_day: Number(value),
                    }))
                  }
                  disabled={!policyForm.allow_current_year_order}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("dayLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {currentEndDayOptions.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {String(day).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              type="checkbox"
              checked={policyForm.allow_next_year_preorder}
              onChange={(event) =>
                setPolicyForm((previous) => ({
                  ...previous,
                  allow_next_year_preorder: event.target.checked,
                }))
              }
            />
            {t("allowNextYearPreorderLabel")}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-600">{t("windowStartLabel")}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={String(policyForm.next_start_month)}
                  onValueChange={updateNextStartMonth}
                  disabled={!policyForm.allow_next_year_preorder}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("monthLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {localizedMonthOptions.map((monthOption) => (
                      <SelectItem key={monthOption.value} value={monthOption.value}>
                        {monthOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(policyForm.next_start_day)}
                  onValueChange={(value) =>
                    setPolicyForm((previous) => ({
                      ...previous,
                      next_start_day: Number(value),
                    }))
                  }
                  disabled={!policyForm.allow_next_year_preorder}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("dayLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {nextStartDayOptions.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {String(day).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-600">{t("windowEndLabel")}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={String(policyForm.next_end_month)}
                  onValueChange={updateNextEndMonth}
                  disabled={!policyForm.allow_next_year_preorder}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("monthLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {localizedMonthOptions.map((monthOption) => (
                      <SelectItem key={monthOption.value} value={monthOption.value}>
                        {monthOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(policyForm.next_end_day)}
                  onValueChange={(value) =>
                    setPolicyForm((previous) => ({
                      ...previous,
                      next_end_day: Number(value),
                    }))
                  }
                  disabled={!policyForm.allow_next_year_preorder}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("dayLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {nextEndDayOptions.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {String(day).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <Button onClick={saveChanges} disabled={isSaving}>
            {isSaving ? t("savingAction") : t("saveTypePolicyButton")}
          </Button>
          <Button asChild variant="outline">
            <Link href={`/${locale}/dashboard/ltf-finance/license-settings`}>
              {common("deleteCancelButton")}
            </Link>
          </Button>
        </div>
      </section>
    </LtfFinanceLayout>
  );
}
