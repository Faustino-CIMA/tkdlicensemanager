"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Input } from "@/components/ui/input";
import { FloatingNotice, FormPanel } from "@/components/ui/list-page-chrome";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AddClubAdminResponse,
  AssignmentAdmin,
  AssignmentAdminClub,
  AssignmentClub,
  AssignmentMember,
  addClubAdmin,
  getClubAdminAssignment,
  removeClubAdmin,
  searchClubAdminAssignmentMembers,
} from "@/lib/ltf-admin-api";

type Point = { x: number; y: number };

type PendingAssign = {
  member: AssignmentMember;
  club: AssignmentClub;
};

function displayMemberName(member: AssignmentMember) {
  return `${member.first_name} ${member.last_name}`.trim();
}

function displayAdminName(admin: AssignmentAdmin) {
  const full = `${admin.first_name} ${admin.last_name}`.trim();
  return admin.member_name || full || admin.username;
}

function matchesQuery(haystack: string, query: string) {
  if (!query) {
    return true;
  }
  return haystack.toLowerCase().includes(query);
}

function relativePoint(box: DOMRect, container: HTMLElement, x: number, y: number): Point {
  const origin = container.getBoundingClientRect();
  return { x: x - origin.left, y: y - origin.top };
}

function cardCenter(element: HTMLElement, container: HTMLElement): Point {
  const box = element.getBoundingClientRect();
  return relativePoint(box, container, box.left + box.width / 2, box.top + box.height / 2);
}

function facingAnchor(element: HTMLElement, container: HTMLElement, toward: Point): Point {
  const box = element.getBoundingClientRect();
  const center = cardCenter(element, container);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return relativePoint(box, container, dx >= 0 ? box.right : box.left, box.top + box.height / 2);
  }
  return relativePoint(box, container, box.left + box.width / 2, dy >= 0 ? box.bottom : box.top);
}

