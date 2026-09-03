"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { useClubSelection } from "@/components/club-selection-provider";
import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FloatingNotice, FormPanel } from "@/components/ui/list-page-chrome";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  MemberTransfer,
  TransferClub,
  TransferMember,
  acceptMemberTransfer,
  addMemberTransferMessage,
  cancelMemberTransfer,
  createMemberTransfer,
  getMemberTransfers,
  rejectMemberTransfer,
  searchTransferClubs,
  searchTransferMembers,
} from "@/lib/club-admin-api";

type Point = { x: number; y: number };

const CARD_BASE =
  "w-full rounded-[var(--radius-card)] border-2 bg-[var(--surface)] px-3 py-3 text-left transition-colors";
const CARD_SELECTED = "border-primary";
const CARD_IDLE = "border-border hover:border-primary/50";

function displayMemberName(member: { first_name: string; last_name: string }) {
  return `${member.first_name} ${member.last_name}`.trim();
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

export default function ClubTransfersPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { selectedClubId, clubs, isLoading: clubsLoading } = useClubSelection();
  const selectedClub = clubs.find((club) => club.id === selectedClubId) ?? null;

  const boardRef = useRef<HTMLDivElement | null>(null);
  const memberCardRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const clubCardRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const [memberQuery, setMemberQuery] = useState("");
  const [clubQuery, setClubQuery] = useState("");
  const [members, setMembers] = useState<TransferMember[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberTruncated, setMemberTruncated] = useState(false);
  const [destClubs, setDestClubs] = useState<TransferClub[]>([]);
  const [clubTotal, setClubTotal] = useState(0);
  const [clubTruncated, setClubTruncated] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [clubsSearching, setClubsSearching] = useState(false);
  const [transfers, setTransfers] = useState<MemberTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [selectedMember, setSelectedMember] = useState<TransferMember | null>(null);
  const [hoverClubId, setHoverClubId] = useState<number | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [lineFrom, setLineFrom] = useState<Point | null>(null);
  const [lineTo, setLineTo] = useState<Point | null>(null);

  const [pendingMember, setPendingMember] = useState<TransferMember | null>(null);
  const [pendingClub, setPendingClub] = useState<TransferClub | null>(null);
  const [feeValue, setFeeValue] = useState("0");
  const [noteValue, setNoteValue] = useState("");
  const [selectedTransferId, setSelectedTransferId] = useState<number | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const didScrollToRequests = useRef(false);

  const loadTransfers = useCallback(async () => {
    try {
      const rows = await getMemberTransfers();
      setTransfers(rows);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    if (didScrollToRequests.current || isLoading || clubsLoading) {
      return;
    }
    const shouldFocusRequests =
      searchParams.get("focus") === "requests" ||
      (typeof window !== "undefined" && window.location.hash === "#requests");
    if (!shouldFocusRequests) {
      return;
    }
    const firstIncoming = transfers.find(
      (item) => item.status === "pending" && item.to_club.id === selectedClubId
    );
    if (firstIncoming && !selectedTransferId) {
      setSelectedTransferId(firstIncoming.id);
      return;
    }
    const target = document.getElementById("requests");
    if (!target) {
      return;
    }
    didScrollToRequests.current = true;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [clubsLoading, isLoading, searchParams, selectedClubId, selectedTransferId, transfers]);

  useEffect(() => {
    if (!selectedClubId) {
      setMembers([]);
      setDestClubs([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMembersLoading(true);
      setClubsSearching(true);
      try {
        const [memberResult, clubResult] = await Promise.all([
          searchTransferMembers(selectedClubId, memberQuery, { signal: controller.signal }),
          searchTransferClubs(selectedClubId, clubQuery, { signal: controller.signal }),
        ]);
        setMembers(memberResult.members);
        setMemberTotal(memberResult.total);
        setMemberTruncated(memberResult.truncated);
        setDestClubs(clubResult.clubs);
        setClubTotal(clubResult.total);
        setClubTruncated(clubResult.truncated);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
      } finally {
        if (!controller.signal.aborted) {
          setMembersLoading(false);
          setClubsSearching(false);
        }
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [clubQuery, memberQuery, selectedClubId, t]);

  const selectedTransfer = useMemo(
    () => transfers.find((item) => item.id === selectedTransferId) ?? null,
    [selectedTransferId, transfers]
  );

  const connecting = Boolean(selectedMember);

  const dropRubberBand = () => {
    setSelectedMember(null);
    setHoverClubId(null);
    setPointer(null);
    setLineFrom(null);
    setLineTo(null);
  };

  const updateLine = useCallback(() => {
    const container = boardRef.current;
    if (!container || !selectedMember) {
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const originEl = memberCardRefs.current[selectedMember.id];
    if (!originEl) {
      return;
    }
    const hoverEl = hoverClubId ? clubCardRefs.current[hoverClubId] : null;
    const toward = hoverEl ? cardCenter(hoverEl, container) : pointer;
    if (!toward) {
      setLineFrom(null);
      setLineTo(null);
      return;
    }
    const from = facingAnchor(originEl, container, toward);
    setLineFrom(from);
    setLineTo(hoverEl ? facingAnchor(hoverEl, container, from) : toward);
  }, [hoverClubId, pointer, selectedMember]);

  useEffect(() => {
    updateLine();
  }, [updateLine, members.length, destClubs.length]);

  useEffect(() => {
    if (!selectedMember) {
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
        dropRubberBand();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [selectedMember]);

  const mapError = (message: string) => {
    if (message === "member_is_club_admin") {
      return t("transferMemberIsAdminError");
    }
    if (message === "pending_transfer_exists") {
      return t("transferPendingExistsError");
    }
    if (message === "destination_has_no_admin") {
      return t("transferNoDestAdminError");
    }
    if (message === "same_club") {
      return t("transferSameClubError");
    }
    return message;
  };

  const openFeeModal = (club: TransferClub) => {
    if (!selectedMember) {
      return;
    }
    if (selectedMember.is_club_admin) {
      setErrorMessage(t("transferMemberIsAdminError"));
      return;
    }
    if (selectedMember.pending_transfer) {
      setErrorMessage(t("transferPendingExistsError"));
      return;
    }
    setPendingMember(selectedMember);
    setPendingClub(club);
    setFeeValue("0");
    setNoteValue("");
    dropRubberBand();
  };

  const submitTransfer = async () => {
    if (!pendingMember || !pendingClub || !selectedClubId) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const created = await createMemberTransfer({
        memberId: pendingMember.id,
        toClubId: pendingClub.id,
        fromClubId: selectedClubId,
        feeAmount: feeValue.trim() || "0",
        note: noteValue.trim(),
        locale,
      });
      setSuccessMessage(
        t("transferRequestedSuccess", {
          name: displayMemberName(pendingMember),
          club: pendingClub.name,
        })
      );
      setPendingClub(null);
      setPendingMember(null);
      setSelectedTransferId(created.id);
      setMemberQuery((value) => `${value}`);
      await loadTransfers();
    } catch (error) {
      setErrorMessage(mapError(error instanceof Error ? error.message : t("overviewLoadError")));
    } finally {
      setIsSaving(false);
    }
  };

  const runDecision = async (action: "accept" | "reject" | "cancel") => {
    if (!selectedTransfer) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const updated =
        action === "accept"
          ? await acceptMemberTransfer(selectedTransfer.id, locale)
          : action === "reject"
            ? await rejectMemberTransfer(selectedTransfer.id, locale)
            : await cancelMemberTransfer(selectedTransfer.id, locale);
      setTransfers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setSelectedTransferId(updated.id);
      setSuccessMessage(t("transferUpdatedSuccess"));
      await loadTransfers();
    } catch (error) {
      setErrorMessage(mapError(error instanceof Error ? error.message : t("overviewLoadError")));
    } finally {
      setIsSaving(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedTransfer || !messageBody.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      const updated = await addMemberTransferMessage(selectedTransfer.id, messageBody.trim());
      setTransfers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setMessageBody("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
    } finally {
      setIsSaving(false);
    }
  };

  const noticeOpen = Boolean(errorMessage || successMessage);
  const incoming = transfers.filter((item) => item.to_club.id === selectedClubId);
  const outgoing = transfers.filter((item) => item.from_club.id === selectedClubId);

  return (
    <ClubAdminLayout title={t("transfersTitle")} subtitle={t("transfersSubtitle")}>
      <div className="space-y-6">
        {clubsLoading || isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : !selectedClub ? (
          <EmptyState title={t("overviewEmptyTitle")} description={t("selectClubPlaceholder")} />
        ) : (
          <>
            <FormPanel>
              <h2 className="text-section text-foreground">{t("transferBoardTitle")}</h2>
              <p className="mt-1 text-sm text-muted">{t("transferBoardSubtitle")}</p>
              {connecting && selectedMember ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-form)] border border-primary/40 bg-[var(--accent-soft)] px-3 py-2">
                  <p className="text-sm text-foreground">
                    {t("transferConnectingHint", { name: displayMemberName(selectedMember) })}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={dropRubberBand}>
                    {t("transferCancelConnect")}
                  </Button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted">{t("transferIdleHint")}</p>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder={t("transferSearchMembersPlaceholder")}
                  />
                  {memberTruncated ? (
                    <p className="mt-2 text-xs text-muted">
                      {t("transferNarrowHint", { shown: members.length, total: memberTotal })}
                    </p>
                  ) : null}
                </div>
                <div>
                  <Input
                    value={clubQuery}
                    onChange={(event) => setClubQuery(event.target.value)}
                    placeholder={t("transferSearchClubsPlaceholder")}
                  />
                  {clubTruncated ? (
                    <p className="mt-2 text-xs text-muted">
                      {t("transferNarrowHint", { shown: destClubs.length, total: clubTotal })}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted">{t("transferClubsIdle")}</p>
                  )}
                </div>
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
                  <div className="space-y-2">
                    {membersLoading && members.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted">{t("loadingTitle")}</p>
                    ) : members.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted">
                        {t("transferNoMembers")}
                      </p>
                    ) : (
                      members.map((member) => {
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
                              setSelectedMember((current) =>
                                current?.id === member.id ? null : member
                              );
                            }}
                            className={cn(CARD_BASE, selected ? CARD_SELECTED : CARD_IDLE)}
                          >
                            <p className="font-medium text-foreground">{displayMemberName(member)}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {member.has_valid_license ? (
                                <StatusBadge label={t("transferLicensedBadge")} tone="success" />
                              ) : (
                                <StatusBadge label={t("transferNoLicenseBadge")} tone="warning" />
                              )}
                              {member.pending_transfer ? (
                                <StatusBadge label={t("transferPendingBadge")} tone="info" />
                              ) : null}
                              {member.is_club_admin ? (
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
                  <div className="space-y-2">
                    {clubsSearching && destClubs.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted">{t("loadingTitle")}</p>
                    ) : destClubs.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted">
                        {t("transferNoClubs")}
                      </p>
                    ) : (
                      destClubs.map((club) => (
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
                          onClick={() => {
                            if (selectedMember) {
                              openFeeModal(club);
                            }
                          }}
                          className={cn(
                            CARD_BASE,
                            hoverClubId === club.id ? CARD_SELECTED : CARD_IDLE
                          )}
                        >
                          <p className="font-medium text-foreground">{club.name}</p>
                          {club.locality ? (
                            <p className="mt-0.5 text-xs text-muted">{club.locality}</p>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </FormPanel>

            <FormPanel>
              <h2
                id="requests"
                className="text-section scroll-mt-24 text-foreground"
              >
                {t("transferInboxTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("transferInboxSubtitle")}</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">{t("transferIncomingLabel")}</p>
                  {incoming.length === 0 ? (
                    <p className="text-sm text-muted">{t("transferInboxEmpty")}</p>
                  ) : (
                    incoming.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedTransferId(item.id)}
                        className={cn(
                          CARD_BASE,
                          item.id === selectedTransferId ? CARD_SELECTED : CARD_IDLE
                        )}
                      >
                        <p className="font-medium text-foreground">
                          {displayMemberName(item.member)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {item.from_club.name} → {item.to_club.name}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusBadge label={item.status} tone="info" />
                          {item.has_fee ? (
                            <StatusBadge
                              label={`${item.fee_amount} ${item.fee_currency}`}
                              tone="warning"
                            />
                          ) : (
                            <StatusBadge label={t("transferFreeBadge")} tone="success" />
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">{t("transferOutgoingLabel")}</p>
                  {outgoing.length === 0 ? (
                    <p className="text-sm text-muted">{t("transferInboxEmpty")}</p>
                  ) : (
                    outgoing.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedTransferId(item.id)}
                        className={cn(
                          CARD_BASE,
                          item.id === selectedTransferId ? CARD_SELECTED : CARD_IDLE
                        )}
                      >
                        <p className="font-medium text-foreground">
                          {displayMemberName(item.member)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {item.from_club.name} → {item.to_club.name}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusBadge label={item.status} tone="info" />
                          {item.has_fee ? (
                            <StatusBadge
                              label={`${item.fee_amount} ${item.fee_currency}`}
                              tone="warning"
                            />
                          ) : (
                            <StatusBadge label={t("transferFreeBadge")} tone="success" />
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {selectedTransfer ? (
                <div className="mt-6 space-y-4 rounded-[var(--radius-card)] border border-border p-4">
                  <div>
                    <p className="font-medium text-foreground">
                      {displayMemberName(selectedTransfer.member)}
                    </p>
                    <p className="text-sm text-muted">
                      {selectedTransfer.from_club.name} → {selectedTransfer.to_club.name}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {selectedTransfer.has_fee
                        ? t("transferFeeLabel", {
                            amount: selectedTransfer.fee_amount,
                            currency: selectedTransfer.fee_currency,
                          })
                        : t("transferFreeBadge")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {selectedTransfer.messages.map((message) => (
                      <div
                        key={message.id}
                        className="rounded-[var(--radius-form)] border border-border bg-[var(--surface-secondary)] px-3 py-2"
                      >
                        <p className="text-xs text-muted">
                          {message.author_name} · {message.created_at}
                        </p>
                        <p className="mt-1 text-sm text-foreground">{message.body}</p>
                      </div>
                    ))}
                    {selectedTransfer.messages.length === 0 ? (
                      <p className="text-sm text-muted">{t("transferNoMessages")}</p>
                    ) : null}
                  </div>
                  {selectedTransfer.status === "pending" ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          value={messageBody}
                          onChange={(event) => setMessageBody(event.target.value)}
                          placeholder={t("transferMessagePlaceholder")}
                        />
                        <Button type="button" variant="outline" onClick={() => void sendMessage()} disabled={isSaving}>
                          {t("transferSendMessage")}
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedTransfer.to_club.id === selectedClubId ? (
                          <>
                            <Button type="button" onClick={() => void runDecision("accept")} disabled={isSaving}>
                              {t("transferAcceptAction")}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={() => void runDecision("reject")}
                              disabled={isSaving}
                            >
                              {t("transferRejectAction")}
                            </Button>
                          </>
                        ) : null}
                        {selectedTransfer.from_club.id === selectedClubId ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void runDecision("cancel")}
                            disabled={isSaving}
                          >
                            {t("transferCancelAction")}
                          </Button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </FormPanel>
          </>
        )}
      </div>

      <FloatingNotice
        open={noticeOpen}
        token={`${errorMessage ?? ""}::${successMessage ?? ""}`}
        tone={errorMessage ? "danger" : "success"}
        onDismiss={() => {
          setErrorMessage(null);
          setSuccessMessage(null);
        }}
        dismissLabel={common("modalClose")}
      >
        {errorMessage || successMessage}
      </FloatingNotice>

      <Modal
        title={t("transferFeeTitle")}
        description={
          pendingMember && pendingClub
            ? t("transferFeeDescription", {
                name: displayMemberName(pendingMember),
                club: pendingClub.name,
              })
            : undefined
        }
        isOpen={Boolean(pendingClub)}
        onClose={() => {
          setPendingClub(null);
          setPendingMember(null);
        }}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("transferFeeAmountLabel")}</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={feeValue}
              onChange={(event) => setFeeValue(event.target.value)}
            />
            <p className="text-xs text-muted">{t("transferFeeHint")}</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("transferNoteLabel")}</label>
            <Input
              value={noteValue}
              onChange={(event) => setNoteValue(event.target.value)}
              placeholder={t("transferNotePlaceholder")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void submitTransfer()} disabled={isSaving}>
              {t("transferSendRequest")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingClub(null);
                setPendingMember(null);
              }}
            >
              {t("transferModalCancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </ClubAdminLayout>
  );
}
