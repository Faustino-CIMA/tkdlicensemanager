"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { FormPanel } from "@/components/ui/list-page-chrome";
import type { MemberClubTransferHistory } from "@/lib/club-admin-api";
import { formatDisplayDateTime } from "@/lib/date-display";

type MemberClubMovementPanelProps = {
  title: string;
  subtitle: string;
  emptyLabel: string;
  fromLabel: string;
  toLabel: string;
  dateLabel: string;
  statusLabel: string;
  countLabel: string;
  touristLabel: string;
  touristHint: string;
  history: MemberClubTransferHistory | null;
};

export function MemberClubMovementPanel({
  title,
  subtitle,
  emptyLabel,
  fromLabel,
  toLabel,
  dateLabel,
  statusLabel,
  countLabel,
  touristLabel,
  touristHint,
  history,
}: MemberClubMovementPanelProps) {
  const rows = history?.transfers ?? [];
  return (
    <FormPanel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-section text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {history?.is_club_tourist ? (
          <StatusBadge label={touristLabel} tone="warning" />
        ) : null}
      </div>
      {history ? (
        <p className="mt-3 text-sm text-foreground">
          {countLabel}: {history.completed_transfer_count}
        </p>
      ) : null}
      {history?.is_club_tourist ? (
        <p className="mt-1 text-xs text-muted">{touristHint}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">{dateLabel}</th>
                <th className="px-2 py-2 font-medium">{fromLabel}</th>
                <th className="px-2 py-2 font-medium">{toLabel}</th>
                <th className="px-2 py-2 font-medium">{statusLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-2 py-2">
                    {formatDisplayDateTime(row.completed_at || row.created_at)}
                  </td>
                  <td className="px-2 py-2">{row.from_club.name}</td>
                  <td className="px-2 py-2">{row.to_club.name}</td>
                  <td className="px-2 py-2 capitalize">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormPanel>
  );
}
