import Link from "next/link";

import { cn } from "@/lib/utils";

export type ActionQueueSeverity = "info" | "warning" | "critical";

export type ActionQueueItem = {
  id: string;
  label: string;
  count: number;
  severity: ActionQueueSeverity;
  href: string;
};

type ActionQueueProps = {
  title: string;
  emptyLabel: string;
  countLabel: (count: number) => string;
  openLabel: string;
  items: ActionQueueItem[];
};

const severityBar: Record<ActionQueueSeverity, string> = {
  info: "bg-accent",
  warning: "bg-warning",
  critical: "bg-destructive",
};

const severitySurface: Record<ActionQueueSeverity, string> = {
  info: "badge-info",
  warning: "badge-warning",
  critical: "badge-danger",
};

export function ActionQueue({ title, emptyLabel, countLabel, openLabel, items }: ActionQueueProps) {
  return (
    <section className="app-panel space-y-4 p-6">
      <h2 className="text-section text-foreground">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-[var(--radius-control)] border px-3 py-3",
                severitySurface[item.severity]
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className={cn("mt-0.5 h-10 w-1 shrink-0 rounded-full", severityBar[item.severity])} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-meta">{countLabel(item.count)}</p>
                </div>
              </div>
              <Link
                href={item.href}
                className="inline-flex h-[var(--control-height)] min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-chip)] border border-current px-4 text-xs font-semibold"
              >
                {openLabel}
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
