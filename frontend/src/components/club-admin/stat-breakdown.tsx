type StatBreakdownItem = {
  label: string;
  value: number;
  tone?: "accent" | "success" | "warning" | "danger" | "neutral";
};

type StatBreakdownProps = {
  title: string;
  items: StatBreakdownItem[];
};

const barTone: Record<NonNullable<StatBreakdownItem["tone"]>, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted",
};

export function StatBreakdown({ title, items }: StatBreakdownProps) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <section className="app-panel p-5">
      <h2 className="text-section text-foreground">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">{item.label}</span>
              <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${barTone[item.tone ?? "neutral"]}`}
                style={{ width: `${Math.max(item.value > 0 ? 6 : 0, (item.value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
