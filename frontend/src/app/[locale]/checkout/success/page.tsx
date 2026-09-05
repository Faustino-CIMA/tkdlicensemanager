"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { confirmStripeCheckout } from "@/lib/club-finance-api";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";

type MeResponse = {
  role: string;
  is_superuser?: boolean;
};

const POLL_INTERVAL_MS = 2000;
const MAX_CONFIRM_ATTEMPTS = 15;

function CheckoutSuccessContent() {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const sessionId = (searchParams.get("session_id") ?? "").trim();
  const [dashboardHref, setDashboardHref] = useState(`/${locale}/dashboard`);
  const [phase, setPhase] = useState<"confirming" | "ready" | "timeout">(
    sessionId ? "confirming" : "ready"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const attemptsRef = useRef(0);
  const confirmInFlight = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!getToken()) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const me = await apiRequest<MeResponse>("/api/auth/me/");
        const target = getDashboardRouteForRole(me.role, locale, {
          isSuperuser: Boolean(me.is_superuser),
        });
        if (!cancelled && target) {
          setDashboardHref(target);
        }
      } catch {
        if (!cancelled) {
          setDashboardHref(`/${locale}/dashboard`);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const runConfirm = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      return true;
    }
    if (confirmInFlight.current) {
      return confirmInFlight.current;
    }
    const pending = (async () => {
      const result = await confirmStripeCheckout(sessionId);
      return result.status === "paid";
    })();
    confirmInFlight.current = pending;
    try {
      return await pending;
    } finally {
      confirmInFlight.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      attemptsRef.current += 1;
      try {
        const paid = await runConfirm();
        if (cancelled) {
          return;
        }
        if (paid) {
          setPhase("ready");
          setErrorMessage(null);
          return;
        }
        if (attemptsRef.current >= MAX_CONFIRM_ATTEMPTS) {
          setPhase("timeout");
          return;
        }
        timeoutId = setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : t("confirmError"));
        if (attemptsRef.current >= MAX_CONFIRM_ATTEMPTS) {
          setPhase("timeout");
          return;
        }
        timeoutId = setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [runConfirm, sessionId, t]);

  const subtitle = useMemo(() => {
    if (phase === "confirming") {
      return t("confirmingSubtitle");
    }
    if (phase === "timeout") {
      return t("confirmTimeoutSubtitle");
    }
    return t("successSubtitle");
  }, [phase, t]);

  const handleGoToDashboard = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (phase === "ready") {
      return;
    }
    event.preventDefault();
    try {
      await runConfirm();
    } catch {
      // Still navigate; webhook/reconcile remains the backup.
    }
    window.location.assign(dashboardHref);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <ActionNotices error={phase !== "confirming" ? errorMessage : null} onDismiss={() => setErrorMessage(null)} />
      <div className="w-full max-w-xl rounded-[var(--radius-card)] bg-card p-10 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">{t("successTitle")}</h1>
        <p className="mt-3 text-sm text-muted">{subtitle}</p>
        {phase === "confirming" ? (
          <div className="mt-6 flex justify-center">
            <Spinner label={t("confirmingSubtitle")} />
          </div>
        ) : null}
        <div className="mt-6 flex justify-center">
          {phase === "confirming" ? (
            <Button disabled>{t("confirmingAction")}</Button>
          ) : (
            <Button asChild variant="primary">
              <Link href={dashboardHref} onClick={handleGoToDashboard}>
                {t("successAction")}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

export default function CheckoutSuccessPage() {
  const t = useTranslations("Checkout");
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="w-full max-w-xl rounded-[var(--radius-card)] bg-card p-10 text-center shadow-sm">
            <Spinner label={t("confirmingSubtitle")} />
          </div>
        </main>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}
