"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LicenseHistoryEvent, GradeHistoryEntry } from "@/lib/ltf-admin-api";
import { formatDisplayDate } from "@/lib/date-display";

type HistoryTimelineProps = {
  title: string;
  subtitle: string;
  licenseTitle: string;
  gradeTitle: string;
  emptyLabel: string;
  eventLabel: string;
  reasonLabel: string;
  notesLabel: string;
  fromLabel: string;
  toLabel: string;
  promoteTitle?: string;
  promoteToGradeLabel?: string;
  promoteDateLabel?: string;
  promoteProofLabel?: string;
  promoteNotesLabel?: string;
  promoteSubmitLabel?: string;
  onPromote?: (input: {
    to_grade: string;
    promotion_date?: string;
    proof_ref?: string;
    notes?: string;
  }) => Promise<void>;
  licenseHistory: LicenseHistoryEvent[];
  gradeHistory: GradeHistoryEntry[];
};

function humanizeEventType(value: LicenseHistoryEvent["event_type"]): string {
  switch (value) {
    case "issued":
      return "Issued";
    case "renewed":
      return "Renewed";
    case "status_changed":
      return "Status changed";
    case "expired":
      return "Expired";
    case "revoked":
      return "Revoked";
    case "payment_linked":
      return "Payment linked";
    default:
      return String(value).replace(/_/g, " ");
  }
}

export function MemberHistoryTimeline({
  title,
  subtitle,
  licenseTitle,
  gradeTitle,
  emptyLabel,
  eventLabel,
  reasonLabel,
  notesLabel,
  fromLabel,
  toLabel,
  promoteTitle,
  promoteToGradeLabel,
  promoteDateLabel,
  promoteProofLabel,
  promoteNotesLabel,
  promoteSubmitLabel,
  onPromote,
  licenseHistory,
  gradeHistory,
}: HistoryTimelineProps) {
  // useState stores changeable values for form inputs and status messages.
  const [toGrade, setToGrade] = useState("");
  const [promotionDate, setPromotionDate] = useState("");
  const [proofRef, setProofRef] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submitPromotion = async () => {
    if (!onPromote) {
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await onPromote({
        to_grade: toGrade,
        promotion_date: promotionDate || undefined,
        proof_ref: proofRef || undefined,
        notes: notes || undefined,
      });
      setToGrade("");
      setPromotionDate("");
      setProofRef("");
      setNotes("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save grade promotion.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>

      {onPromote && promoteTitle ? (
        <div className="mt-6 rounded-xl border border-zinc-200 p-4">
          <p className="text-sm font-semibold text-zinc-900">{promoteTitle}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">{promoteToGradeLabel}</p>
              <Input value={toGrade} onChange={(event) => setToGrade(event.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">{promoteDateLabel}</p>
              <Input
                type="date"
                value={promotionDate}
                onChange={(event) => setPromotionDate(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">{promoteProofLabel}</p>
              <Input value={proofRef} onChange={(event) => setProofRef(event.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <p className="text-xs text-zinc-500">{promoteNotesLabel}</p>
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>
          {errorMessage ? <p className="mt-2 text-sm text-red-600">{errorMessage}</p> : null}
          <Button className="mt-3" disabled={isSubmitting || !toGrade.trim()} onClick={submitPromotion}>
            {promoteSubmitLabel}
          </Button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{licenseTitle}</h3>
          <div className="mt-2 space-y-2">
            {licenseHistory.length === 0 ? (
              <p className="text-sm text-zinc-500">{emptyLabel}</p>
            ) : (
              licenseHistory.map((item) => (
                <article key={item.id} className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-sm font-medium text-zinc-900">
                    {item.license_year} - {humanizeEventType(item.event_type)}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {eventLabel}: {humanizeEventType(item.event_type)} - {formatDisplayDate(item.event_at)}
                  </p>
                  {item.status_before !== item.status_after &&
                  (item.status_before || item.status_after) ? (
                    <p className="text-xs text-zinc-600">
                      {fromLabel}: {item.status_before || "-"} - {toLabel}: {item.status_after || "-"}
                    </p>
                  ) : null}
                  {item.reason ? (
                    <p className="text-xs text-zinc-600">
                      {reasonLabel}: {item.reason}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{gradeTitle}</h3>
          <div className="mt-2 space-y-2">
            {gradeHistory.length === 0 ? (
              <p className="text-sm text-zinc-500">{emptyLabel}</p>
            ) : (
              gradeHistory.map((item) => (
                <article key={item.id} className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-sm font-medium text-zinc-900">
                    {fromLabel}: {item.from_grade || "-"} - {toLabel}: {item.to_grade}
                  </p>
                  <p className="text-xs text-zinc-500">{formatDisplayDate(item.promotion_date)}</p>
                  {item.notes ? (
                    <p className="text-xs text-zinc-600">
                      {notesLabel}: {item.notes}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
