type SummaryCardProps = {
  title: string;
  value: string;
  helper?: string;
};

export function SummaryCard({ title, value, helper }: SummaryCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
      <p className="text-sm font-medium text-[var(--muted)]">{title}</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-[var(--foreground)]">{value}</p>
      {helper ? <p className="mt-2 text-xs text-[var(--muted)]">{helper}</p> : null}
    </div>
  );
}
