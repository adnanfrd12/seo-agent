export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a search param as a string. */
export const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Builds `path?…` keeping current params, applying `patch` (undefined/null removes a key). */
export function withParams(path: string, current: SearchParams, patch: Record<string, string | null | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const val = first(v);
    if (val !== undefined) qs.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) qs.delete(k);
    else qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
