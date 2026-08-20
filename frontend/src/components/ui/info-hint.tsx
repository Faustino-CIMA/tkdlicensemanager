"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type InfoHintProps = {
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
};

export function InfoHint({ ariaLabel, children, className }: InfoHintProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("group relative", className)}>
      <button
        type="button"
        className="inline-flex h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] items-center justify-center rounded-[var(--radius-form)] text-muted transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
      >
        <CircleAlert className="h-4 w-4" />
      </button>
      <div
        role="tooltip"
        className={cn(
          "absolute right-0 top-full z-20 mt-2 w-max max-w-xs rounded-[var(--radius-form)] border border-border bg-surface px-3 py-2 text-left text-sm text-muted shadow-[var(--shadow-card)]",
          open ? "visible" : "invisible group-hover:visible group-focus-within:visible"
        )}
      >
        {children}
      </div>
    </div>
  );
}
