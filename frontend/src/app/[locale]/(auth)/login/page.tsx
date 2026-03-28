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
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-8 text-[var(--surface-foreground)] shadow-sm">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/ltf-logo.svg"
            alt="LTF"
            width={160}
            height={48}
            className="h-10 w-auto"
            priority
          />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            {t("loginTitle")}
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">{t("loginSubtitle")}</p>
        </div>

        <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
          <div className="space-y-2 text-left">
            <label className="text-sm font-medium text-[var(--foreground)]" htmlFor="login-username">
              {t("username")}
            </label>
            <Input
              id="login-username"
              name="username"
              autoComplete="username"
              placeholder="john.doe"
              disabled={isSubmitting}
            />
            {fieldErrors.username ? (
              <p className="text-sm text-destructive">{fieldErrors.username}</p>
            ) : null}
          </div>

          <div className="space-y-2 text-left">
            <label className="text-sm font-medium text-[var(--foreground)]" htmlFor="login-password">
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
            {fieldErrors.password ? (
              <p className="text-sm text-destructive">{fieldErrors.password}</p>
            ) : null}
          </div>

          {errorMessage ? <p className="text-center text-sm text-destructive">{errorMessage}</p> : null}
          {showVerifyLink ? (
            <p className="text-center text-sm text-[var(--muted)]">
              {t("verifyPrompt")}{" "}
              <Link
                className="font-medium text-[var(--foreground)] underline-offset-4 hover:underline"
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
    </main>
  );
}
