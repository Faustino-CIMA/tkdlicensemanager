"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppTextarea, FormPanel, PageNotice } from "@/components/ui/list-page-chrome";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FinanceReportResponse,
  downloadFinanceReportExcel,
  getFinanceReport,
  saveFinanceYearOpening,
} from "@/lib/ltf-finance-api";
import { formatDisplayDate } from "@/lib/date-display";

function yearOptions(currentYear: number) {
  return [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
}

function moneyLabel(amount: string, currency: string) {
  return `${amount} ${currency}`;
}

export default function LtfFinanceReportsPage() {
  const t = useTranslations("LtfFinance");
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [report, setReport] = useState<FinanceReportResponse | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingOpening, setIsSavingOpening] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await getFinanceReport(Number(year));
      setReport(response);
      setOpeningCash(response.opening.cash);
      setOpeningNotes(response.opening.notes);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("reportsLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t, year]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleSaveOpening = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingOpening(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await saveFinanceYearOpening({
        year: Number(year),
        opening_cash: openingCash.trim(),
        notes: openingNotes.trim() || undefined,
      });
      setSuccessMessage(t("openingCashSavedMessage"));
      await loadReport();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("openingCashSaveError"));
    } finally {
      setIsSavingOpening(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    try {
      await downloadFinanceReportExcel(Number(year));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("reportExportError"));
    } finally {
      setIsExporting(false);
    }
  };

  const years = useMemo(() => yearOptions(currentYear), [currentYear]);

  return (
    <LtfFinanceLayout title={t("reportsTitle")} subtitle={t("reportsSubtitle")}>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}
      {successMessage ? <PageNotice tone="success">{successMessage}</PageNotice> : null}

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t("reportYearLabel")}</label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[160px]" aria-label={t("reportYearLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => void handleExport()} disabled={isExporting || isLoading}>
          {isExporting ? t("reportExportingAction") : t("exportExcelAction")}
        </Button>
      </div>

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : !report ? (
        <EmptyState title={t("reportsEmptyTitle")} description={t("reportsEmptySubtitle")} />
      ) : (
        <>
          <PageNotice tone="info">
            {t("reportPeriodLabel", {
              start: formatDisplayDate(report.period_start),
              asOf: formatDisplayDate(report.as_of),
            })}{" "}
            {report.methodology}
          </PageNotice>

          <FormPanel>
            <h2 className="text-section text-foreground">{t("openingCashTitle")}</h2>
            <p className="mt-1 text-sm text-muted">
              {report.opening.is_manual ? t("openingCashManualHint") : t("openingCashComputedHint")}
            </p>
            <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={handleSaveOpening}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t("openingCashLabel")}</label>
                <Input
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-foreground">{t("openingCashNotesLabel")}</label>
                <AppTextarea
                  className="min-h-[2.75rem]"
                  value={openingNotes}
                  onChange={(event) => setOpeningNotes(event.target.value)}
                />
              </div>
              <div>
                <Button type="submit" disabled={isSavingOpening}>
                  {isSavingOpening ? t("savingAction") : t("saveOpeningCashAction")}
                </Button>
              </div>
            </form>
          </FormPanel>

          <div className="grid gap-6 lg:grid-cols-2">
            <FormPanel>
              <h2 className="text-section text-foreground">{t("incomeStatementTitle")}</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{t("licenseFeeIncomeLabel")}</dt>
                  <dd className="font-medium">
                    {moneyLabel(report.income_statement.revenue_license_fees, report.currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{t("operatingExpensesLabel")}</dt>
                  <dd className="font-medium">
                    {moneyLabel(report.income_statement.expenses_total, report.currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <dt className="font-semibold">{t("surplusLabel")}</dt>
                  <dd className="font-semibold">
                    {moneyLabel(report.income_statement.surplus, report.currency)}
                  </dd>
                </div>
              </dl>
            </FormPanel>

            <FormPanel>
              <h2 className="text-section text-foreground">{t("balanceSheetTitle")}</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{t("cashAndBankLabel")}</dt>
                  <dd className="font-medium">{moneyLabel(report.balance_sheet.assets.cash, report.currency)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{t("accountsReceivableLabel")}</dt>
                  <dd className="font-medium">
                    {moneyLabel(report.balance_sheet.assets.accounts_receivable, report.currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <dt className="font-semibold">{t("totalAssetsLabel")}</dt>
                  <dd className="font-semibold">{moneyLabel(report.balance_sheet.assets.total, report.currency)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 pt-2">
                  <dt className="text-muted">{t("accountsPayableLabel")}</dt>
                  <dd className="font-medium">
                    {moneyLabel(report.balance_sheet.liabilities.accounts_payable, report.currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <dt className="font-semibold">{t("netAssetsLabel")}</dt>
                  <dd className="font-semibold">
                    {moneyLabel(report.balance_sheet.equity.net_assets, report.currency)}
                  </dd>
                </div>
              </dl>
            </FormPanel>
          </div>

          <FormPanel>
            <h2 className="text-section text-foreground">{t("cashMovementTitle")}</h2>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-muted">{t("openingCashLabel")}</dt>
                <dd className="font-medium">{moneyLabel(report.cash_movement.opening_cash, report.currency)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("receiptsLabel")}</dt>
                <dd className="font-medium">{moneyLabel(report.cash_movement.receipts, report.currency)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("disbursementsLabel")}</dt>
                <dd className="font-medium">{moneyLabel(report.cash_movement.disbursements, report.currency)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("closingCashLabel")}</dt>
                <dd className="font-medium">{moneyLabel(report.cash_movement.closing_cash, report.currency)}</dd>
              </div>
            </dl>
          </FormPanel>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="text-section text-foreground">{t("incomeByClubTitle")}</h2>
              {report.income_statement.income_by_club.length === 0 ? (
                <p className="text-sm text-muted">{t("incomeByClubEmpty")}</p>
              ) : (
                <EntityTable
                  columns={[
                    {
                      key: "club_name",
                      header: t("clubLabel"),
                      render: (row: FinanceReportResponse["income_statement"]["income_by_club"][number]) =>
                        row.club_name || "-",
                    },
                    {
                      key: "amount",
                      header: t("expenseAmountLabel"),
                      render: (row: FinanceReportResponse["income_statement"]["income_by_club"][number]) =>
                        moneyLabel(row.amount, report.currency),
                    },
                  ]}
                  rows={report.income_statement.income_by_club.map((row, index) => ({
                    ...row,
                    id: row.club_id ?? index,
                  }))}
                />
              )}
            </section>
            <section className="space-y-3">
              <h2 className="text-section text-foreground">{t("expensesByCategoryTitle")}</h2>
              {report.income_statement.expenses_by_category.length === 0 ? (
                <p className="text-sm text-muted">{t("expensesByCategoryEmpty")}</p>
              ) : (
                <EntityTable
                  columns={[
                    {
                      key: "category_name",
                      header: t("expenseCategoryLabel"),
                      render: (
                        row: FinanceReportResponse["income_statement"]["expenses_by_category"][number]
                      ) => row.category_name || "-",
                    },
                    {
                      key: "amount",
                      header: t("expenseAmountLabel"),
                      render: (
                        row: FinanceReportResponse["income_statement"]["expenses_by_category"][number]
                      ) => moneyLabel(row.amount, report.currency),
                    },
                  ]}
                  rows={report.income_statement.expenses_by_category.map((row, index) => ({
                    ...row,
                    id: row.category_id ?? index,
                  }))}
                />
              )}
            </section>
          </div>
        </>
      )}
    </LtfFinanceLayout>
  );
}
