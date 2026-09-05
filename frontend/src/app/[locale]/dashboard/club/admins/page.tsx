"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
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
  ClubAdminAssignmentAdmin,
  ClubAdminAssignmentClub,
  ClubAdminAssignmentMember,
  addClubAdmin,
  getClubAdminAssignmentBoard,
  removeClubAdmin,
  searchClubAdminAssignmentMembers,
} from "@/lib/club-admin-api";

type Point = { x: number; y: number };

const CARD_BASE =
  "w-full rounded-[var(--radius-card)] border-2 bg-[var(--surface)] px-3 py-3 text-left transition-colors";
const CARD_SELECTED = "border-primary";
const CARD_IDLE = "border-border hover:border-primary/50";

function displayMemberName(member: ClubAdminAssignmentMember) {
  return `${member.first_name} ${member.last_name}`.trim();
}

function displayAdminName(admin: ClubAdminAssignmentAdmin) {
  const full = `${admin.first_name} ${admin.last_name}`.trim();
  return admin.member_name || full || admin.username;
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

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function ClubAdminsPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();

  const boardRef = useRef<HTMLDivElement | null>(null);
  const memberCardRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const clubCardRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const [clubs, setClubs] = useState<ClubAdminAssignmentClub[]>([]);
  const [admins, setAdmins] = useState<ClubAdminAssignmentAdmin[]>([]);
  const [members, setMembers] = useState<ClubAdminAssignmentMember[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberTruncated, setMemberTruncated] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [filterClubId, setFilterClubId] = useState<number | null>(null);
  const [licensedOnly, setLicensedOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [inviteResetUrl, setInviteResetUrl] = useState<string | null>(null);

  const [selectedMember, setSelectedMember] = useState<ClubAdminAssignmentMember | null>(null);
  const [hoverClubId, setHoverClubId] = useState<number | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [lineFrom, setLineFrom] = useState<Point | null>(null);
  const [lineTo, setLineTo] = useState<Point | null>(null);

  const [pendingMember, setPendingMember] = useState<ClubAdminAssignmentMember | null>(null);
  const [pendingClub, setPendingClub] = useState<ClubAdminAssignmentClub | null>(null);
  const [emailValue, setEmailValue] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{
    admin: ClubAdminAssignmentAdmin;
    club: ClubAdminAssignmentClub;
  } | null>(null);

  const connecting = Boolean(selectedMember);

  const loadBoard = useCallback(async () => {
    setErrorMessage(null);
    try {
      const response = await getClubAdminAssignmentBoard();
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

  useEffect(() => {
    if (clubs.length === 1) {
      setFilterClubId(clubs[0].id);
    }
  }, [clubs]);

  const filterClub = useMemo(
    () => clubs.find((club) => club.id === filterClubId) ?? null,
    [clubs, filterClubId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMembersLoading(true);
      try {
        const result = await searchClubAdminAssignmentMembers({
          query: memberQuery,
          clubId: filterClubId,
          licensedOnly,
          limit: 25,
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
  }, [filterClubId, licensedOnly, memberQuery, t]);

  const visibleMembers = useMemo(() => {
    if (!selectedMember) return members;
    if (members.some((member) => member.id === selectedMember.id)) return members;
    return [selectedMember, ...members];
  }, [members, selectedMember]);

  const updateLine = useCallback(() => {
    const container = boardRef.current;
    const originEl = selectedMember ? memberCardRefs.current[selectedMember.id] : null;
    if (!container || !originEl) {
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const targetEl = hoverClubId ? clubCardRefs.current[hoverClubId] : null;
    const toward = targetEl ? cardCenter(targetEl, container) : pointer;
    if (!toward) {
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const from = facingAnchor(originEl, container, toward);
    setLineFrom(from);
    setLineTo(targetEl ? facingAnchor(targetEl, container, from) : toward);
  }, [hoverClubId, pointer, selectedMember]);

  useEffect(() => {
    updateLine();
  }, [updateLine, visibleMembers.length, clubs.length]);

  useEffect(() => {
    if (!connecting) {
      setPointer(null);
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const onMove = (event: PointerEvent) => {
      const container = boardRef.current;
      if (!container) return;
      const origin = container.getBoundingClientRect();
      setPointer({ x: event.clientX - origin.left, y: event.clientY - origin.top });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedMember(null);
        setHoverClubId(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [connecting]);

  const dropRubberBand = () => {
    setSelectedMember(null);
    setHoverClubId(null);
    setPointer(null);
    setLineFrom(null);
    setLineTo(null);
  };

  const mapAssignError = (message: string) => {
    if (message === "email_required") return t("adminEmailRequired");
    if (message === "already_admin") return t("adminAlreadyError");
    if (message === "email_in_use") return t("adminEmailInUse");
    if (message === "home_club_only") return t("adminHomeClubOnly");
    if (message === "last_admin") return t("adminLastAdminError");
    if (message === "Club admin limit reached.") return t("adminLimitReached");
    return message;
  };

  const completeAssign = async (
    member: ClubAdminAssignmentMember,
    club: ClubAdminAssignmentClub,
    email?: string,
  ) => {
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setInviteResetUrl(null);
    try {
      const response: AddClubAdminResponse = await addClubAdmin(club.id, member.id, email, locale);
      const name = displayMemberName(member);
      if (response.created_user && response.email_sent) {
        setSuccessMessage(t("adminAssignedCreated", { name, club: club.name, username: response.username }));
      } else if (response.created_user) {
        setSuccessMessage(t("adminAssignedCreatedNoEmail", { name, club: club.name, username: response.username }));
        setInviteResetUrl(response.reset_url || null);
      } else {
        setSuccessMessage(t("adminAssignedSuccess", { name, club: club.name }));
      }
      dropRubberBand();
      setShowEmailModal(false);
      setPendingMember(null);
      setPendingClub(null);
      setEmailValue("");
      setFilterClubId(club.id);
      await loadBoard();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("overviewLoadError");
      if (message === "email_required") {
        dropRubberBand();
        setPendingMember(member);
        setPendingClub(club);
        setShowEmailModal(true);
        setEmailError(null);
      } else {
        setErrorMessage(mapAssignError(message));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const beginAssign = (member: ClubAdminAssignmentMember, club: ClubAdminAssignmentClub) => {
    if (member.club_id !== club.id) {
      setErrorMessage(t("adminHomeClubOnly"));
      return;
    }
    if (member.administered_club_ids.includes(club.id)) {
      setErrorMessage(t("adminAlreadyError"));
      return;
    }
    if (club.admin_count >= club.max_admins) {
      setErrorMessage(t("adminLimitReached"));
      return;
    }
    if (!member.user_id && !member.email) {
      dropRubberBand();
      setPendingMember(member);
      setPendingClub(club);
      setEmailValue("");
      setEmailError(null);
      setShowEmailModal(true);
      return;
    }
    void completeAssign(member, club);
  };

  const confirmEmail = () => {
    if (!pendingMember || !pendingClub) return;
    if (!isValidEmail(emailValue)) {
      setEmailError(t("adminEmailInvalid"));
      return;
    }
    void completeAssign(pendingMember, pendingClub, emailValue.trim());
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await removeClubAdmin(pendingRemove.club.id, pendingRemove.admin.id);
      setSuccessMessage(
        t("adminRemovedSuccess", { name: displayAdminName(pendingRemove.admin), club: pendingRemove.club.name }),
      );
      setPendingRemove(null);
      await loadBoard();
    } catch (error) {
      setErrorMessage(mapAssignError(error instanceof Error ? error.message : t("overviewLoadError")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClubClick = (club: ClubAdminAssignmentClub) => {
    setErrorMessage(null);
    if (selectedMember) {
      beginAssign(selectedMember, club);
      return;
    }
    setFilterClubId((current) => (current === club.id ? null : club.id));
  };

  const noticeOpen = Boolean(errorMessage || successMessage);
  const currentAdmins = useMemo(() => {
    if (!filterClubId) return admins;
    return admins.filter((admin) => admin.clubs.some((club) => club.id === filterClubId));
  }, [admins, filterClubId]);

  return (
    <ClubAdminLayout title={t("adminsTitle")} subtitle={t("adminsSubtitle")}>
      <div className="space-y-6">
        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : clubs.length === 0 ? (
          <EmptyState title={t("overviewEmptyTitle")} description={t("selectClubPlaceholder")} />
        ) : (
          <>
            <FormPanel>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-section text-foreground">{t("adminsBoardTitle")}</h2>
                  <p className="mt-1 text-sm text-muted">{t("adminsBoardSubtitle")}</p>
                </div>
                <Switch
                  id="licensed-only-admins"
                  checked={licensedOnly}
                  onCheckedChange={setLicensedOnly}
                  label={t("adminsLicensedOnly")}
                />
              </div>
              {connecting && selectedMember ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-form)] border border-primary/40 bg-[var(--accent-soft)] px-3 py-2">
                  <p className="text-sm text-foreground">
                    {t("adminsConnectingHint", { name: displayMemberName(selectedMember) })}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={dropRubberBand}>
                    {t("transferCancelConnect")}
                  </Button>
                </div>
              ) : filterClub ? (
                <p className="mt-4 text-sm text-muted">
                  {t("adminsClubSelectedHint", { club: filterClub.name })}
                </p>
              ) : (
                <p className="mt-4 text-sm text-muted">{t("adminsIdleHint")}</p>
              )}

              <div className="mt-4">
                <Input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder={t("adminsSearchMembers")}
                />
                {memberTruncated ? (
                  <p className="mt-2 text-xs text-muted">
                    {t("transferNarrowHint", { shown: members.length, total: memberTotal })}
                  </p>
                ) : null}
              </div>

              <div ref={boardRef} className="relative mt-4 grid gap-4 lg:grid-cols-2">
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
                  <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("adminsMembersColumn")}
                  </p>
                  <div className="space-y-2">
                    {membersLoading && visibleMembers.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted">{t("loadingTitle")}</p>
                    ) : visibleMembers.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted">
                        {filterClubId ? t("adminsNoMembers") : t("adminsPickClubFirst")}
                      </p>
                    ) : (
                      visibleMembers.map((member) => {
                        const selected = member.id === selectedMember?.id;
                        return (
                          <button
                            key={member.id}
                            type="button"
                            ref={(node) => {
                              memberCardRefs.current[member.id] = node;
                            }}
                            onClick={() => {
                              setErrorMessage(null);
                              setSelectedMember((current) => (current?.id === member.id ? null : member));
                            }}
                            className={cn(CARD_BASE, selected ? CARD_SELECTED : CARD_IDLE)}
                          >
                            <p className="font-medium text-foreground">{displayMemberName(member)}</p>
                            <p className="mt-0.5 text-xs text-muted">{member.club_name}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {member.has_valid_license ? (
                                <StatusBadge label={t("transferLicensedBadge")} tone="success" />
                              ) : (
                                <StatusBadge label={t("transferNoLicenseBadge")} tone="warning" />
                              )}
                              {member.administered_club_ids.includes(member.club_id) ? (
                                <StatusBadge label={t("transferAdminBadge")} tone="danger" />
                              ) : null}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-border bg-[var(--surface-secondary)] p-3">
                  <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("adminsClubsColumn")}
                  </p>
                  <div className="space-y-2">
                    {clubs.map((club) => {
                      const isHome = selectedMember?.club_id === club.id;
                      const already = selectedMember?.administered_club_ids.includes(club.id) ?? false;
                      const atLimit = club.admin_count >= club.max_admins;
                      const compatible = !selectedMember || isHome;
                      return (
                        <button
                          key={club.id}
                          type="button"
                          ref={(node) => {
                            clubCardRefs.current[club.id] = node;
                          }}
                          disabled={isSaving}
                          onMouseEnter={() => connecting && setHoverClubId(club.id)}
                          onMouseLeave={() =>
                            setHoverClubId((current) => (current === club.id ? null : current))
                          }
                          onClick={() => handleClubClick(club)}
                          className={cn(
                            CARD_BASE,
                            filterClubId === club.id || (hoverClubId === club.id && compatible)
                              ? CARD_SELECTED
                              : CARD_IDLE,
                            !compatible ? "opacity-50" : null,
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-foreground">{club.name}</p>
                              {club.locality ? <p className="mt-0.5 text-xs text-muted">{club.locality}</p> : null}
                            </div>
                            <span className="text-xs text-muted">
                              {t("adminsCountLabel", { count: club.admin_count, max: club.max_admins })}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {isHome ? <StatusBadge label={t("adminsHomeClubBadge")} tone="info" /> : null}
                            {already ? <StatusBadge label={t("adminsAlreadyBadge")} tone="success" /> : null}
                            {atLimit ? <StatusBadge label={t("adminsAtLimitBadge")} tone="danger" /> : null}
                            {selectedMember && !isHome ? (
                              <StatusBadge label={t("adminsOtherClubBadge")} tone="warning" />
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </FormPanel>

            <FormPanel>
              <h2 className="text-section text-foreground">{t("adminsCurrentTitle")}</h2>
              <p className="mt-1 text-sm text-muted">{t("adminsCurrentSubtitle")}</p>
              <div className="mt-4 space-y-2">
                {currentAdmins.length === 0 ? (
                  <p className="text-sm text-muted">{t("adminsCurrentEmpty")}</p>
                ) : (
                  currentAdmins.map((admin) => (
                    <div
                      key={admin.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-foreground">{displayAdminName(admin)}</p>
                        <p className="text-xs text-muted">
                          {admin.username}
                          {admin.email ? ` · ${admin.email}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {admin.clubs.map((club) => club.name).join(", ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {admin.clubs.map((club) => {
                          const full = clubs.find((item) => item.id === club.id);
                          if (!full) return null;
                          return (
                            <Button
                              key={club.id}
                              type="button"
                              variant="outline"
                              onClick={() => setPendingRemove({ admin, club: full })}
                            >
                              {t("adminsRemoveFrom", { club: club.name })}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </FormPanel>
          </>
        )}
      </div>

      <FloatingNotice
        open={noticeOpen}
        token={`${errorMessage ?? ""}::${successMessage ?? ""}::${inviteResetUrl ?? ""}`}
        tone={errorMessage ? "danger" : "success"}
        onDismiss={() => {
          setErrorMessage(null);
          setSuccessMessage(null);
          setInviteResetUrl(null);
        }}
        dismissLabel={common("modalClose")}
      >
        <p>{errorMessage || successMessage}</p>
        {inviteResetUrl ? (
          <p className="mt-2 break-all text-xs">
            {t("adminResetLink")}: {inviteResetUrl}
          </p>
        ) : null}
      </FloatingNotice>

      <Modal
        isOpen={showEmailModal}
        title={t("adminEmailTitle")}
        onClose={() => {
          setShowEmailModal(false);
          setPendingMember(null);
          setPendingClub(null);
        }}
      >
        <p className="text-sm text-muted">{t("adminEmailDescription")}</p>
        <div className="mt-4">
          <Input
            type="email"
            value={emailValue}
            onChange={(event) => setEmailValue(event.target.value)}
            placeholder="name@example.com"
          />
          {emailError ? <p className="mt-2 text-sm text-[var(--danger)]">{emailError}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShowEmailModal(false);
              setPendingMember(null);
              setPendingClub(null);
            }}
          >
            {common("deleteCancelButton")}
          </Button>
          <Button type="button" variant="primary" onClick={confirmEmail} disabled={isSaving}>
            {t("adminsAssignAction")}
          </Button>
        </div>
      </Modal>

      <DeleteConfirmModal
        isOpen={Boolean(pendingRemove)}
        title={t("adminsRemoveTitle")}
        description={
          pendingRemove
            ? t("adminsRemoveDescription", {
                name: displayAdminName(pendingRemove.admin),
                club: pendingRemove.club.name,
              })
            : ""
        }
        confirmLabel={t("adminsRemoveAction")}
        cancelLabel={common("deleteCancelButton")}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => void confirmRemove()}
      />
    </ClubAdminLayout>
  );
}
