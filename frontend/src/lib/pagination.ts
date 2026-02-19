export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export function isPaginatedResponse<T>(value: unknown): value is PaginatedResponse<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as PaginatedResponse<T>).results)
  );
}

export function unwrapListResponse<T>(value: T[] | PaginatedResponse<T>): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isPaginatedResponse<T>(value)) {
    return value.results;
  }
  return [];
}
