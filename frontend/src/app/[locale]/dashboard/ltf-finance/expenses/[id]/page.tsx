"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { EmptyState } from "@/components/club-admin/empty-state";
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
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Club,
  ExpenseCategory,
  FinanceExpense,
  getExpenseCategories,
  getFinanceClubs,
  getFinanceExpense,
  markFinanceExpensePaid,
  updateFinanceExpense,
  voidFinanceExpense,
} from "@/lib/ltf-finance-api";

export default function LtfFinanceExpenseDetailPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const params = useParams();
  const [expense, setExpense] = useState<FinanceExpense | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [clubId, setClubId] = useState("none");
  const [description, setDescription] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const expenseId = useMemo(() => {
    const rawId = params?.id;
    return Number(Array.isArray(rawId) ? rawId[0] : rawId);
  }, [params]);

  const applyExpense = (next: FinanceExpense) => {
    setExpense(next);
    setCategoryId(String(next.category));
    setClubId(next.club ? String(next.club) : "none");
    setDescription(next.description);
    setPayee(next.payee);
    setAmount(next.amount);
    setExpenseDate(next.expense_date);
    setPaymentMethod(next.payment_method || "bank_transfer");
    setReference(next.reference);
    setNotes(next.notes);
  };

  const loadData = useCallback(async () => {
    if (!expenseId || Number.isNaN(expenseId)) {
      setErrorMessage(t("expenseNotFoundSubtitle"));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [expenseResponse, categoryResponse, clubResponse] = await Promise.all([
        getFinanceExpense(expenseId),
        getExpenseCategories(),
        getFinanceClubs(),
      ]);
      applyExpense(expenseResponse);
      setCategories(categoryResponse);
      setClubs(clubResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("expensesLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [expenseId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const statusMeta = useMemo(() => {
    switch (expense?.status) {
      case "recorded":
        return { label: t("expenseStatusRecorded"), tone: "warning" as const };
      case "paid":
        return { label: common("statusPaid"), tone: "success" as const };
      case "void":
        return { label: common("statusVoid"), tone: "danger" as const };
      default:
        return { label: expense?.status ?? "-", tone: "neutral" as const };
    }
  }, [common, expense?.status, t]);

  const isLocked = expense?.status === "void";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!expense || isLocked) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updated = await updateFinanceExpense(expense.id, {
        category: Number(categoryId),
        club: clubId === "none" ? null : Number(clubId),
        description: description.trim(),
        payee: payee.trim(),
        amount: amount.trim(),
        expense_date: expenseDate,
        payment_method: paymentMethod,
        reference: reference.trim(),
        notes: notes.trim(),
      });
      applyExpense(updated);
      setSuccessMessage(t("expenseSavedMessage"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("expenseSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!expense) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updated = await markFinanceExpensePaid(expense.id, {
        payment_method: paymentMethod,
        reference: reference.trim() || undefined,
      });
      applyExpense(updated);
      setSuccessMessage(t("expenseMarkedPaidMessage"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("expenseSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleVoid = async () => {
    if (!expense) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updated = await voidFinanceExpense(expense.id);
      applyExpense(updated);
      setSuccessMessage(t("expenseVoidedMessage"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("expenseSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <LtfFinanceLayout title={t("expensesTitle")} subtitle={t("expenseDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </LtfFinanceLayout>
    );
  }

  if (!expense) {
    return (
      <LtfFinanceLayout title={t("expensesTitle")} subtitle={t("expenseDetailSubtitle")}>
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/${locale}/dashboard/ltf-finance/expenses`}>{t("backToExpenses")}</Link>
        </Button>
        <EmptyState title={t("expenseNotFoundTitle")} description={errorMessage ?? t("expenseNotFoundSubtitle")} />
      </LtfFinanceLayout>
    );
  }

  return (
    <LtfFinanceLayout title={expense.expense_number} subtitle={t("expenseDetailSubtitle")}>
      <Button asChild variant="outline" className="w-fit">
        <Link href={`/${locale}/dashboard/ltf-finance/expenses`}>{t("backToExpenses")}</Link>
      </Button>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}
      {successMessage ? <PageNotice tone="success">{successMessage}</PageNotice> : null}

      <FormPanel className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-section text-foreground">{t("expenseDetailSubtitle")}</h2>
          <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
        </div>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expenseDateLabel")}</label>
              <Input
                type="date"
                value={expenseDate}
                onChange={(event) => setExpenseDate(event.target.value)}
                disabled={isLocked}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expenseCategoryLabel")}</label>
              <Select value={categoryId} onValueChange={setCategoryId} disabled={isLocked}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={String(category.id)}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground">{t("expenseDescriptionLabel")}</label>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isLocked}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expensePayeeLabel")}</label>
              <Input value={payee} onChange={(event) => setPayee(event.target.value)} disabled={isLocked} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expenseAmountLabel")}</label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                disabled={isLocked || expense.status === "paid"}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("clubLabel")}</label>
              <Select value={clubId} onValueChange={setClubId} disabled={isLocked}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("expenseNoClubOption")}</SelectItem>
                  {clubs.map((club) => (
                    <SelectItem key={club.id} value={String(club.id)}>
                      {club.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expenseReferenceLabel")}</label>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} disabled={isLocked} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("paymentMethodLabel")}</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={isLocked}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">{t("paymentMethodBankTransfer")}</SelectItem>
                  <SelectItem value="card">{t("paymentMethodCard")}</SelectItem>
                  <SelectItem value="cash">{t("paymentMethodCash")}</SelectItem>
                  <SelectItem value="offline">{t("paymentMethodOffline")}</SelectItem>
                  <SelectItem value="other">{t("paymentMethodOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("paymentNotesLabel")}</label>
            <AppTextarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isLocked} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {expense.status !== "void" ? (
              <Button type="submit" disabled={isSaving}>
                {isSaving ? t("savingAction") : t("saveChanges")}
              </Button>
            ) : null}
            {expense.status === "recorded" ? (
              <Button type="button" variant="outline" onClick={() => void handleMarkPaid()} disabled={isSaving}>
                {t("markExpensePaidAction")}
              </Button>
            ) : null}
            {expense.status !== "void" ? (
              <Button type="button" variant="destructive" onClick={() => void handleVoid()} disabled={isSaving}>
                {t("voidExpenseAction")}
              </Button>
            ) : null}
          </div>
        </form>
      </FormPanel>
    </LtfFinanceLayout>
  );
}
