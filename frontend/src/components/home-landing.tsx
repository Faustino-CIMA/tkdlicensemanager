"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AppVersionLink } from "@/components/app-version-link";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import { getRoleNavDefs, type RoleNavDef } from "@/lib/role-nav";

type MeResponse = {
  username: string;
  first_name: string;
  role: string;
};

export function HomeLanding() {
  const locale = useLocale();
  const t = useTranslations("Home");
  const common = useTranslations("Common");
  const tClub = useTranslations("ClubAdmin");
  const tLtf = useTranslations("LtfAdmin");
  const tFinance = useTranslations("LtfFinance");
  const tMember = useTranslations("Member");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setMe(null);
      setIsChecking(false);
      return;
    }

    let cancelled = false;
    const loadMe = async () => {
      try {
        const response = await apiRequest<MeResponse>("/api/auth/me/");
        if (!cancelled) {
          setMe(response);
        }
      } catch {
        clearToken();
        if (!cancelled) {
          setMe(null);
        }
      } finally {
        if (!cancelled) {
          setIsChecking(false);
        }
      }
    };
    void loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  const labelFor = (def: RoleNavDef) => {
    if (def.namespace === "ClubAdmin") {
      return tClub(def.labelKey);
    }
    if (def.namespace === "LtfAdmin") {
      return tLtf(def.labelKey);
    }
    if (def.namespace === "LtfFinance") {
      return tFinance(def.labelKey);
    }
    return tMember(def.labelKey);
  };

  if (isChecking) {
    return (
      <main className="bg-background px-6 py-16 lg:py-24">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3" role="status" aria-live="polite">
          <Spinner />
          <p className="text-sm text-muted">{common("loadingLabel")}</p>
        </div>
      </main>
    );
  }

  if (me) {
    const navDefs = getRoleNavDefs(me.role);
    const dashboardHref = getDashboardRouteForRole(me.role, locale) ?? `/${locale}/dashboard`;
    const displayName = me.first_name?.trim() || me.username;
    const roleLabel =
      {
        ltf_admin: common("roleLtfAdmin"),
        ltf_finance: common("roleLtfFinance"),
        club_admin: common("roleClubAdmin"),
        coach: common("roleCoach"),
        member: common("roleMember"),
      }[me.role] ?? me.role;

    return (
      <main className="bg-background px-6 py-16 lg:py-24">
        <div className="mx-auto w-full max-w-5xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">{t("kicker")}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground">
            {t("signedInTitle", { name: displayName })}
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">
            {t("signedInSubtitle", { role: roleLabel })}
          </p>
          <div className="mt-6">
            <Link
              href={dashboardHref}
              className="inline-flex h-[var(--control-height)] items-center justify-center rounded-[var(--radius-chip)] bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm"
            >
              {t("openDashboard")}
            </Link>
          </div>

          <div className="mt-8">
            <AppVersionLink />
          </div>

          <nav aria-label={common("navigationLabel")} className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {navDefs.map((def) => {
              const Icon = def.icon;
              return (
                <Link
                  key={def.id}
                  href={def.href(locale)}
                  className="app-panel flex items-center gap-3 p-4 transition-colors hover:bg-secondary"
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-secondary text-accent">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold text-foreground">{labelFor(def)}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-background px-6 py-16 lg:py-24">
      <div className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">{t("kicker")}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground lg:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">{t("subtitle")}</p>
          <div className="mt-8">
            <Link
              href={`/${locale}/login`}
              className="inline-flex h-[var(--control-height)] items-center justify-center rounded-[var(--radius-chip)] bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm"
            >
              {t("signIn")}
            </Link>
          </div>
        </div>
        <div className="app-panel grid gap-4 p-6">
          <div className="rounded-[var(--radius-control)] bg-[color-mix(in_oklab,var(--accent)_12%,white)] p-4">
            <p className="text-meta">{t("tileMembersLabel")}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{t("tileMembersValue")}</p>
          </div>
          <div className="rounded-[var(--radius-control)] bg-[color-mix(in_oklab,var(--success)_14%,white)] p-4">
            <p className="text-meta">{t("tileLicensesLabel")}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{t("tileLicensesValue")}</p>
          </div>
          <div className="rounded-[var(--radius-control)] bg-[color-mix(in_oklab,var(--warning)_16%,white)] p-4">
            <p className="text-meta">{t("tilePrintLabel")}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{t("tilePrintValue")}</p>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-10 w-full max-w-5xl">
        <AppVersionLink />
      </div>
    </main>
  );
}
