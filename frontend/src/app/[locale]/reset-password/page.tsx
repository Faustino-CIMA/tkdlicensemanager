"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { resetPasswordConfirm } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { Input } from "@/components/ui/input";

export default function ResetPasswordPage() {
  const t = useTranslations("Reset");
  const locale = useLocale();
  const params = useSearchParams();
  const uid = params.get("uid");
  const token = params.get("token");
  const username = (params.get("username") ?? "").trim();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loginHref = username
    ? `/${locale}/login?username=${encodeURIComponent(username)}`
    : `/${locale}/login`;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!uid || !token) {
      setErrorMessage(t("missingToken"));
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage(t("passwordMismatch"));
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await resetPasswordConfirm({ uid, token, password });
      setSuccessMessage(response.detail);
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("resetFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-12">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>

      <ActionNotices error={errorMessage} success={successMessage} onDismiss={() => { setErrorMessage(null); setSuccessMessage(null); }} />

      <form className="space-y-4" onSubmit={handleSubmit} autoComplete="on">
        {username ? (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="reset-username">
              {t("usernameLabel")}
            </label>
            <Input
              id="reset-username"
              name="username"
              type="text"
              value={username}
              readOnly
              autoComplete="username"
            />
            <p className="text-xs text-muted">{t("usernameHint")}</p>
          </div>
        ) : null}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="reset-password">
            {t("passwordLabel")}
          </label>
          <Input
            id="reset-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="reset-password-confirm">
            {t("confirmPasswordLabel")}
          </label>
          <Input
            id="reset-password-confirm"
            name="new-password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? t("submitting") : t("submit")}
        </Button>
      </form>

      <div className="text-center text-sm text-muted">
        <Link className="text-foreground hover:underline" href={loginHref}>
          {successMessage ? t("continueToLogin") : t("backToLogin")}
        </Link>
      </div>
    </div>
  );
}
