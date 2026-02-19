"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { getToken } from "@/lib/auth";
import { Club, getClubs } from "@/lib/club-admin-api";

type ClubSelectionState = {
  clubs: Club[];
  selectedClubId: number | null;
  setSelectedClubId: (id: number | null) => void;
  isLoading: boolean;
};

const ClubSelectionContext = createContext<ClubSelectionState | undefined>(undefined);

const STORAGE_KEY = "selected_club_id";

export function ClubSelectionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isDashboardRoute = pathname?.includes("/dashboard");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) {
        setSelectedClubId(parsed);
      }
    }
  }, []);

  useEffect(() => {
    if (!isDashboardRoute) {
      return;
    }
    if (!getToken()) {
      return;
    }
    const loadClubs = async () => {
      setIsLoading(true);
      try {
        const response = await getClubs();
        setClubs(response);
        if (response.length > 0) {
          setSelectedClubId((previous) => previous ?? response[0].id);
        }
      } catch {
        setClubs([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadClubs();
  }, [isDashboardRoute]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selectedClubId) {
      sessionStorage.setItem(STORAGE_KEY, String(selectedClubId));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedClubId]);

  const value = useMemo(
    () => ({ clubs, selectedClubId, setSelectedClubId, isLoading }),
    [clubs, selectedClubId, isLoading]
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
