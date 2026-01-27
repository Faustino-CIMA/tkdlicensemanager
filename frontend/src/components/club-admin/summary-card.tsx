type SummaryCardProps = {
  title: string;
  value: string;
  helper?: string;
};

export function SummaryCard({ title, value, helper }: SummaryCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
      <p className="text-sm text-zinc-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
      {helper ? <p className="mt-2 text-xs text-zinc-400">{helper}</p> : null}
    </div>
  );
}
