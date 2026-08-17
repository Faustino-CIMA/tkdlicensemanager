"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { login } from "@/lib/auth-api";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const locale = useLocale();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showVerifyLink, setShowVerifyLink] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setShowVerifyLink(false);
    setFieldErrors({});

    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const nextErrors: { username?: string; password?: string } = {};
    if (!username) {
      nextErrors.username = "Username is required";
    }
    if (!password) {
      nextErrors.password = "Password is required";
    } else if (password.length < 6) {
      nextErrors.password = "Password must be at least 6 characters";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await login({ username, password });
      setToken(response.token);
      router.push(`/${locale}/dashboard`);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Login failed";
      const isNotVerified = rawMessage.toLowerCase().includes("not verified");
      const message = isNotVerified ? t("emailNotVerified") : rawMessage;
      setErrorMessage(message);
      if (isNotVerified) {
        setShowVerifyLink(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[oklch(22%_0.06_232)] px-12 py-16 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-16 top-16 size-72 rounded-full bg-[oklch(54%_0.13_232_/_0.35)] blur-3xl" />
        <div className="pointer-events-none absolute -left-10 bottom-10 size-64 rounded-full bg-[oklch(54%_0.19_25_/_0.22)] blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-3">
            <div className="flex size-12 items-center justify-center overflow-hidden rounded-[var(--radius-control)] bg-white/10">
              <Image src="/ltf-logo.svg" alt="LTF" width={120} height={36} className="h-7 w-auto" priority />
            </div>
            <p className="text-sm font-semibold tracking-wide">Luxembourg Taekwondo Federation</p>
          </div>
          <h1 className="mt-16 max-w-md text-4xl font-semibold leading-tight tracking-tight">{t("brandTitle")}</h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/75">{t("brandSubtitle")}</p>
        </div>
        <p className="relative text-sm text-white/55">{t("brandFooter")}</p>
      </section>

      <section className="flex items-center justify-center bg-background px-6 py-16">
        <div className="app-panel w-full max-w-md p-8">
          <div className="lg:hidden">
            <Image src="/ltf-logo.svg" alt="LTF" width={140} height={42} className="h-9 w-auto" priority />
          </div>
          <h2 className="mt-2 text-title text-foreground lg:mt-0">{t("loginTitle")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t("loginSubtitle")}</p>

          <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
            <div className="space-y-2 text-left">
              <label className="text-sm font-medium text-foreground" htmlFor="login-username">
                {t("username")}
              </label>
              <Input
                id="login-username"
                name="username"
                autoComplete="username"
                placeholder="john.doe"
                disabled={isSubmitting}
              />
              {fieldErrors.username ? <p className="text-sm text-destructive">{fieldErrors.username}</p> : null}
            </div>

            <div className="space-y-2 text-left">
              <label className="text-sm font-medium text-foreground" htmlFor="login-password">
                {t("password")}
              </label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                disabled={isSubmitting}
              />
              {fieldErrors.password ? <p className="text-sm text-destructive">{fieldErrors.password}</p> : null}
            </div>

            {errorMessage ? <p className="text-center text-sm text-destructive">{errorMessage}</p> : null}
            {showVerifyLink ? (
              <p className="text-center text-sm text-muted">
                {t("verifyPrompt")}{" "}
                <Link
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  href={`/${locale}/verify-email`}
                >
                  {t("verifyLink")}
                </Link>
              </p>
            ) : null}

            <Button className="w-full text-base font-semibold" type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("loading") : t("submit")}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
