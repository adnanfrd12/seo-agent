/**
 * Stored history for the GA4 and Search Console screen cubes (dfs_cache "ga4x" / "gscx").
 *
 * Google only serves a limited window (Search Console about 16 months, the cube syncs ask for the last few months), but
 * once a day has been imported it must stay available. A sync therefore never replaces a cube wholesale: rows of
 * days before the window it just read are kept from the stored copy, the window itself is replaced by the fresh read
 * (Google revises recent days), and a report that failed keeps the stored cube as it was.
 */

type Cell = string | number;
export interface HistCube<C extends Cell[] = Cell[]> { cols: string[]; rows: C[]; error?: string; truncated?: boolean }

/** The day (YYYY-MM-DD) or month (YYYY-MM) a row belongs to: the first date-like column. */
const DATE_COLS = ["date", "dateHour", "hour", "month"] as const;
export function dateIndex(cols: string[]): number {
  for (const c of DATE_COLS) { const i = cols.indexOf(c); if (i >= 0) return i; }
  return -1;
}
const dayOf = (v: Cell | undefined) => String(v ?? "").slice(0, 10);

/** Old rows re-shaped to the fresh column list (a column added later is filled with "" or 0, a dropped one is left out). */
function remap(old: HistCube, cols: string[], sample: Cell[] | undefined): Cell[][] {
  if (old.cols.length === cols.length && old.cols.every((c, i) => c === cols[i])) return old.rows;
  const idx = cols.map((c) => old.cols.indexOf(c));
  // metrics are numbers (as in the fresh rows): a missing metric is 0, a missing dimension ""
  return old.rows.map((r) => idx.map((i, j) => (i >= 0 ? r[i] : typeof sample?.[j] === "number" ? 0 : "")));
}

/**
 * Merges a fresh read of [from, ...] into the stored cube.
 *  - fresh failed (error set, no rows): the stored cube is kept, with the new error noted;
 *  - otherwise: stored rows dated before `from` + every fresh row.
 * `keepAlso` keeps further stored rows inside the window (e.g. a search type whose read failed this time).
 */
export function mergeCube<C extends Cell[]>(old: HistCube<C> | null | undefined, fresh: HistCube<C>, from: string, keepAlso?: (row: C) => boolean): HistCube<C> {
  if (!old?.rows?.length || !old.cols?.length) return fresh;
  if (fresh.error && !fresh.rows.length) return { ...old, error: fresh.error };
  const di = dateIndex(fresh.cols);
  const oi = dateIndex(old.cols);
  if (di < 0 || oi < 0) return fresh; // not a dated cube: nothing to accumulate
  const rows = remap(old as HistCube, fresh.cols, fresh.rows[0]) as C[];
  const kept = rows.filter((r) => { const d = dayOf(r[di]); return (d !== "" && d < from) || (keepAlso?.(r) ?? false); });
  if (!kept.length) return fresh;
  return { ...fresh, rows: [...kept, ...fresh.rows] };
}

/** The earliest day/month stored in any of the cubes (for meta.start), or null. */
export function earliest(cubes: (HistCube | undefined)[]): string | null {
  let min: string | null = null;
  for (const c of cubes) {
    if (!c?.rows?.length) continue;
    const i = dateIndex(c.cols);
    if (i < 0) continue;
    for (const r of c.rows) { const d = dayOf(r[i]); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && (min === null || d < min)) min = d; }
  }
  return min;
}
