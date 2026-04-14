type EmptyStateProps = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-card p-6 text-center text-sm text-muted">
      <p className="font-medium text-foreground">{title}</p>
      {description ? <p className="mt-2">{description}</p> : null}
    </div>
  );
}
