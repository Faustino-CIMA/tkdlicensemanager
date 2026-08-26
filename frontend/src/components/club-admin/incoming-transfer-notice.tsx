"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { useClubSelection } from "@/components/club-selection-provider";
import { FloatingNotice } from "@/components/ui/list-page-chrome";
import { getMemberTransfers, MemberTransfer } from "@/lib/club-admin-api";

const DISMISS_KEY = "incoming-transfer-notice-dismissed";

function readDismissedIds(): number[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "number") : [];
  } catch {
    return [];
  }
}

function writeDismissedIds(ids: number[]) {
  window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify(ids));
}

export function IncomingTransferNotice() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const pathname = usePathname();
  const { clubs } = useClubSelection();
  const [incoming, setIncoming] = useState<MemberTransfer[]>([]);
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);

  useEffect(() => {
    setDismissedIds(readDismissedIds());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await getMemberTransfers();
        if (!cancelled) {
          setIncoming(rows.filter((item) => item.status === "pending"));
        }
      } catch {
        if (!cancelled) {
          setIncoming([]);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const clubIds = useMemo(() => new Set(clubs.map((club) => club.id)), [clubs]);
  const incomingForAdmin = useMemo(
    () => incoming.filter((item) => clubIds.has(item.to_club.id)),
    [clubIds, incoming]
  );
  const visibleIncoming = useMemo(
    () => incomingForAdmin.filter((item) => !dismissedIds.includes(item.id)),
    [dismissedIds, incomingForAdmin]
  );

  const onTransfersPage = Boolean(pathname?.includes("/dashboard/club/transfers"));
  const open = visibleIncoming.length > 0 && !onTransfersPage;
  const count = visibleIncoming.length;
  const token = visibleIncoming.map((item) => item.id).join(",");

  const dismiss = () => {
    const next = Array.from(new Set([...dismissedIds, ...visibleIncoming.map((item) => item.id)]));
    setDismissedIds(next);
    writeDismissedIds(next);
  };

  return (
    <FloatingNotice
      open={open}
      token={token}
      tone="info"
      onDismiss={dismiss}
      dismissLabel={common("modalClose")}
    >
      <p className="font-medium">
        {t("incomingTransferNotice", { count })}
      </p>
      <Link
        href={`/${locale}/dashboard/club/transfers#requests`}
        className="mt-1 inline-block font-semibold underline underline-offset-4"
        onClick={dismiss}
      >
        {t("incomingTransferNoticeOpen")}
      </Link>
    </FloatingNotice>
  );
}
