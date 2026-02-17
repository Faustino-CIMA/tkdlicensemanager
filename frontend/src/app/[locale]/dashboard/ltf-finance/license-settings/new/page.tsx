"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LtfFinanceLayout } from "@/components/ltf-finance/ltf-finance-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createFinanceLicenseType } from "@/lib/ltf-finance-api";

export default function LtfFinanceLicenseTypeCreatePage() {
  const t = useTranslations("LtfFinance");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();

  const [licenseTypeName, setLicenseTypeName] = useState("");
  const [initialPriceAmount, setInitialPriceAmount] = useState("");
  const [initialPriceEffectiveFrom, setInitialPriceEffectiveFrom] = useState("");
  const [initialPriceIsFree, setInitialPriceIsFree] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const saveLicenseType = async () => {
    const trimmedName = licenseTypeName.trim();
    if (!trimmedName) {
      setErrorMessage(t("licenseTypeNameRequiredError"));
      return;
    }

    const normalizedInitialAmount = initialPriceIsFree ? "0.00" : initialPriceAmount.trim();
    if (!normalizedInitialAmount) {
      setErrorMessage(t("initialPriceRequiredError"));
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);
    try {
      await createFinanceLicenseType({
        name: trimmedName,
        initial_price_amount: normalizedInitialAmount,
        initial_price_currency: "EUR",
        initial_price_effective_from: initialPriceEffectiveFrom || undefined,
      });
      router.push(`/${locale}/dashboard/ltf-finance/license-settings`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("licenseTypeSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveLicenseType();
  };

  return (
    <LtfFinanceLayout title={t("createLicenseType")} subtitle={t("licenseTypeFormSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <section className="space-y-5 rounded-3xl bg-white p-6 shadow-sm">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("licenseTypeNameLabel")}</label>
            <Input
              placeholder={t("licenseTypeNamePlaceholder")}
              value={licenseTypeName}
              onChange={(event) => setLicenseTypeName(event.target.value)}
            />
          </div>

          <div className="space-y-4 rounded-xl border border-zinc-200 p-4">
            <p className="text-sm font-medium text-zinc-700">{t("initialPriceSectionLabel")}</p>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={initialPriceIsFree}
                onChange={(event) => {
                  const nextValue = event.target.checked;
                  setInitialPriceIsFree(nextValue);
                  if (nextValue) {
                    setInitialPriceAmount("0.00");
                  } else {
                    setInitialPriceAmount("");
                  }
                }}
              />
              {t("initialPriceFreeLabel")}
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("priceAmountLabel")}</label>
                <Input
                  value={initialPriceAmount}
                  onChange={(event) => setInitialPriceAmount(event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  disabled={initialPriceIsFree}
                />
                <p className="text-xs text-zinc-500">{t("initialPriceHint")}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("priceEffectiveFromLabel")}</label>
                <Input
                  type="date"
                  value={initialPriceEffectiveFrom}
                  onChange={(event) => setInitialPriceEffectiveFrom(event.target.value)}
                />
                <p className="text-xs text-zinc-500">{t("priceEffectiveFromHint")}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? t("savingAction") : t("createLicenseType")}
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href={`/${locale}/dashboard/ltf-finance/license-settings`}>
                {common("deleteCancelButton")}
              </Link>
            </Button>
          </div>
        </form>
      </section>
    </LtfFinanceLayout>
  );
}
