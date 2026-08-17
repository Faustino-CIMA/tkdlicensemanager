const EN_MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_INDEX_BY_SHORT = new Map(
  EN_MONTH_SHORT.map((label, index) => [label.toLowerCase(), index])
);

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateParts(day: number, monthIndex: number, year: number): string {
  const safeMonth = EN_MONTH_SHORT[monthIndex] ?? "";
  return `${pad2(day)} ${safeMonth} ${year}`;
}

function parseIsoDateOnly(value: string): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, monthIndex: month - 1, day };
}

function asDate(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isValidDateParts(year: number, monthIndex: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, monthIndex, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === monthIndex &&
    probe.getUTCDate() === day
  );
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

export function parseDisplayDateToIso(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const isoDateOnly = parseIsoDateOnly(raw);
  if (isoDateOnly) {
    if (!isValidDateParts(isoDateOnly.year, isoDateOnly.monthIndex, isoDateOnly.day)) {
      return null;
    }
    return toIsoDate(isoDateOnly.year, isoDateOnly.monthIndex, isoDateOnly.day);
  }

  const dayFirstMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (dayFirstMatch) {
    const day = Number(dayFirstMatch[1]);
    const month = Number(dayFirstMatch[2]);
    const year = Number(dayFirstMatch[3]);
    const monthIndex = month - 1;
    if (!isValidDateParts(year, monthIndex, day)) {
      return null;
    }
    return toIsoDate(year, monthIndex, day);
  }

  const displayMatch = /^(\d{1,2})\s+([a-zA-Z]{3})\s+(\d{4})$/.exec(raw);
  if (displayMatch) {
    const day = Number(displayMatch[1]);
    const monthIndex = MONTH_INDEX_BY_SHORT.get(displayMatch[2].toLowerCase());
    const year = Number(displayMatch[3]);
    if (monthIndex === undefined || !isValidDateParts(year, monthIndex, day)) {
      return null;
    }
    return toIsoDate(year, monthIndex, day);
  }

  return null;
}

export function formatDateInputValue(value: string | null | undefined): string {
  const iso = parseDisplayDateToIso(value);
  if (!iso) {
    return value ? String(value) : "";
  }
  return formatDisplayDate(iso);
}

export function formatDisplayDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "-";
  }
  if (typeof value === "string") {
    const isoDateOnly = parseIsoDateOnly(value);
    if (isoDateOnly) {
      return formatDateParts(isoDateOnly.day, isoDateOnly.monthIndex, isoDateOnly.year);
    }
  }
  const parsed = asDate(value);
  if (!parsed) {
    return typeof value === "string" ? value : "-";
  }
  return formatDateParts(parsed.getDate(), parsed.getMonth(), parsed.getFullYear());
}

export function formatDisplayDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = asDate(value);
  if (!parsed) {
    return typeof value === "string" ? value : "-";
  }
  const dateLabel = formatDateParts(parsed.getDate(), parsed.getMonth(), parsed.getFullYear());
  return `${dateLabel}, ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
}
