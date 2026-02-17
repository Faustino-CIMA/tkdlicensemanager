"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { login } from "@/lib/auth-api";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const locale = useLocale();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showVerifyLink, setShowVerifyLink] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setErrorMessage(null);
    setShowVerifyLink(false);
    try {
      const response = await login(values);
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
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">{t("loginTitle")}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Use your LTF credentials to access the dashboard.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("username")}</label>
            <Input placeholder="john.doe" {...register("username")} />
            {errors.username ? (
              <p className="text-sm text-red-600">{errors.username.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("password")}</label>
            <Input type="password" placeholder="••••••••" {...register("password")} />
            {errors.password ? (
              <p className="text-sm text-red-600">{errors.password.message}</p>
            ) : null}
          </div>

          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
          {showVerifyLink ? (
            <p className="text-sm text-zinc-600">
              {t("verifyPrompt")}{" "}
              <Link className="font-medium text-zinc-900" href={`/${locale}/verify-email`}>
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
