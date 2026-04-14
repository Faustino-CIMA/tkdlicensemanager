"use client";

import { cn } from "@/lib/utils";

type SwitchProps = {
  id?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  label: React.ReactNode;
  className?: string;
};

/**
 * Accessible toggle using theme tokens; track sized for ~44px touch height.
 */
export function Switch({ id, checked, onCheckedChange, disabled, label, className }: SwitchProps) {
  return (
    <div className={cn("flex min-h-11 items-center gap-3", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id ? `${id}-label` : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-11 min-h-11 w-[3.5rem] shrink-0 cursor-pointer items-center rounded-[var(--radius-form)] border border-[var(--border)] bg-[var(--surface-secondary)] px-1 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          checked && "border-primary bg-primary",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none block h-8 w-8 rounded-[var(--radius-form)] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--border)] transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
      {label ? (
        <span id={id ? `${id}-label` : undefined} className="text-sm font-medium text-[var(--foreground)]">
          {label}
        </span>
      ) : null}
    </div>
  );
}
