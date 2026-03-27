type SummaryCardProps = {
  title: string;
  value: string;
  helper?: string;
};

export function SummaryCard({ title, value, helper }: SummaryCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-sm">
      <p className="text-sm text-muted">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {helper ? <p className="mt-2 text-xs text-muted">{helper}</p> : null}
    </div>
  );
}
