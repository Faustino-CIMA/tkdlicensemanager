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
  FinanceIncome,
  IncomeCategory,
  getFinanceClubs,
  getFinanceIncome,
  getIncomeCategories,
  updateFinanceIncome,
  voidFinanceIncome,
} from "@/lib/ltf-finance-api";

export default function LtfFinanceIncomeDetailPage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const params = useParams();
  const [income, setIncome] = useState<FinanceIncome | null>(null);
  const [categories, setCategories] = useState<IncomeCategory[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [clubId, setClubId] = useState("none");
  const [description, setDescription] = useState("");
  const [payer, setPayer] = useState("");
  const [amount, setAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const incomeId = useMemo(() => {
    const rawId = params?.id;
    return Number(Array.isArray(rawId) ? rawId[0] : rawId);
  }, [params]);

  const applyIncome = (next: FinanceIncome) => {
    setIncome(next);
    setCategoryId(String(next.category));
    setClubId(next.club ? String(next.club) : "none");
    setDescription(next.description);
    setPayer(next.payer);
    setAmount(next.amount);
    setIncomeDate(next.income_date);
    setPaymentMethod(next.payment_method || "bank_transfer");
    setReference(next.reference);
    setNotes(next.notes);
  };

  const loadData = useCallback(async () => {
    if (!incomeId || Number.isNaN(incomeId)) {
      setErrorMessage(t("incomeNotFoundSubtitle"));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [incomeResponse, categoryResponse, clubResponse] = await Promise.all([
        getFinanceIncome(incomeId),
        getIncomeCategories(),
        getFinanceClubs(),
      ]);
      applyIncome(incomeResponse);
      setCategories(categoryResponse);
      setClubs(clubResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("incomeLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [incomeId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const statusMeta = useMemo(() => {
    switch (income?.status) {
      case "received":
        return { label: t("incomeStatusReceived"), tone: "success" as const };
      case "void":
        return { label: common("statusVoid"), tone: "danger" as const };
      default:
        return { label: income?.status ?? "-", tone: "neutral" as const };
    }
  }, [common, income?.status, t]);

  const isLocked = income?.status === "void";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!income || isLocked) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updated = await updateFinanceIncome(income.id, {
        category: Number(categoryId),
        club: clubId === "none" ? null : Number(clubId),
        description: description.trim(),
        payer: payer.trim(),
        amount: amount.trim(),
        income_date: incomeDate,
        payment_method: paymentMethod,
        reference: reference.trim(),
        notes: notes.trim(),
      });
      applyIncome(updated);
      setSuccessMessage(t("incomeSavedMessage"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("incomeSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleVoid = async () => {
    if (!income) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updated = await voidFinanceIncome(income.id);
      applyIncome(updated);
      setSuccessMessage(t("incomeVoidedMessage"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("incomeSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <LtfFinanceLayout title={t("incomeDetailTitle")} subtitle={t("incomeDetailSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </LtfFinanceLayout>
    );
  }

  if (!income) {
    return (
      <LtfFinanceLayout title={t("incomeDetailTitle")} subtitle={t("incomeDetailSubtitle")}>
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/${locale}/dashboard/ltf-finance/income`}>{t("backToIncome")}</Link>
        </Button>
        <EmptyState title={t("incomeNotFoundTitle")} description={errorMessage ?? t("incomeNotFoundSubtitle")} />
      </LtfFinanceLayout>
    );
  }

  return (
    <LtfFinanceLayout title={t("incomeDetailTitle")} subtitle={t("incomeDetailSubtitle")}>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/${locale}/dashboard/ltf-finance/income`}>{t("backToIncome")}</Link>
        </Button>
        {!isLocked ? (
          <Button type="button" variant="outline" onClick={() => void handleVoid()} disabled={isSaving}>
            {t("voidIncomeAction")}
          </Button>
        ) : null}
      </div>
      {errorMessage ? <PageNotice tone="danger">{errorMessage}</PageNotice> : null}
      {successMessage ? <PageNotice tone="success">{successMessage}</PageNotice> : null}

      <FormPanel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="font-medium text-foreground">{income.income_number}</span>
          <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
        </div>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("incomeDateLabel")}</label>
              <Input
                type="date"
                value={incomeDate}
                onChange={(event) => setIncomeDate(event.target.value)}
                disabled={isLocked}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("incomeCategoryLabel")}</label>
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
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("incomePayerLabel")}</label>
              <Input value={payer} onChange={(event) => setPayer(event.target.value)} disabled={isLocked} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("incomeAmountLabel")}</label>
              <Input value={amount} onChange={(event) => setAmount(event.target.value)} disabled={isLocked} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground">{t("incomeDescriptionLabel")}</label>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} disabled={isLocked} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("paymentMethodLabel")}</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={isLocked}>
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
              <Select value={clubId} onValueChange={setClubId} disabled={isLocked}>
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
              <label className="text-sm font-medium text-foreground">{t("incomeReferenceLabel")}</label>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} disabled={isLocked} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground">{t("paymentNotesLabel")}</label>
              <AppTextarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isLocked} />
            </div>
          </div>
          {!isLocked ? (
            <Button type="submit" disabled={isSaving}>
              {isSaving ? t("savingAction") : t("saveIncomeAction")}
            </Button>
          ) : null}
        </form>
      </FormPanel>
    </LtfFinanceLayout>
  );
}
