/**
 * Best-effort lookup limiter for the public deletion status page: 10 lookups per IP per minute per server
 * instance. Codes are 12 random characters from a 32-letter alphabet (32^12 ≈ 1.2e18), so guessing is
 * impractical even without this; it only stops casual hammering.
 */
const WINDOW_MS = 60_000;
const MAX = 10;
const hits = new Map<string, number[]>();

export function allowLookup(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}
