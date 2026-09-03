"use client";

import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type UnderlineTabOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
};

type UnderlineTabsProps<T extends string> = {
  value: T;
  options: Array<UnderlineTabOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  idPrefix: string;
};

export function UnderlineTabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  idPrefix,
}: UnderlineTabsProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (index: number) => {
    const option = options[index];
    if (!option) {
      return;
    }
    onChange(option.value);
    buttonRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = options.findIndex((option) => option.value === value);
    if (currentIndex < 0) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAndSelect((currentIndex + 1) % options.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAndSelect((currentIndex - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAndSelect(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAndSelect(options.length - 1);
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-secondary p-1.5 shadow-sm">
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className="flex gap-1 overflow-x-auto overflow-y-hidden"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              id={`${idPrefix}-${option.value}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel`}
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              onClick={() => onChange(option.value)}
              className={cn(
                "box-border inline-flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-form)] border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-secondary",
                selected
                  ? "border-border bg-surface text-foreground shadow-sm"
                  : "border-transparent bg-transparent text-muted hover:bg-surface/70 hover:text-foreground"
              )}
            >
              {Icon ? <Icon className="size-5 shrink-0" aria-hidden /> : null}
              <span>{option.label}</span>
              {typeof option.count === "number" ? (
                <span
                  className={cn(
                    "inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums text-foreground",
                    selected ? "bg-secondary" : "bg-surface"
                  )}
                >
                  {option.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
