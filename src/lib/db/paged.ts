/**
 * Reads every row of a query, 1,000 at a time. The database API returns at most 1,000 rows per request whatever
 * `.limit()` asks for, so large reads (e.g. Clarity's per-page metrics) silently lost most of their rows.
 * `build(from, to)` must return the same query each time with `.range(from, to)` applied (and a stable order).
 */
export async function pagedRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, max = 50_000): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return { data: out, error: null };
}
