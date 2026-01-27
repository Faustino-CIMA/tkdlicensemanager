"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { register as registerUser } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const registerSchema = z.object({
  username: z.string().min(1, "Username is required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      first_name: "",
      last_name: "",
    },
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await registerUser({ ...values, locale });
      setSuccessMessage(t("verifyNotice"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Registration failed");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">{t("registerTitle")}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Create your LTF account to request or manage licenses.
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
            <label className="text-sm font-medium text-zinc-700">{t("email")}</label>
            <Input type="email" placeholder="john@example.com" {...register("email")} />
            {errors.email ? (
              <p className="text-sm text-red-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("password")}</label>
            <Input type="password" placeholder="••••••••" {...register("password")} />
            {errors.password ? (
              <p className="text-sm text-red-600">{errors.password.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("firstName")}</label>
            <Input placeholder="John" {...register("first_name")} />
            {errors.first_name ? (
              <p className="text-sm text-red-600">{errors.first_name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("lastName")}</label>
            <Input placeholder="Doe" {...register("last_name")} />
            {errors.last_name ? (
              <p className="text-sm text-red-600">{errors.last_name.message}</p>
            ) : null}
          </div>

          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
          {successMessage ? (
            <p className="text-sm text-emerald-600">{successMessage}</p>
          ) : null}

          <Button className="w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("loading") : t("submit")}
          </Button>
        </form>

        <p className="mt-4 text-sm text-zinc-500">
          Already have an account?{" "}
          <Link className="font-medium text-zinc-900" href={`/${locale}/login`}>
            {t("loginTitle")}
          </Link>
        </p>
      </div>
    </main>
  );
}
