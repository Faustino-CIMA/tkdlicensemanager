"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const LIST_PAGE_SIZE_OPTIONS = ["50", "150", "300", "all"] as const;
export const LIST_PAGE_SIZE_CAP = 200;

export function resolveListPageSize(pageSize: string, totalCount: number, cap = LIST_PAGE_SIZE_CAP) {
  if (pageSize === "all") {
    return Math.min(Math.max(totalCount, 1), cap);
  }
  const n = Number(pageSize);
  if (!Number.isFinite(n) || n <= 0) {
    return 50;
  }
  return Math.min(n, cap);
}

export function ListToolbarPanel({
  search,
  pageSize,
  filters,
  filtersPlacement = "inline",
}: {
  search: ReactNode;
  pageSize?: ReactNode;
  filters?: ReactNode;
  filtersPlacement?: "inline" | "below";
}) {
  const stackFilters = Boolean(filters) && filtersPlacement === "below";
  return (
    <div
      className={
        stackFilters
          ? "flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
          : "flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
      }
    >
      <div className="flex min-w-[12rem] flex-1 flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">{search}</div>
        {pageSize ? <div>{pageSize}</div> : null}
      </div>
      {filters ? (
        <div
          className={
            stackFilters
              ? "min-w-0 border-t border-[var(--border)] pt-4"
              : "min-w-0 flex-1 border-t border-[var(--border)] pt-4 sm:border-t-0 sm:pt-0"
          }
        >
          {filters}
        </div>
      ) : null}
    </div>
  );
}

export function ListActionsRow({
  actions,
  pagination,
}: {
  actions?: ReactNode;
  pagination?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-h-[var(--control-height)] flex-wrap items-center gap-3">
        {actions}
      </div>
      {pagination}
    </div>
  );
}

export function ListPagination({
  currentPage,
  totalPages,
  onPrevious,
  onNext,
  pageLabel,
  previousLabel,
  nextLabel,
}: {
  currentPage: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
  pageLabel: string;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
      <span>{pageLabel}</span>
      <Button variant="outline" disabled={currentPage === 1} onClick={onPrevious}>
        {previousLabel}
      </Button>
      <Button variant="outline" disabled={currentPage === totalPages} onClick={onNext}>
        {nextLabel}
      </Button>
    </div>
  );
}

export function PageSizeSelect({
  value,
  onChange,
  options = LIST_PAGE_SIZE_OPTIONS,
  ariaLabel,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: readonly string[];
  ariaLabel: string;
  allLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[150px]" aria-label={ariaLabel}>
        <SelectValue placeholder={ariaLabel} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option === "all" ? allLabel : option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SelectionMeta({
  count,
  hiddenCount = 0,
  countLabel,
  hiddenLabel,
  clearLabel,
  onClear,
}: {
  count: number;
  hiddenCount?: number;
  countLabel: string;
  hiddenLabel?: string;
  clearLabel: string;
  onClear: () => void;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
      <span className="font-medium text-[var(--foreground)]">{countLabel}</span>
      {hiddenCount > 0 && hiddenLabel ? (
        <span className="font-medium text-warning">{hiddenLabel}</span>
      ) : null}
      <button
        type="button"
        className="min-h-[var(--control-height)] rounded-[var(--radius-form)] px-2 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
        onClick={onClear}
      >
        {clearLabel}
      </button>
    </div>
  );
}

export function PageNotice({
  tone,
  children,
}: {
  tone: "danger" | "success" | "info";
  children: ReactNode;
}) {
  const toneClass =
    tone === "danger" ? "banner-danger" : tone === "success" ? "banner-success" : "banner-info";
  return (
    <p className={cn("rounded-[var(--radius-form)] border px-4 py-3 text-sm", toneClass)}>{children}</p>
  );
}

export function FloatingNotice({
  open,
  tone,
  token,
  children,
  onDismiss,
  dismissLabel,
}: {
  open: boolean;
  tone: "danger" | "success" | "info";
  token?: string;
  children: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [payload, setPayload] = useState<{ tone: typeof tone; children: ReactNode }>({
    tone,
    children,
  });

  useEffect(() => {
    if (open) {
      setPayload({ tone, children });
      setMounted(true);
      setShown(false);
      const start = window.setTimeout(() => setShown(true), 30);
      return () => window.clearTimeout(start);
    }
    setShown(false);
    return undefined;
    // Snapshot copy when the notice opens or is replaced; ignore render-identity of children.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  if (!mounted) {
    return null;
  }

  const toneClass =
    payload.tone === "danger"
      ? "banner-danger"
      : payload.tone === "success"
        ? "banner-success"
        : "banner-info";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 z-[60] w-[min(24rem,calc(100vw-2rem))]"
      style={{
        top: "calc(var(--topbar-height, 4rem) + 0.75rem)",
        transform: shown ? "translateX(0)" : "translateX(calc(100% + 1.5rem))",
        opacity: shown ? 1 : 0,
        transition: shown
          ? "transform 520ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease-out"
          : "transform 340ms cubic-bezier(0.4, 0, 1, 1), opacity 220ms ease-in",
      }}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.propertyName !== "transform") {
          return;
        }
        if (!shown) {
          setMounted(false);
        }
      }}
    >
      <div
        className={cn(
          "flex items-start gap-3 rounded-[var(--radius-form)] border px-4 py-3 text-sm shadow-[var(--shadow-float,0_12px_32px_rgb(15_23_42/0.16))]",
          toneClass
        )}
      >
        <div className="min-w-0 flex-1">{payload.children}</div>
        {onDismiss ? (
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-form)] hover:bg-[color-mix(in_oklab,black_8%,transparent)]"
            onClick={onDismiss}
            aria-label={dismissLabel || "Close"}
          >
            <span aria-hidden className="text-lg leading-none">
              ×
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function FormPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("app-panel p-6", className)}>{children}</section>;
}

export function ExpandableTable({ children }: { children: ReactNode }) {
  return <div className="app-panel overflow-x-auto">{children}</div>;
}

export function NestedTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-card">
      {children}
    </div>
  );
}

export const dataTableClass = "min-w-full text-left text-sm";
export const dataTheadClass =
  "border-b border-border bg-secondary/70 text-xs uppercase tracking-wide text-muted";
export const dataThClass = "px-4 py-3 font-medium";
export const dataTdClass = "px-4 py-3";
export const dataRowClass =
  "h-[var(--table-row-height)] text-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_6%,white)]";
export const dataRowClickableClass = `${dataRowClass} cursor-pointer`;

export function AppTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "placeholder:text-[var(--field-placeholder)] min-h-[7.5rem] w-full rounded-[var(--radius-form)] border border-[var(--border)] bg-[var(--field-background)] px-3 py-2 text-sm text-[var(--field-foreground)] shadow-xs outline-none transition-[color,box-shadow]",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
