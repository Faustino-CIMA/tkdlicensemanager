import { cn } from "@/lib/utils";

type SpinnerProps = {
  className?: string;
  label?: string;
};

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span className={cn("app-spinner", className)} role={label ? "status" : undefined} aria-label={label}>
      <span className="app-spinner-track" aria-hidden />
      <span className="app-spinner-arc" aria-hidden />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
