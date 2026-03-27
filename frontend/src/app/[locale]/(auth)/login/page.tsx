"use client";

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
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-card p-8 text-card-foreground shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">{t("loginTitle")}</h1>
        <p className="mt-2 text-sm text-muted">
          Use your LTF credentials to access the dashboard.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
          <div className="space-y-2">
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
            {fieldErrors.username ? (
              <p className="text-sm text-destructive">{fieldErrors.username}</p>
            ) : null}
          </div>

          <div className="space-y-2">
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
            {fieldErrors.password ? (
              <p className="text-sm text-destructive">{fieldErrors.password}</p>
            ) : null}
          </div>

          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          {showVerifyLink ? (
            <p className="text-sm text-muted">
              {t("verifyPrompt")}{" "}
              <Link className="font-medium text-foreground" href={`/${locale}/verify-email`}>
                {t("verifyLink")}
              </Link>
            </p>
          ) : null}

          <Button className="w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("loading") : t("submit")}
          </Button>
        </form>
      </div>
    </main>
  );
}
