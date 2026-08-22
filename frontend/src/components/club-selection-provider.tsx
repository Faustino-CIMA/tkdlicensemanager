"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { getToken } from "@/lib/auth";
import { Club, getClubs } from "@/lib/club-admin-api";
import { unwrapListResponse } from "@/lib/pagination";

type ClubSelectionState = {
  clubs: Club[];
  selectedClubId: number | null;
  setSelectedClubId: (id: number | null) => void;
  isLoading: boolean;
};

const ClubSelectionContext = createContext<ClubSelectionState | undefined>(undefined);

const STORAGE_KEY = "selected_club_id";

export const ALL_CLUBS_SELECT_VALUE = "all";

export function isLtfAdminPath(pathname: string | null | undefined): boolean {
  if (!pathname) {
    return false;
  }
  return /\/dashboard\/ltf(?:\/|$)/.test(pathname);
}

export function isLtfFinancePath(pathname: string | null | undefined): boolean {
  if (!pathname) {
    return false;
  }
  return /\/dashboard\/ltf-finance(?:\/|$)/.test(pathname);
}

export function allowsAllClubsSelection(pathname: string | null | undefined): boolean {
  return isLtfAdminPath(pathname) || isLtfFinancePath(pathname);
}

function dashboardPathWithoutLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?=\/)/, "");
}

export function shouldShowClubSelector(pathname: string | null | undefined): boolean {
  if (!pathname) {
    return true;
  }
  const path = dashboardPathWithoutLocale(pathname);
  if (isLtfAdminPath(pathname)) {
    if (path === "/dashboard/ltf") {
      return false;
    }
    const hiddenPrefixes = [
      "/dashboard/ltf/license-cards",
      "/dashboard/ltf/license-types",
      "/dashboard/ltf/printer-profiles",
      "/dashboard/ltf/settings",
    ];
    return !hiddenPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }
  if (isLtfFinancePath(pathname)) {
    if (path === "/dashboard/ltf-finance") {
      return false;
    }
    const hiddenPrefixes = [
      "/dashboard/ltf-finance/audit-log",
      "/dashboard/ltf-finance/license-settings",
      "/dashboard/ltf-finance/expenses",
      "/dashboard/ltf-finance/income",
      "/dashboard/ltf-finance/reports",
    ];
    return !hiddenPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }
  return true;
}

export function readStoredClubId(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }
  const parsed = Number(stored);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function persistSelectedClubId(id: number | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (id) {
    sessionStorage.setItem(STORAGE_KEY, String(id));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

export function resolveAssignedClubId(
  clubs: Array<{ id: number }>,
  preferred: number | null
): number | null {
  if (clubs.length === 0) {
    return preferred && preferred > 0 ? preferred : null;
  }
  if (preferred && clubs.some((club) => club.id === preferred)) {
    return preferred;
  }
  return clubs[0].id;
}

export function ClubSelectionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubIdState] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isDashboardRoute = Boolean(pathname?.includes("/dashboard"));
  const allowAllClubs = allowsAllClubsSelection(pathname);
  const defaultToAllClubs = isLtfAdminPath(pathname);

  const setSelectedClubId = useCallback((id: number | null) => {
    const nextId = allowAllClubs
      ? id && clubs.some((club) => club.id === id)
        ? id
        : null
      : resolveAssignedClubId(clubs, id);
    setSelectedClubIdState(nextId);
    persistSelectedClubId(nextId);
  }, [allowAllClubs, clubs]);

  useEffect(() => {
    if (!isDashboardRoute || !getToken()) {
      return;
    }
    let cancelled = false;
    const loadClubs = async () => {
      setIsLoading(true);
      try {
        const response = unwrapListResponse(await getClubs());
        if (cancelled) {
          return;
        }
        const storedId = readStoredClubId();
        const nextId = defaultToAllClubs
          ? null
          : allowAllClubs
            ? storedId && response.some((club) => club.id === storedId)
              ? storedId
              : null
            : resolveAssignedClubId(response, storedId);
        setClubs(response);
        setSelectedClubIdState(nextId);
        persistSelectedClubId(nextId);
      } catch {
        if (!cancelled) {
          setClubs([]);
          setSelectedClubIdState(null);
          persistSelectedClubId(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void loadClubs();
    return () => {
      cancelled = true;
    };
  }, [allowAllClubs, defaultToAllClubs, isDashboardRoute]);

  const value = useMemo(
    () => ({ clubs, selectedClubId, setSelectedClubId, isLoading }),
    [clubs, selectedClubId, setSelectedClubId, isLoading]
  );

  return <ClubSelectionContext.Provider value={value}>{children}</ClubSelectionContext.Provider>;
}

export function useClubSelection() {
  const context = useContext(ClubSelectionContext);
  if (!context) {
    throw new Error("useClubSelection must be used within ClubSelectionProvider");
  }
  return context;
}
