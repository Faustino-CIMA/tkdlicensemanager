"use client";

import { PublishedLicenseCardPreview } from "@/components/member/published-license-card-preview";
import { StatusBadge } from "@/components/ui/status-badge";

export type CurrentLicense = {
  id: number;
  year: number;
  status: string;
  license_type: number;
  license_type_name: string;
};

type CurrentLicensesPanelProps = {
  memberId?: number;
  licenses: CurrentLicense[];
  title: string;
  subtitle: string;
  emptyLabel: string;
  pendingHint: string;
  yearLabel: string;
  typeLabel: string;
  statusLabel: string;
  pendingLabel: string;
  activeLabel: string;
  expiredLabel: string;
  revokedLabel: string;
  cardPreviewTitle: string;
  cardPreviewFrontLabel: string;
  cardPreviewBackLabel: string;
  cardPreviewUnavailable: string;
};

function statusTone(status: string): "success" | "warning" | "neutral" | "danger" {
  if (status === "active") {
    return "success";
  }
  if (status === "pending") {
    return "warning";
  }
  if (status === "revoked") {
    return "danger";
  }
  return "neutral";
}

function statusLabelFor(
  status: string,
  labels: Pick<CurrentLicensesPanelProps, "pendingLabel" | "activeLabel" | "expiredLabel" | "revokedLabel">
) {
  if (status === "pending") {
    return labels.pendingLabel;
  }
  if (status === "active") {
    return labels.activeLabel;
  }
  if (status === "expired") {
    return labels.expiredLabel;
  }
  if (status === "revoked") {
    return labels.revokedLabel;
  }
  return status;
}

export function CurrentLicensesPanel({
  memberId,
  licenses,
  title,
  subtitle,
  emptyLabel,
  pendingHint,
  yearLabel,
  typeLabel,
  statusLabel,
  pendingLabel,
  activeLabel,
  expiredLabel,
  revokedLabel,
  cardPreviewTitle,
  cardPreviewFrontLabel,
  cardPreviewBackLabel,
  cardPreviewUnavailable,
}: CurrentLicensesPanelProps) {
  const hasPending = licenses.some((license) => license.status === "pending");
  const previewLicense =
    licenses.find((license) => license.status === "active") ?? licenses[0] ?? null;
  return (
    <section className="app-panel p-6">
      <h2 className="text-section text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      {memberId && previewLicense ? (
        <div className="mt-4">
          <PublishedLicenseCardPreview
            memberId={memberId}
            licenseId={previewLicense.id}
            title={cardPreviewTitle}
            frontLabel={cardPreviewFrontLabel}
            backLabel={cardPreviewBackLabel}
            unavailableLabel={cardPreviewUnavailable}
          />
        </div>
      ) : null}
      {licenses.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-secondary/70 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{yearLabel}</th>
                <th className="px-4 py-3 font-medium">{typeLabel}</th>
                <th className="px-4 py-3 font-medium">{statusLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {licenses.map((license) => (
                <tr key={license.id} className="h-[var(--table-row-height)] text-foreground">
                  <td className="px-4 py-3">{license.year}</td>
                  <td className="px-4 py-3">{license.license_type_name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={statusLabelFor(license.status, {
                        pendingLabel,
                        activeLabel,
                        expiredLabel,
                        revokedLabel,
                      })}
                      tone={statusTone(license.status)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasPending ? <p className="mt-3 text-sm text-muted">{pendingHint}</p> : null}
    </section>
  );
}
