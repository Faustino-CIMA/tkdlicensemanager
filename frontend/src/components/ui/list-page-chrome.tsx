"use client";

import type { ComponentProps, ReactNode } from "react";

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
