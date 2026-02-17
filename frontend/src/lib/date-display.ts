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
