type StatusBadgeProps = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
};

const toneClasses: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  neutral: "bg-[color:color-mix(in_oklab,var(--default)_88%,white)] text-[var(--default-foreground)]",
  success: "bg-[color:color-mix(in_oklab,var(--success)_22%,white)] text-[color:color-mix(in_oklab,var(--success)_70%,black)]",
  warning: "bg-[color:color-mix(in_oklab,var(--warning)_24%,white)] text-[color:color-mix(in_oklab,var(--warning)_72%,black)]",
  danger: "bg-[color:color-mix(in_oklab,var(--danger)_22%,white)] text-[color:color-mix(in_oklab,var(--danger)_72%,black)]",
  info: "bg-[color:color-mix(in_oklab,var(--accent)_20%,white)] text-[var(--accent-foreground)]",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-form)] border border-[var(--border)] px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}
