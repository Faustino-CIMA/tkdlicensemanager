"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Club,
  ExpenseCategory,
  createFinanceExpense,
  getExpenseCategories,
  getFinanceClubs,
} from "@/lib/ltf-finance-api";

export default function LtfFinanceExpenseCreatePage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [clubId, setClubId] = useState("none");
  const [description, setDescription] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [markPaid, setMarkPaid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getExpenseCategories({ activeOnly: true }), getFinanceClubs()])
      .then(([categoryResponse, clubResponse]) => {
        setCategories(categoryResponse);
        setClubs(clubResponse);
        if (categoryResponse[0] && !categoryId) {
          setCategoryId(String(categoryResponse[0].id));
        }
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : t("expensesLoadError"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryId) {
      setErrorMessage(t("expenseCategoryRequiredError"));
      return;
    }
    if (!description.trim()) {
      setErrorMessage(t("expenseDescriptionRequiredError"));
      return;
    }
    if (!amount.trim()) {
      setErrorMessage(t("expenseAmountRequiredError"));
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const expense = await createFinanceExpense({
        category: Number(categoryId),
        club: clubId === "none" ? null : Number(clubId),
        description: description.trim(),
        payee: payee.trim() || undefined,
        amount: amount.trim(),
        expense_date: expenseDate,
        payment_method: markPaid ? paymentMethod : undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        mark_paid: markPaid,
      });
      router.push(`/${locale}/dashboard/ltf-finance/expenses/${expense.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("expenseSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <LtfFinanceLayout title={t("recordExpenseAction")} subtitle={t("expenseFormSubtitle")}>
      <Button asChild variant="outline" className="w-fit">
        <Link href={`/${locale}/dashboard/ltf-finance/expenses`}>{t("backToExpenses")}</Link>
      </Button>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}

      <FormPanel>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expenseDateLabel")}</label>
              <Input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expenseCategoryLabel")}</label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("expenseCategoryLabel")} />
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
                placeholder={t("expenseDescriptionPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expensePayeeLabel")}</label>
              <Input
                value={payee}
                onChange={(event) => setPayee(event.target.value)}
                placeholder={t("expensePayeePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("expenseAmountLabel")}</label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("clubLabel")}</label>
              <Select value={clubId} onValueChange={setClubId}>
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
              <Input value={reference} onChange={(event) => setReference(event.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={markPaid} onCheckedChange={(checked) => setMarkPaid(checked === true)} />
            {t("expenseAlreadyPaidLabel")}
          </label>

          {markPaid ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("paymentMethodLabel")}</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
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
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("paymentNotesLabel")}</label>
            <AppTextarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? t("savingAction") : t("recordExpenseAction")}
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href={`/${locale}/dashboard/ltf-finance/expenses`}>{common("deleteCancelButton")}</Link>
            </Button>
          </div>
        </form>
      </FormPanel>
    </LtfFinanceLayout>
  );
}
