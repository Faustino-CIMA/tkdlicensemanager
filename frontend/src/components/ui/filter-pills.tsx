"use client";

import { cn } from "@/lib/utils";

export type FilterPillOption<T extends string> = {
  value: T;
  title: string;
  count?: number;
};

type FilterPillsProps<T extends string> = {
  value: T;
  options: Array<FilterPillOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
};

export function FilterPills<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: FilterPillsProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex w-full min-w-0 flex-row flex-wrap gap-2"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-[var(--control-height)] min-w-0 flex-1 cursor-pointer items-baseline justify-start gap-1.5 rounded-[var(--radius-chip)] border px-4 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-surface text-foreground hover:bg-secondary"
            )}
          >
            <span className="text-sm font-semibold">{option.title}</span>
            {option.count !== undefined ? (
              <span className={cn("text-xs", selected ? "text-primary-foreground/80" : "text-muted")}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
