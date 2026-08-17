import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  loading?: boolean;
};

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  loading = false,
}: EmptyStateProps) {
  return (
    <div
      className="app-panel border-dashed px-6 py-10 text-center"
      role={loading ? "status" : undefined}
      aria-busy={loading || undefined}
      aria-live={loading ? "polite" : undefined}
    >
      {loading ? (
        <span className="mx-auto mb-4 inline-flex size-14 items-center justify-center rounded-full bg-[var(--accent-soft)]">
          <Spinner />
        </span>
      ) : (
        <span className="mx-auto mb-3 inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] bg-secondary text-muted">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-section text-foreground">{title}</p>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
