import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Parsed dfs_cache rows kept in this server instance's memory, so screens don't download the same synced data on
 * every page view (a Search Console screen reads ~10 MB of cubes and inventory; GA4 ~3 MB).
 *
 * Never stale: once something is in memory, every read first asks the database for the rows' `fetched_at` (a few
 * bytes) and reuses a parsed copy only when it was read at exactly that `fetched_at`. A sync that writes a row
 * changes its `fetched_at`, so the next read downloads the new version. Rows that no longer exist are not returned.
 *
 * Callers must treat the returned data as read-only (it is shared between requests). Sync code, which edits what it
 * loads, keeps using its own uncached reads.
 */
interface Entry { at: string; data: unknown; weight: number; used: number }
type Row = { params_hash: string; data: unknown; fetched_at: string };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<Row[]>>();
/** Rough memory budget in table cells (one client's GA4 + Search Console data is ~0.3–0.8 M). */
const MAX_WEIGHT = 2_500_000;
let total = 0;

/** Approximate size: cube cells, array length, or a small constant. */
function weightOf(data: unknown): number {
  if (data && typeof data === "object") {
    const d = data as { rows?: unknown[]; cols?: unknown[] };
    if (Array.isArray(d.rows)) return Math.max(1, d.rows.length * Math.max(1, d.cols?.length ?? 1));
    if (Array.isArray(data)) return Math.max(1, (data as unknown[]).length * 40);
  }
  return 50;
}

const keyOf = (clientId: string, endpoint: string, hash: string) => `${clientId}|${endpoint}|${hash}`;

function put(key: string, at: string, data: unknown) {
  const old = store.get(key);
  if (old) { total -= old.weight; store.delete(key); }
  // outside production, shared objects are frozen so an accidental in-place sort or push fails loudly in testing
  if (process.env.NODE_ENV !== "production" && data && typeof data === "object") {
    Object.freeze(data);
    const rows = (data as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) Object.freeze(rows);
  }
  const weight = weightOf(data);
  store.set(key, { at, data, weight, used: Date.now() });
  total += weight;
  if (total > MAX_WEIGHT) {
    // least recently used first, down to 80% of the budget
    for (const [k, e] of [...store.entries()].sort((a, b) => a[1].used - b[1].used)) {
      if (total <= MAX_WEIGHT * 0.8) break;
      store.delete(k); total -= e.weight;
    }
  }
}

/** Downloads rows with their data (one query; concurrent requests for the same rows share it) and keeps them. */
function download(admin: SupabaseClient, clientId: string, endpoint: string, hashes: string[]): Promise<Row[]> {
  const flightKey = `${clientId}|${endpoint}|${[...hashes].sort().join(",")}`;
  let p = inflight.get(flightKey);
  if (!p) {
    p = (async () => {
      const { data, error } = await admin.from("dfs_cache").select("params_hash, data, fetched_at").eq("client_id", clientId).eq("endpoint", endpoint).in("params_hash", hashes);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Row[];
      for (const r of rows) put(keyOf(clientId, endpoint, r.params_hash), r.fetched_at, r.data);
      return rows;
    })().finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, p);
  }
  return p;
}

/**
 * The `data` of the given dfs_cache rows (client + endpoint + params_hash): from memory when the copy there is the
 * current version, otherwise from the database. Rows that don't exist are absent from the result.
 */
export async function cachedRows(admin: SupabaseClient, clientId: string, endpoint: string, hashes: readonly string[]): Promise<Map<string, { data: unknown; fetchedAt: string }>> {
  const out = new Map<string, { data: unknown; fetchedAt: string }>();
  if (!hashes.length) return out;
  // nothing in memory yet: a single query with the data; otherwise first the versions (a few bytes)
  let current: Map<string, string> | null = null;
  if (hashes.some((h) => store.has(keyOf(clientId, endpoint, h)))) {
    const { data, error } = await admin.from("dfs_cache").select("params_hash, fetched_at").eq("client_id", clientId).eq("endpoint", endpoint).in("params_hash", hashes as string[]);
    if (error) throw new Error(error.message);
    current = new Map((data ?? []).map((r) => [r.params_hash as string, r.fetched_at as string]));
  }
  const need = current ? [...current].filter(([h, at]) => store.get(keyOf(clientId, endpoint, h))?.at !== at).map(([h]) => h) : [...hashes];
  const fresh = new Map<string, { data: unknown; fetchedAt: string }>();
  for (const r of need.length ? await download(admin, clientId, endpoint, need) : []) fresh.set(r.params_hash, { data: r.data, fetchedAt: r.fetched_at });
  const versions = current ?? new Map([...fresh].map(([h, v]) => [h, v.fetchedAt]));
  const missing: string[] = [];
  for (const [h, at] of versions) {
    const f = fresh.get(h);
    if (f) { out.set(h, f); continue; }
    const e = store.get(keyOf(clientId, endpoint, h));
    if (e && e.at === at) { e.used = Date.now(); out.set(h, { data: e.data, fetchedAt: e.at }); }
    else missing.push(h); // evicted (or rewritten) between the version check and now: read it again
  }
  if (missing.length) for (const r of await download(admin, clientId, endpoint, missing)) out.set(r.params_hash, { data: r.data, fetchedAt: r.fetched_at });
  return out;
}

/** For tests and diagnostics. */
export const dataCacheStats = () => ({ entries: store.size, weight: total });
