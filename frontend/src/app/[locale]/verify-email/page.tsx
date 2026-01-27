"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { resendVerification, verifyEmail } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const resendSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

type ResendFormValues = z.infer<typeof resendSchema>;

export default function VerifyEmailPage() {
  const t = useTranslations("Verify");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const key = searchParams.get("key");

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResendFormValues>({
    resolver: zodResolver(resendSchema),
    defaultValues: {
      email: "",
    },
  });

  useEffect(() => {
    if (!key) {
      return;
    }

    const runVerification = async () => {
      setIsVerifying(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        await verifyEmail({ key });
        setStatusMessage(t("verifySuccess"));
        setIsVerified(true);
      } catch {
        setErrorMessage(t("verifyError"));
      } finally {
        setIsVerifying(false);
      }
    };

    runVerification();
  }, [key, t]);

  useEffect(() => {
    if (!isVerified) {
      return;
    }

    const timer = setTimeout(() => {
      router.push(`/${locale}/login`);
    }, 2500);

    return () => clearTimeout(timer);
  }, [isVerified, locale, router]);

  const onSubmit = async (values: ResendFormValues) => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await resendVerification({ ...values, locale });
      setStatusMessage(t("resendSuccess"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to resend email");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500">{t("subtitle")}</p>

        {isVerifying ? (
          <p className="mt-4 text-sm text-zinc-600">{t("verifying")}</p>
        ) : null}

        {statusMessage ? (
          <p className="mt-4 text-sm text-emerald-600">{statusMessage}</p>
        ) : null}
        {isVerified ? (
          <p className="mt-2 text-sm text-zinc-500">{t("redirecting")}</p>
        ) : null}
        {errorMessage ? <p className="mt-4 text-sm text-red-600">{errorMessage}</p> : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("emailLabel")}</label>
            <Input type="email" placeholder="john@example.com" {...register("email")} />
            {errors.email ? <p className="text-sm text-red-600">{errors.email.message}</p> : null}
          </div>

          <Button className="w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("verifying") : t("submit")}
          </Button>
        </form>

        <p className="mt-4 text-sm text-zinc-500">
          <Link className="font-medium text-zinc-900" href={`/${locale}/login`}>
            {t("backToLogin")}
          </Link>
        </p>
      </div>
    </main>
  );
}
