type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
};

type EntityTableProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
};

export function EntityTable<T extends { id: number | string }>({
  columns,
  rows,
}: EntityTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-100 bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-3 font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.id} className="text-zinc-700">
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-3">
                  {column.render ? column.render(row) : (row as Record<string, React.ReactNode>)[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
