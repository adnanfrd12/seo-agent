import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, recordSpend, type SpendSource } from "@/lib/dataforseo/budget";
import { DFS_NOT_CONFIGURED, dfsConfigured, dfsPost } from "@/lib/dataforseo/client";
import { arr, num, obj, resolveTarget, str } from "@/lib/dataforseo/research";

/**
 * Google search volume for Business Profile search keywords, from DataForSEO Labs keyword_overview (one Live call
 * for up to 700 keywords, about $0.01 + $0.0001 per keyword). Stored per client in dfs_cache (endpoint
 * "gbp_kw_volume", one row per keyword, 30-day freshness: volumes are monthly figures). Keywords the quick-wins
 * engine already looked up (dfs_cache "aiqw_kw") are reused for free.
 */
export const VOLUME_ENDPOINT = "gbp_kw_volume";
export const VOLUME_TTL_DAYS = 30;
export const MAX_KEYWORDS = 700;
export const estimateCost = (n: number) => (n > 0 ? Math.round((0.01 + 0.0001 * Math.min(n, MAX_KEYWORDS)) * 1000) / 1000 : 0);

export type Volume = { volume: number | null; trend: number[]; cpc: number | null; competition: number | null; at: string };
export const normKw = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ");

/** Stored volumes by normalised keyword (own cache first, then the quick-wins cache). */
export async function loadVolumes(supabase: SupabaseClient, clientId: string): Promise<Map<string, Volume>> {
  const [own, qw] = await Promise.all([
    supabase.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", VOLUME_ENDPOINT).limit(5000),
    supabase.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "aiqw_kw").limit(50),
  ]);
  const m = new Map<string, Volume>();
  for (const r of qw.data ?? []) {
    for (const k of ((r.data as { items?: (Volume & { keyword: string })[] })?.items ?? [])) {
      const cur = m.get(normKw(k.keyword));
      if (!cur || cur.at < k.at) m.set(normKw(k.keyword), { volume: k.volume, trend: k.trend ?? [], cpc: k.cpc ?? null, competition: k.competition ?? null, at: k.at });
    }
  }
  for (const r of own.data ?? []) {
    const k = String(r.params_hash).replace(/^kw:/, "");
    const v = r.data as Volume;
    const cur = m.get(k);
    if (!cur || cur.at < v.at) m.set(k, v);
  }
  return m;
}

/** Keywords that have no volume yet, or one older than the freshness window. */
export function staleKeywords(keywords: string[], have: Map<string, Volume>): string[] {
  const cutoff = Date.now() - VOLUME_TTL_DAYS * 86_400_000;
  return [...new Set(keywords.map(normKw))]
    .filter((k) => k.length > 1 && k.length <= 80 && k.split(" ").length <= 10)
    .filter((k) => { const h = have.get(k); return !h || Date.parse(h.at) < cutoff; })
    .slice(0, MAX_KEYWORDS);
}

/** Fetches volumes for the given keywords within the DataForSEO budget (throws BudgetError past a cap). */
export async function fetchVolumes(admin: SupabaseClient, clientId: string, keywords: string[], source: SpendSource) {
  if (!(await dfsConfigured(clientId))) throw new Error(DFS_NOT_CONFIGURED);
  if (!keywords.length) return { fetched: 0, cost: 0 };
  const t = await resolveTarget(admin, clientId);
  const batch = keywords.slice(0, MAX_KEYWORDS);
  await assertBudget(admin, clientId, estimateCost(batch.length), source);
  const { result, cost } = await dfsPost(clientId, "/dataforseo_labs/google/keyword_overview/live", {
    keywords: batch, location_code: t?.location_code ?? 2840, language_code: t?.language_code ?? "en",
  });
  await recordSpend(admin, clientId, VOLUME_ENDPOINT, cost, source);
  const at = new Date().toISOString();
  const got = new Map<string, Volume>();
  for (const it of arr(result?.items)) {
    const info = obj(it.keyword_info);
    const k = normKw(str(it.keyword) ?? "");
    if (!k) continue;
    got.set(k, {
      volume: num(info.search_volume), cpc: num(info.cpc), competition: num(info.competition), at,
      trend: arr(info.monthly_searches).slice(0, 12).map((m) => num(m.search_volume) ?? 0).reverse(),
    });
  }
  // keywords without data are stored too, so they aren't paid for again within the window
  const rows = batch.map((k) => ({
    client_id: clientId, endpoint: VOLUME_ENDPOINT, params_hash: `kw:${k}`, params: { keyword: k },
    data: got.get(k) ?? { volume: null, trend: [], cpc: null, competition: null, at }, row_count: 1, cost: 0, fetched_at: at,
  }));
  if (rows.length) rows[0].cost = cost;
  for (let i = 0; i < rows.length; i += 500) {
    await admin.from("dfs_cache").upsert(rows.slice(i, i + 500), { onConflict: "client_id,endpoint,params_hash" });
  }
  return { fetched: batch.length, cost };
}
