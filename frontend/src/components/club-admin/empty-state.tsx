type EmptyStateProps = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
      <p className="font-medium text-zinc-700">{title}</p>
      {description ? <p className="mt-2">{description}</p> : null}
    </div>
  );
}
