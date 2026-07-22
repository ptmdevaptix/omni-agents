/**
 * Fetch ALL rows for a query, paging past PostgREST's default 1000-row cap.
 *
 * This matters: NCAA enrollments and the players table both exceed 1000 rows,
 * so a single unpaged select silently truncates — which would make the
 * season-diff read the missing tail as departures. `makeQuery` must build a
 * fresh query each call so a new `.range()` can be applied.
 */

/** Minimal structural view of a PostgREST builder we can paginate + await. */
export interface Rangeable<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export async function fetchAll<T>(
  makeQuery: () => Rangeable<T>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