function curvePath(from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const delta = Math.max(48, Math.abs(dx) / 2);
    const sign = dx >= 0 ? 1 : -1;
    return `M ${from.x} ${from.y} C ${from.x + sign * delta} ${from.y}, ${to.x - sign * delta} ${to.y}, ${to.x} ${to.y}`;
  }
  const delta = Math.max(48, Math.abs(dy) / 2);
  const sign = dy >= 0 ? 1 : -1;
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + sign * delta}, ${to.x} ${to.y - sign * delta}, ${to.x} ${to.y}`;
}

function useMinWidth(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const CARD_BASE =
  "w-full rounded-[var(--radius-card)] border-2 bg-[var(--surface)] px-3 py-3 text-left transition-colors";
const CARD_SELECTED = "border-primary";
const CARD_IDLE = "border-border hover:border-primary/50";
const CLUB_RESULT_LIMIT = 20;
const ADMIN_RESULT_LIMIT = 20;

function pinAndLimit<T extends { id: number }>(items: T[], limit: number, pinnedIds: Array<number | null>) {
  const pinnedSet = new Set(pinnedIds.filter((id): id is number => typeof id === "number"));
  const pinned = items.filter((item) => pinnedSet.has(item.id));
  const rest = items.filter((item) => !pinnedSet.has(item.id));
  const combined = [...pinned, ...rest];
  return {
    items: combined.slice(0, limit),
    total: combined.length,
    truncated: combined.length > limit,
  };
}

export default function ClubAdminsBoardPage() {
  const t = useTranslations("LtfAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const memberCardRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const clubCardRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [inviteResetUrl, setInviteResetUrl] = useState<string | null>(null);
  const [members, setMembers] = useState<AssignmentMember[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberTruncated, setMemberTruncated] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [clubs, setClubs] = useState<AssignmentClub[]>([]);
  const [admins, setAdmins] = useState<AssignmentAdmin[]>([]);

  const [licensedOnly, setLicensedOnly] = useState(true);
  const [memberQuery, setMemberQuery] = useState("");
  const [clubQuery, setClubQuery] = useState("");
  const [adminQuery, setAdminQuery] = useState("");
  const [filterClubId, setFilterClubId] = useState<number | null>(null);
  const [memberSearchTick, setMemberSearchTick] = useState(0);
  const [selectedMember, setSelectedMember] = useState<AssignmentMember | null>(null);
  const [connectFrom, setConnectFrom] = useState<"member" | "club" | null>(null);
  const [hoverClubId, setHoverClubId] = useState<number | null>(null);
  const [hoverMemberId, setHoverMemberId] = useState<number | null>(null);
  const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);
  const isLg = useMinWidth("(min-width: 1024px)");
  const [pointer, setPointer] = useState<Point | null>(null);
  const [lineFrom, setLineFrom] = useState<Point | null>(null);
  const [lineTo, setLineTo] = useState<Point | null>(null);

  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null);
  const [emailValue, setEmailValue] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showCrossClubModal, setShowCrossClubModal] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{
    admin: AssignmentAdmin;
    club: AssignmentAdminClub | AssignmentClub;
  } | null>(null);

  const loadBoard = useCallback(async () => {
    setErrorMessage(null);
    try {
      const response = await getClubAdminAssignment();
      setClubs(response.clubs);
      setAdmins(response.admins);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const selectedAdmin = useMemo(
    () => admins.find((admin) => admin.id === selectedAdminId) ?? null,
    [admins, selectedAdminId]
  );
  const filterClub = useMemo(
    () => clubs.find((club) => club.id === filterClubId) ?? null,
    [clubs, filterClubId]
  );

  const memberSearchReady = Boolean(filterClubId) || memberQuery.trim().length >= 2;
  const clubLimit = isLg ? CLUB_RESULT_LIMIT : 8;

  useEffect(() => {
    setSelectedMember((current) => {
      if (!current) {
        return current;
      }
      return members.find((member) => member.id === current.id) ?? current;
    });
  }, [members]);

  useEffect(() => {
    if (!memberSearchReady) {
      setMembers([]);
      setMemberTotal(0);
      setMemberTruncated(false);
      setMembersLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMembersLoading(true);
      try {
        const result = await searchClubAdminAssignmentMembers({
          query: memberQuery,
          clubId: filterClubId,
          licensedOnly,
          signal: controller.signal,
        });
        setMembers(result.members);
        setMemberTotal(result.total);
        setMemberTruncated(result.truncated);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
      } finally {
        if (!controller.signal.aborted) {
          setMembersLoading(false);
        }
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [filterClubId, licensedOnly, memberQuery, memberSearchReady, memberSearchTick, t]);

  const visibleMembers = useMemo(() => {
    if (!selectedMember) {
      return members;
    }
    if (members.some((member) => member.id === selectedMember.id)) {
      return members;
    }
    return [selectedMember, ...members];
  }, [members, selectedMember]);

  const clubResults = useMemo(() => {
    const query = clubQuery.trim().toLowerCase();
    const ranked = [...clubs]
      .filter((club) => matchesQuery(`${club.name} ${club.locality}`, query))
      .sort((left, right) => {
        if (left.admin_count === 0 && right.admin_count !== 0) {
          return -1;
        }
        if (right.admin_count === 0 && left.admin_count !== 0) {
          return 1;
        }
        return left.name.localeCompare(right.name);
      });
    return pinAndLimit(ranked, clubLimit, [filterClubId]);
  }, [clubLimit, clubQuery, clubs, filterClubId]);

  const compactSelectedClub = !isLg && Boolean(filterClub) && !clubQuery.trim();
  const visibleClubs = compactSelectedClub && filterClub ? [filterClub] : clubResults.items;
  const memberResults = useMemo(
    () => pinAndLimit(visibleMembers, isLg ? 25 : 8, [selectedMember?.id ?? null]),
    [isLg, selectedMember?.id, visibleMembers]
  );
  const shownMembers = memberResults.items;
  const membersAreTruncated = memberTruncated || memberResults.truncated;
  const showMemberPane = memberSearchReady || shownMembers.length > 0;

  const adminResults = useMemo(() => {
    const query = adminQuery.trim().toLowerCase();
    const ranked = admins.filter((admin) =>
      matchesQuery(
        `${displayAdminName(admin)} ${admin.username} ${admin.email} ${admin.clubs.map((club) => club.name).join(" ")}`,
        query
      )
    );
    return pinAndLimit(ranked, ADMIN_RESULT_LIMIT, [selectedAdminId]);
  }, [adminQuery, admins, selectedAdminId]);

  const visibleAdmins = adminResults.items;

  const rosterClubs = useMemo(() => {
    if (!selectedAdmin) {
      return [];
    }
    return selectedAdmin.clubs;
  }, [selectedAdmin]);

  const updateLine = useCallback(() => {
    const container = boardRef.current;
    const originEl =
      connectFrom === "member" && selectedMember
        ? memberCardRefs.current[selectedMember.id]
        : connectFrom === "club" && filterClub
          ? clubCardRefs.current[filterClub.id]
          : null;
    if (!container || !originEl) {
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const targetEl =
      connectFrom === "member" && hoverClubId
        ? clubCardRefs.current[hoverClubId]
        : connectFrom === "club" && hoverMemberId
          ? memberCardRefs.current[hoverMemberId]
          : null;
    const toward = targetEl ? cardCenter(targetEl, container) : pointer;
    if (!toward) {
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const from = facingAnchor(originEl, container, toward);
    setLineFrom(from);
    setLineTo(targetEl ? facingAnchor(targetEl, container, from) : toward);
  }, [connectFrom, filterClub, hoverClubId, hoverMemberId, pointer, selectedMember]);

  useEffect(() => {
    updateLine();
  }, [updateLine, shownMembers.length, visibleClubs.length, showMemberPane]);

  useEffect(() => {
    if (!connectFrom) {
      setPointer(null);
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const onMove = (event: PointerEvent) => {
      const container = boardRef.current;
      if (!container) {
        return;
      }
      const origin = container.getBoundingClientRect();
      setPointer({ x: event.clientX - origin.left, y: event.clientY - origin.top });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedMember(null);
        setConnectFrom(null);
        setHoverClubId(null);
        setHoverMemberId(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [connectFrom]);

  const dismissNotice = useCallback(() => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setInviteResetUrl(null);
  }, []);

  const noticeOpen = Boolean(errorMessage || successMessage);
  const noticeToken = `${errorMessage ?? ""}::${successMessage ?? ""}::${inviteResetUrl ?? ""}`;

  useEffect(() => {
    if (!noticeOpen) {
      return;
    }
    const timer = window.setTimeout(dismissNotice, inviteResetUrl ? 12000 : 7000);
    return () => window.clearTimeout(timer);
  }, [noticeOpen, noticeToken, inviteResetUrl, dismissNotice]);

  const dropRubberBand = () => {
    setSelectedMember(null);
    setConnectFrom(null);
    setHoverClubId(null);
    setHoverMemberId(null);
    setPointer(null);
    setLineFrom(null);
    setLineTo(null);
  };

  const resetConnect = () => {
    dropRubberBand();
    setPendingAssign(null);
    setShowEmailModal(false);
    setShowCrossClubModal(false);
    setEmailValue("");
    setEmailError(null);
  };

  const mapAssignError = (message: string) => {
    if (message === "email_required") {
      return t("emailRequiredDescription");
    }
    if (message === "already_admin") {
      return t("alreadyAdminError");
    }
    if (message === "email_in_use") {
      return t("emailInUseError");
    }
    if (message === "Club admin limit reached.") {
      return t("adminLimitReached");
    }
    return message;
  };

  const completeAssign = async (pending: PendingAssign, email?: string) => {
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setInviteResetUrl(null);
    try {
      const response: AddClubAdminResponse = await addClubAdmin(
        pending.club.id,
        pending.member.id,
        email,
        locale
      );
      const name = displayMemberName(pending.member);
      if (response.linked_existing_user) {
        setSuccessMessage(
          t("linkedExistingUserNotice", {
            username: response.username,
            name,
            club: pending.club.name,
          })
        );
      } else if (response.created_user && response.email_sent) {
        setSuccessMessage(
          t("assignedCreatedSuccess", {
            name,
            club: pending.club.name,
            username: response.username,
          })
        );
      } else if (response.created_user) {
        setSuccessMessage(
          t("assignedCreatedEmailFailed", {
            name,
            club: pending.club.name,
            username: response.username,
          })
        );
        setInviteResetUrl(response.reset_url || null);
      } else {
        setSuccessMessage(t("assignedSuccess", { name, club: pending.club.name }));
      }
      resetConnect();
      setFilterClubId(pending.club.id);
      setMemberSearchTick((tick) => tick + 1);
      await loadBoard();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add club admin.";
      if (message === "email_required") {
        dropRubberBand();
        setPendingAssign(pending);
        setShowCrossClubModal(false);
        setShowEmailModal(true);
        setEmailError(null);
      } else {
        setErrorMessage(mapAssignError(message));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const beginAssign = (member: AssignmentMember, club: AssignmentClub) => {
    if (member.administered_club_ids.includes(club.id)) {
      setErrorMessage(t("alreadyAdminError"));
      return;
    }
    if (club.admin_count >= club.max_admins) {
      setErrorMessage(t("adminLimitReached"));
      return;
    }
    const pending = { member, club };
    if (member.club_id !== club.id) {
      dropRubberBand();
      setPendingAssign(pending);
      setShowCrossClubModal(true);
      return;
    }
    if (!member.user_id && !member.email) {
      dropRubberBand();
      setPendingAssign(pending);
      setEmailValue("");
      setEmailError(null);
      setShowEmailModal(true);
      return;
    }
    void completeAssign(pending);
  };

  const handleMemberClick = (member: AssignmentMember) => {
    setSuccessMessage(null);
    setErrorMessage(null);
    if (connectFrom === "club" && filterClub) {
      beginAssign(member, filterClub);
      return;
    }
    if (selectedMember?.id === member.id) {
      setSelectedMember(null);
      setConnectFrom(null);
      return;
    }
    setSelectedMember(member);
    setConnectFrom("member");
    setHoverMemberId(null);
    setSelectedAdminId(null);
  };

  const handleClubClick = (club: AssignmentClub) => {
    setSuccessMessage(null);
    setErrorMessage(null);
    if (connectFrom === "member" && selectedMember) {
      beginAssign(selectedMember, club);
      return;
    }
    if (filterClubId === club.id) {
      setFilterClubId(null);
      if (connectFrom === "club") {
        setConnectFrom(null);
        setHoverMemberId(null);
      }
      return;
    }
    setSelectedMember(null);
    setConnectFrom("club");
    setFilterClubId(club.id);
    setHoverClubId(null);
    setSelectedAdminId(null);
  };

  const confirmEmailAssign = () => {
    if (!pendingAssign) {
      return;
    }
    if (!isValidEmail(emailValue)) {
      setEmailError(t("emailRequiredError"));
      return;
    }
    void completeAssign(pendingAssign, emailValue.trim());
  };

  const confirmCrossClub = () => {
    if (!pendingAssign) {
      return;
    }
    setShowCrossClubModal(false);
    if (!pendingAssign.member.user_id && !pendingAssign.member.email) {
      dropRubberBand();
      setEmailValue("");
      setEmailError(null);
      setShowEmailModal(true);
      return;
    }
    void completeAssign(pendingAssign);
  };

  const confirmRemove = async () => {
    if (!pendingRemove) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await removeClubAdmin(pendingRemove.club.id, pendingRemove.admin.id);
      setSuccessMessage(
        t("removedAdminSuccess", {
          name: displayAdminName(pendingRemove.admin),
          club: pendingRemove.club.name,
        })
      );
      setPendingRemove(null);
      setMemberSearchTick((tick) => tick + 1);
      await loadBoard();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to remove club admin.");
    } finally {
      setIsSaving(false);
    }
  };

  const connecting = connectFrom !== null;

  return (
    <LtfAdminLayout title={t("clubAdminsBoardTitle")} subtitle={t("clubAdminsBoardSubtitle")}>
      <div className="space-y-6">
        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : (
          <>
            <FormPanel>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-section text-foreground">{t("assignBoardTitle")}</h2>
                  <p className="mt-1 text-sm text-muted">{t("assignBoardSearchSubtitle")}</p>
                </div>
                <Switch
                  id="licensed-only"
                  checked={licensedOnly}
                  onCheckedChange={setLicensedOnly}
                  label={t("licensedOnlyLabel")}
                />
              </div>
              <p className="mt-2 text-xs text-muted">{t("licensedOnlyHint")}</p>
              {connecting && connectFrom === "member" && selectedMember ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-form)] border border-primary/40 bg-[var(--accent-soft)] px-3 py-2">
                  <p className="text-sm text-foreground">
                    {t("connectingHint", { name: displayMemberName(selectedMember) })}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={resetConnect}>
                    {t("cancelConnectAction")}
                  </Button>
                </div>
              ) : connecting && connectFrom === "club" && filterClub ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-form)] border border-primary/40 bg-[var(--accent-soft)] px-3 py-2">
                  <p className="text-sm text-foreground">
                    {t("connectingClubHint", { club: filterClub.name })}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={resetConnect}>
                    {t("cancelConnectAction")}
                  </Button>
                </div>
              ) : filterClub ? null : (
                <p className="mt-4 text-sm text-muted">{t("assignBoardIdleHint")}</p>
              )}
              {filterClub ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-chip)] border border-border bg-secondary px-3 py-1.5 text-sm">
                  <span>{t("filterClubChipLabel", { club: filterClub.name })}</span>
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-[var(--radius-form)] hover:bg-background"
                    onClick={() => {
                      setFilterClubId(null);
                      if (connectFrom === "club") {
                        dropRubberBand();
                      }
                    }}
                    aria-label={t("clearClubFilter")}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    value={clubQuery}
                    onChange={(event) => setClubQuery(event.target.value)}
                    placeholder={t("searchAssignableClubsPlaceholder")}
                    aria-label={t("searchAssignableClubsPlaceholder")}
                  />
                  {clubResults.truncated && !compactSelectedClub ? (
                    <p className="mt-2 text-xs text-muted">
                      {t("searchResultsNarrowHint", {
                        shown: visibleClubs.length,
                        total: clubResults.total,
                      })}
                    </p>
                  ) : compactSelectedClub ? (
                    <p className="mt-2 text-xs text-muted">{t("clubsCompactHint")}</p>
                  ) : clubQuery.trim() ? null : (
                    <p className="mt-2 text-xs text-muted">{t("clubsSearchIdle")}</p>
                  )}
                </div>
                <div>
                  <Input
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder={t("searchAssignableMembersPlaceholder")}
                    aria-label={t("searchAssignableMembersPlaceholder")}
                  />
                  {membersAreTruncated ? (
                    <p className="mt-2 text-xs text-muted">
                      {t("searchResultsNarrowHint", {
                        shown: shownMembers.length,
                        total: Math.max(memberTotal, memberResults.total),
                      })}
                    </p>
                  ) : memberSearchReady ? null : (
                    <p className="mt-2 text-xs text-muted">{t("membersSearchIdle")}</p>
                  )}
                </div>
              </div>

              <div
                ref={boardRef}
                className={cn("relative mt-4 grid gap-4", showMemberPane && "lg:grid-cols-2")}
              >
                {lineFrom && lineTo ? (
                  <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
                    <path
                      d={curvePath(lineFrom, lineTo)}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <circle cx={lineFrom.x} cy={lineFrom.y} r="4" fill="var(--primary)" />
                    <circle cx={lineTo.x} cy={lineTo.y} r="4" fill="var(--primary)" />
                  </svg>
                ) : null}

                <div className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-border bg-[var(--surface-secondary)] p-3">
                  <div className="space-y-2">
                    {visibleClubs.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted">
                        {t("noAssignableClubsSubtitle")}
                      </p>
                    ) : (
                      visibleClubs.map((club) => {
                        const isHome = selectedMember?.club_id === club.id;
                        const already =
                          selectedMember?.administered_club_ids.includes(club.id) ?? false;
                        const atLimit = club.admin_count >= club.max_admins;
                        const filtered = filterClubId === club.id;
                        return (
                          <button
                            key={club.id}
                            type="button"
                            ref={(node) => {
                              clubCardRefs.current[club.id] = node;
                            }}
                            onMouseEnter={() =>
                              connectFrom === "member" && setHoverClubId(club.id)
                            }
                            onMouseLeave={() =>
                              setHoverClubId((current) => (current === club.id ? null : current))
                            }
                            onClick={() => handleClubClick(club)}
                            disabled={isSaving}
                            className={cn(
                              CARD_BASE,
                              filtered || hoverClubId === club.id ? CARD_SELECTED : CARD_IDLE,
                              atLimit && !already ? "opacity-80" : null
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-medium text-foreground">{club.name}</p>
                                {club.locality ? (
                                  <p className="mt-0.5 text-xs text-muted">{club.locality}</p>
                                ) : null}
                              </div>
                              <span className="text-xs text-muted">
                                {t("adminCountLabel", {
                                  count: club.admin_count,
                                  max: club.max_admins,
                                })}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {club.admin_count === 0 ? (
                                <StatusBadge label={t("noAdminBadge")} tone="warning" />
                              ) : null}
                              {isHome ? <StatusBadge label={t("homeClubBadge")} tone="info" /> : null}
                              {already ? (
                                <StatusBadge label={t("alreadyAdminBadge")} tone="success" />
                              ) : null}
                              {atLimit ? (
                                <StatusBadge label={t("atLimitBadge")} tone="danger" />
                              ) : null}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {showMemberPane ? (
                  <div className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-border bg-[var(--surface-secondary)] p-3">
                    <div className="space-y-2">
                      {membersLoading && shownMembers.length === 0 ? (
                        <p className="px-2 py-6 text-center text-sm text-muted">{t("loadingTitle")}</p>
                      ) : shownMembers.length === 0 ? (
                        <p className="px-2 py-6 text-center text-sm text-muted">
                          {licensedOnly
                            ? t("noAssignableMembersLicensedSubtitle")
                            : t("noAssignableMembersSubtitle")}
                        </p>
                      ) : (
                        shownMembers.map((member) => {
                          const selected =
                            member.id === selectedMember?.id || member.id === hoverMemberId;
                          return (
                            <button
                              key={member.id}
                              type="button"
                              ref={(node) => {
                                memberCardRefs.current[member.id] = node;
                              }}
                              onMouseEnter={() =>
                                connectFrom === "club" && setHoverMemberId(member.id)
                              }
                              onMouseLeave={() =>
                                setHoverMemberId((current) =>
                                  current === member.id ? null : current
                                )
                              }
                              onClick={() => handleMemberClick(member)}
                              disabled={isSaving}
                              className={cn(CARD_BASE, selected ? CARD_SELECTED : CARD_IDLE)}
                            >
                              <p className="font-medium text-foreground">
                                {displayMemberName(member)}
                              </p>
                              <p className="mt-0.5 text-xs text-muted">
                                {t("memberHomeClubLabel", { club: member.club_name })}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {member.has_valid_license ? (
                                  <StatusBadge label={t("validLicenseBadge")} tone="success" />
                                ) : (
                                  <StatusBadge label={t("noLicenseBadge")} tone="warning" />
                                )}
                                {member.user_id ? (
                                  <StatusBadge label={t("hasLoginBadge")} tone="info" />
                                ) : null}
                                {!member.email ? (
                                  <StatusBadge label={t("noEmailBadge")} tone="warning" />
                                ) : null}
                                {member.administered_club_ids.length > 0 ? (
                                  <StatusBadge
                                    label={t("clubsAdministeredCount", {
                                      count: member.administered_club_ids.length,
                                    })}
                                    tone="neutral"
                                  />
                                ) : null}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </FormPanel>

            <FormPanel>
              <h2 className="text-section text-foreground">{t("rosterBoardTitle")}</h2>
              <p className="mt-1 text-sm text-muted">{t("rosterBoardSubtitle")}</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col rounded-[var(--radius-card)] border border-border bg-[var(--surface-secondary)] p-3">
                  <Input
                    value={adminQuery}
                    onChange={(event) => setAdminQuery(event.target.value)}
                    placeholder={t("searchRosterAdminsPlaceholder")}
                    aria-label={t("searchRosterAdminsPlaceholder")}
                  />
                  {adminResults.truncated ? (
                    <p className="mt-2 text-xs text-muted">
                      {t("searchResultsNarrowHint", {
                        shown: visibleAdmins.length,
                        total: adminResults.total,
                      })}
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {visibleAdmins.length === 0 ? (
                      <EmptyState
                        title={t("noRosterAdminsTitle")}
                        description={t("noRosterAdminsSubtitle")}
                      />
                    ) : (
                      visibleAdmins.map((admin) => {
                        const selected = admin.id === selectedAdminId;
                        return (
                          <button
                            key={admin.id}
                            type="button"
                            onClick={() =>
                              setSelectedAdminId((current) => (current === admin.id ? null : admin.id))
                            }
                            className={cn(CARD_BASE, selected ? CARD_SELECTED : CARD_IDLE)}
                          >
                            <p className="font-medium text-foreground">{displayAdminName(admin)}</p>
                            <p className="mt-0.5 text-xs text-muted">
                              {admin.username}
                              {admin.email ? ` · ${admin.email}` : ""}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {!admin.member_id ? (
                                <StatusBadge label={t("unlinkedLoginBadge")} tone="warning" />
                              ) : admin.home_club_name ? (
                                <StatusBadge
                                  label={t("memberHomeClubLabel", { club: admin.home_club_name })}
                                  tone="info"
                                />
                              ) : null}
                              {!admin.email ? (
                                <StatusBadge label={t("noEmailBadge")} tone="warning" />
                              ) : null}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {admin.clubs.map((club) => (
                                <span
                                  key={club.id}
                                  className="inline-flex items-center gap-1 rounded-[var(--radius-chip)] border border-border bg-secondary px-2 py-1 text-xs"
                                >
                                  {club.name}
                                  <button
                                    type="button"
                                    className="inline-flex size-5 items-center justify-center rounded hover:bg-background"
                                    aria-label={t("disconnectClubAction")}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPendingRemove({ admin, club });
                                    }}
                                  >
                                    <X className="size-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="flex flex-col rounded-[var(--radius-card)] border border-border bg-[var(--surface-secondary)] p-3">
                  <p className="text-sm font-medium text-foreground">
                    {selectedAdmin
                      ? t("clubsAdministeredCount", { count: selectedAdmin.clubs.length })
                      : t("selectAdminToInspect")}
                  </p>
                  <div className="mt-3 space-y-2">
                    {!selectedAdmin ? (
                      <p className="mt-2 text-sm text-muted">{t("selectAdminToInspect")}</p>
                    ) : rosterClubs.length === 0 ? (
                      <EmptyState title={t("noAssignableClubsTitle")} />
                    ) : (
                      rosterClubs.map((club) => (
                        <div
                          key={club.id}
                          className="flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-border bg-[var(--surface)] px-3 py-3"
                        >
                          <p className="font-medium text-foreground">{club.name}</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setPendingRemove({ admin: selectedAdmin, club })}
                          >
                            {t("removeAdminAction")}
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </FormPanel>
          </>
        )}
      </div>

      <FloatingNotice
        open={noticeOpen}
        token={noticeToken}
        tone={errorMessage || inviteResetUrl ? "danger" : "success"}
        onDismiss={dismissNotice}
        dismissLabel={common("modalClose")}
      >
        {errorMessage || successMessage}
        {inviteResetUrl ? (
          <>
            {" "}
            <a href={inviteResetUrl} className="break-all underline">
              {inviteResetUrl}
            </a>
          </>
        ) : null}
      </FloatingNotice>

      <Modal
        title={t("emailRequiredTitle")}
        description={t("emailRequiredDescription")}
        isOpen={showEmailModal}
        onClose={resetConnect}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("emailInputLabel")}</label>
            <Input
              type="email"
              value={emailValue}
              onChange={(event) => setEmailValue(event.target.value)}
              placeholder={t("emailInputPlaceholder")}
              autoFocus
            />
            {emailError ? <p className="text-sm text-destructive">{emailError}</p> : null}
            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={confirmEmailAssign} disabled={isSaving}>
              {t("emailConfirmAction")}
            </Button>
            <Button type="button" variant="outline" onClick={resetConnect}>
              {t("emailCancelAction")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        title={t("crossClubTitle")}
        description={
          pendingAssign
            ? t("crossClubDescription", {
                name: displayMemberName(pendingAssign.member),
                homeClub: pendingAssign.member.club_name,
                club: pendingAssign.club.name,
              })
            : undefined
        }
        isOpen={showCrossClubModal}
        onClose={resetConnect}
      >
        {errorMessage ? (
          <p className="mb-4 text-sm text-destructive">{errorMessage}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={confirmCrossClub} disabled={isSaving}>
            {t("crossClubConfirmAction")}
          </Button>
          <Button type="button" variant="outline" onClick={resetConnect}>
            {t("emailCancelAction")}
          </Button>
        </div>
      </Modal>

      <DeleteConfirmModal
        isOpen={Boolean(pendingRemove)}
        title={t("removeAdminConfirmTitle")}
        description={
          pendingRemove
            ? t("removeAdminConfirmDescription", {
                name: displayAdminName(pendingRemove.admin),
                club: pendingRemove.club.name,
              })
            : ""
        }
        confirmLabel={t("removeAdminAction")}
        cancelLabel={t("emailCancelAction")}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingRemove(null)}
      />
    </LtfAdminLayout>
  );
}
