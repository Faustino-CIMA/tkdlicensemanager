import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type SummaryCardTone = "accent" | "success" | "warning" | "danger" | "neutral";

type SummaryCardProps = {
  title: string;
  value: string;
  helper?: string;
  icon?: LucideIcon;
  tone?: SummaryCardTone;
};

const toneClasses: Record<SummaryCardTone, { tile: string; icon: string }> = {
  accent: {
    tile: "bg-[color-mix(in_oklab,var(--accent)_10%,white)]",
    icon: "bg-[color-mix(in_oklab,var(--accent)_16%,white)] text-[color-mix(in_oklab,var(--accent)_70%,black)]",
  },
  success: {
    tile: "bg-[color-mix(in_oklab,var(--success)_12%,white)]",
    icon: "bg-[color-mix(in_oklab,var(--success)_18%,white)] text-[color-mix(in_oklab,var(--success)_62%,black)]",
  },
  warning: {
    tile: "bg-[color-mix(in_oklab,var(--warning)_16%,white)]",
    icon: "bg-[color-mix(in_oklab,var(--warning)_22%,white)] text-[color-mix(in_oklab,var(--warning)_55%,black)]",
  },
  danger: {
    tile: "bg-[color-mix(in_oklab,var(--danger)_10%,white)]",
    icon: "bg-[color-mix(in_oklab,var(--danger)_16%,white)] text-[color-mix(in_oklab,var(--danger)_65%,black)]",
  },
  neutral: {
    tile: "bg-surface",
    icon: "bg-secondary text-muted",
  },
};

export function SummaryCard({ title, value, helper, icon: Icon, tone = "neutral" }: SummaryCardProps) {
  const palette = toneClasses[tone];
  return (
    <div className={cn("app-panel p-5", palette.tile)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{title}</p>
        {Icon ? (
          <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)]", palette.icon)}>
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-display tabular-nums text-foreground">{value}</p>
      {helper ? <p className="mt-2 text-meta">{helper}</p> : null}
    </div>
  );
}
