"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AppTextarea,
  FormPanel,
  ActionNotices
} from "@/components/ui/list-page-chrome";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Club,
  IncomeCategory,
  createFinanceIncome,
  getFinanceClubs,
  getIncomeCategories,
} from "@/lib/ltf-finance-api";

function todayDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function LtfFinanceIncomeCreatePage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [categories, setCategories] = useState<IncomeCategory[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [clubId, setClubId] = useState("none");
  const [description, setDescription] = useState("");
  const [payer, setPayer] = useState("");
  const [amount, setAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState(todayDateInputValue);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getIncomeCategories({ activeOnly: true }), getFinanceClubs()])
      .then(([categoryResponse, clubResponse]) => {
        setCategories(categoryResponse);
        setClubs(clubResponse);
        if (categoryResponse[0]) {
          setCategoryId(String(categoryResponse[0].id));
        }
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : t("incomeLoadError"));
      });
  }, [t]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryId) {
      setErrorMessage(t("incomeCategoryRequiredError"));
      return;
    }
    if (!description.trim()) {
      setErrorMessage(t("incomeDescriptionRequiredError"));
      return;
    }
    if (!amount.trim()) {
      setErrorMessage(t("incomeAmountRequiredError"));
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const income = await createFinanceIncome({
        category: Number(categoryId),
        club: clubId === "none" ? null : Number(clubId),
        description: description.trim(),
        payer: payer.trim() || undefined,
        amount: amount.trim(),
        income_date: incomeDate,
        payment_method: paymentMethod,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      router.push(`/${locale}/dashboard/ltf-finance/income/${income.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("incomeSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <LtfFinanceLayout title={t("recordIncomeAction")} subtitle={t("incomeFormSubtitle")}>
      <Button asChild variant="outline" className="w-fit">
        <Link href={`/${locale}/dashboard/ltf-finance/income`}>{t("backToIncome")}</Link>
      </Button>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

      <FormPanel>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="income-date">
                {t("incomeDateLabel")}
              </label>
              <Input
                id="income-date"
                type="date"
                value={incomeDate}
                onChange={(event) => setIncomeDate(event.target.value)}
                required
              />
              <p className="text-xs text-muted">{t("incomeDateHint")}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("incomeCategoryLabel")}</label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("incomeCategoryLabel")} />
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
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="income-payer">
                {t("incomePayerLabel")}
              </label>
              <Input
                id="income-payer"
                value={payer}
                onChange={(event) => setPayer(event.target.value)}
                placeholder={t("incomePayerPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="income-amount">
                {t("incomeAmountLabel")}
              </label>
              <Input
                id="income-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground" htmlFor="income-description">
                {t("incomeDescriptionLabel")}
              </label>
              <Input
                id="income-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("incomeDescriptionPlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("paymentMethodLabel")}</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">{t("paymentMethodBankTransfer")}</SelectItem>
                  <SelectItem value="cash">{t("paymentMethodCash")}</SelectItem>
                  <SelectItem value="card">{t("paymentMethodCard")}</SelectItem>
                  <SelectItem value="offline">{t("paymentMethodOffline")}</SelectItem>
                  <SelectItem value="other">{t("paymentMethodOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("clubLabel")}</label>
              <Select value={clubId} onValueChange={setClubId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("incomeNoClubOption")}</SelectItem>
                  {clubs.map((club) => (
                    <SelectItem key={club.id} value={String(club.id)}>
                      {club.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="income-reference">
                {t("incomeReferenceLabel")}
              </label>
              <Input id="income-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground" htmlFor="income-notes">
                {t("paymentNotesLabel")}
              </label>
              <AppTextarea id="income-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? t("savingAction") : t("recordIncomeAction")}
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href={`/${locale}/dashboard/ltf-finance/income`}>{common("deleteCancelButton")}</Link>
            </Button>
          </div>
        </form>
      </FormPanel>
    </LtfFinanceLayout>
  );
}
