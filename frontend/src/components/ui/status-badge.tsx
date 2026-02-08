type StatusBadgeProps = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
};

const toneClasses: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
  info: "bg-blue-100 text-blue-700",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}
