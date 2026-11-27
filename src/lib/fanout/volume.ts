import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadKw } from "@/lib/aiqw/dfs";
import { assertBudget, recordSpend } from "@/lib/dataforseo/budget";
import { dfsConfigured, dfsPost } from "@/lib/dataforseo/client";
import { arr, num, obj, str, type Target } from "@/lib/dataforseo/research";
import { siteKeywords } from "@/lib/toolkit/store";
import { EST } from "./shared";

const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ");
const DAY = 86_400_000;

/**
 * Monthly Google search volume for fan-out queries. Free first: volumes the dashboard already holds (AI Quick Wins
 * keyword data, ranked keywords, earlier fan-out runs of the last 30 days); the rest in ONE DataForSEO
 * keyword_overview call (about $0.01 + $0.0001 per keyword), checked against the daily API budget first.
 * Keywords DataForSEO has no data for come back as null.
 */
export async function volumes(admin: SupabaseClient, clientId: string, target: Target, keywords: string[]): Promise<{ map: Map<string, number | null>; cost: number; fetched: number }> {
  const want = [...new Set(keywords.map(norm))].filter((k) => k.length > 1 && k.length <= 80 && k.split(" ").length <= 10);
  const map = new Map<string, number | null>();
  const [kw, site, prev] = await Promise.all([
    loadKw(admin, clientId).catch(() => new Map()),
    siteKeywords(admin, clientId).catch(() => []),
    admin.from("fanout_queries").select("query, volume, fanout_runs!inner(created_at)").eq("client_id", clientId).not("volume", "is", null)
      .gte("fanout_runs.created_at", new Date(Date.now() - 30 * DAY).toISOString()).limit(5000),
  ]);
  for (const k of site) if (k.volume != null) map.set(norm(k.keyword), k.volume);
  for (const [k, v] of kw) if (v.volume != null) map.set(k, v.volume);
  for (const r of prev.data ?? []) map.set(norm(String(r.query)), Number(r.volume));
  const missing = want.filter((k) => !map.has(k)).slice(0, 700);
  if (!missing.length || !(await dfsConfigured(clientId))) return { map, cost: 0, fetched: 0 };

  await assertBudget(admin, clientId, EST.volume(missing.length), "manual");
  const { result, cost } = await dfsPost(clientId, "/dataforseo_labs/google/keyword_overview/live", { keywords: missing, location_code: target.location_code, language_code: target.language_code });
  await recordSpend(admin, clientId, "fanout_volume", cost, "manual");
  for (const k of missing) map.set(k, null);
  for (const it of arr(result?.items)) {
    const k = norm(str(it.keyword) ?? "");
    if (k) map.set(k, num(obj(it.keyword_info).search_volume));
  }
  return { map, cost, fetched: missing.length };
}

export const volumeOf = (map: Map<string, number | null>, q: string) => map.get(norm(q)) ?? null;
