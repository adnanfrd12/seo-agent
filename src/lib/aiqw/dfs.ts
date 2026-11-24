import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dfsConfigured, dfsPost } from "@/lib/dataforseo/client";
import { recordSpend } from "@/lib/dataforseo/budget";
import { arr, num, obj, resolveTarget, str, type Json } from "@/lib/dataforseo/research";
import { STATES } from "@/lib/ga4x/model";
import { clientNap } from "@/lib/reviews/listings";
import type { AiQwSettings } from "./settings";

/**
 * DataForSEO data for the quick wins engine, stored in dfs_cache with fetched_at:
 *  - "aiqw_kw": search volume, CPC, competition, keyword difficulty, intent, monthly trend and SERP features for the
 *    client's Search Console queries (DataForSEO Labs keyword overview, up to 700 keywords per call, 24-hour cache)
 *  - "aiqw_serp": live Google top 10 for one keyword (SERP API, organic advanced): our position, features, People
 *    Also Ask questions (Deep and nightly runs only, 24-hour cache)
 * Competitor keyword gaps, backlink gaps, Business Profile and reviews come from the caches the Competitors,
 * Backlinks and Local screens already keep (kw_gap, link_gap, gbp_profile, reviews).
 */
export interface KwData { keyword: string; volume: number | null; cpc: number | null; competition: number | null; difficulty: number | null; intent: string | null; trend: number[]; serp: string[]; at: string }
export interface SerpData { keyword: string; at: string; ourPosition: number | null; ourUrl: string | null; features: string[]; paa: string[]; top: { pos: number; domain: string; url: string; title: string }[]; aiOverview: boolean; localPack: string[]; /** where the results were fetched for (e.g. "Houston,Texas,United States") */ loc?: string }

const DAY = 86_400_000;
const TTL = DAY; // 24 hours
const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Where DataForSEO is asked from. Keyword data (DataForSEO Labs) is country-level: the research target's country, or
 * the settings location when it is a country. Live Google results are fetched where the customers search: the
 * settings location, else the business's own city (from its Business Profile address), else the country.
 */
export async function dfsTarget(admin: SupabaseClient, clientId: string, s: AiQwSettings) {
  const t = await resolveTarget(admin, clientId);
  if (!t) return null;
  const override = s.locationName.trim();
  const loc: Record<string, string | number> = override && !override.includes(",") ? { location_name: override } : { location_code: t.location_code };
  let serpLoc: Record<string, string | number> = override ? { location_name: override } : loc;
  if (!override && t.location_code === 2840) {
    const nap = await clientNap(admin, clientId).catch(() => null);
    const state = nap?.state ? STATES[nap.state.trim().toUpperCase()] ?? nap.state.trim() : null;
    if (nap?.city && state) serpLoc = { location_name: `${nap.city.trim()},${state},United States` };
  }
  return { domain: t.domain.replace(/^www\./, ""), loc, serpLoc, serpLocLabel: String(serpLoc.location_name ?? `location ${serpLoc.location_code}`), language_code: s.languageCode.trim() || t.language_code, competitors: t.competitors };
}

/**
 * Google now links organic results through google.com/goto, so DataForSEO's `domain` and `url` can be Google's; the
 * real site is in the breadcrumb ("https://www.fastsigns.com › galleria-tx › …").
 */
export function resultHost(i: Json): string {
  const b = str(i.breadcrumb) ?? "";
  const m = b.match(/^https?:\/\/[^\s›]+/);
  const raw = m?.[0] ?? str(i.url) ?? "";
  try { return new URL(raw).hostname.replace(/^www\./, "").toLowerCase(); } catch { return (str(i.domain) ?? "").replace(/^www\./, "").toLowerCase(); }
}
export function resultUrl(i: Json): string {
  const u = str(i.url) ?? "";
  if (!/^https?:\/\/(www\.)?google\.[a-z.]+\/goto/i.test(u)) return u;
  const parts = (str(i.breadcrumb) ?? "").split("›").map((x) => x.trim()).filter((x) => x && !x.includes("...") && x !== "…");
  return parts.length ? `${parts[0].replace(/\/$/, "")}${parts.length > 1 ? `/${parts.slice(1).join("/")}` : ""}` : u;
}

/** Month-to-date DataForSEO spend for this client: all features, or only the quick-wins engine's own calls. */
export async function dfsMonthSpend(admin: SupabaseClient, clientId: string, quickWinsOnly = false): Promise<number> {
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  let q = admin.from("dfs_spend").select("cost").eq("client_id", clientId).gte("created_at", since.toISOString());
  if (quickWinsOnly) q = q.in("endpoint", ["aiqw_kw", "aiqw_serp"]);
  const { data } = await q.limit(5000);
  return (data ?? []).reduce((a, r) => a + Number(r.cost ?? 0), 0);
}

/** Stored keyword data, by normalised keyword. */
export async function loadKw(admin: SupabaseClient, clientId: string): Promise<Map<string, KwData>> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "aiqw_kw").limit(50);
  const m = new Map<string, KwData>();
  for (const r of data ?? []) for (const k of ((r.data as { items?: KwData[] })?.items ?? [])) {
    const cur = m.get(norm(k.keyword));
    if (!cur || cur.at < k.at) m.set(norm(k.keyword), k);
  }
  return m;
}

/**
 * Fetches keyword data for the keywords that have none or are older than 24 hours (at most `max`), one call per
 * 700 keywords. Returns what was spent. Budget is the caller's job.
 */
export async function refreshKw(admin: SupabaseClient, clientId: string, s: AiQwSettings, keywords: string[], max = 700): Promise<{ fetched: number; cost: number }> {
  if (!dfsConfigured()) return { fetched: 0, cost: 0 };
  const t = await dfsTarget(admin, clientId, s);
  if (!t) return { fetched: 0, cost: 0 };
  const have = await loadKw(admin, clientId);
  const now = Date.now();
  const want = [...new Set(keywords.map(norm))].filter((k) => k.length > 1 && k.length <= 80 && k.split(" ").length <= 10)
    .filter((k) => { const h = have.get(k); return !h || now - Date.parse(h.at) > TTL; }).slice(0, max);
  let cost = 0, fetched = 0;
  for (let i = 0; i < want.length; i += 700) {
    const batch = want.slice(i, i + 700);
    const { result, cost: c } = await dfsPost("/dataforseo_labs/google/keyword_overview/live", { keywords: batch, ...t.loc, language_code: t.language_code, include_serp_info: true });
    cost += c;
    await recordSpend(admin, clientId, "aiqw_kw", c, "manual");
    const at = new Date().toISOString();
    const items: KwData[] = arr(result?.items).map((it) => {
      const info = obj(it.keyword_info);
      return {
        keyword: norm(str(it.keyword) ?? ""), volume: num(info.search_volume), cpc: num(info.cpc), competition: num(info.competition),
        difficulty: num(obj(it.keyword_properties).keyword_difficulty), intent: str(obj(it.search_intent_info).main_intent),
        trend: arr(info.monthly_searches).slice(0, 12).map((m) => num(m.search_volume) ?? 0).reverse(),
        serp: (Array.isArray(obj(it.serp_info).serp_item_types) ? (obj(it.serp_info).serp_item_types as unknown[]) : []).map(String), at,
      };
    }).filter((k) => k.keyword);
    // keywords DataForSEO had no data for are stored too, so they aren't asked for again within the day
    const got = new Set(items.map((k) => k.keyword));
    for (const k of batch) if (!got.has(k)) items.push({ keyword: k, volume: null, cpc: null, competition: null, difficulty: null, intent: null, trend: [], serp: [], at });
    fetched += items.length;
    await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: "aiqw_kw", params_hash: `${at.slice(0, 10)}:${i}`, params: { count: batch.length }, data: { items }, row_count: items.length, cost: c, fetched_at: at }, { onConflict: "client_id,endpoint,params_hash" });
  }
  // keep the last 14 days of rows
  await admin.from("dfs_cache").delete().eq("client_id", clientId).eq("endpoint", "aiqw_kw").lt("fetched_at", new Date(now - 14 * DAY).toISOString());
  return { fetched, cost };
}

export async function loadSerp(admin: SupabaseClient, clientId: string): Promise<Map<string, SerpData>> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "aiqw_serp").order("fetched_at", { ascending: false }).limit(200);
  const m = new Map<string, SerpData>();
  for (const r of data ?? []) { const d = r.data as SerpData; if (d?.keyword && !m.has(d.keyword)) m.set(d.keyword, d); }
  return m;
}

/** Live Google top 10 for up to `max` keywords that have no result from the last 24 hours. */
export async function refreshSerp(admin: SupabaseClient, clientId: string, s: AiQwSettings, keywords: string[], max = 20): Promise<{ fetched: number; cost: number }> {
  if (!dfsConfigured()) return { fetched: 0, cost: 0 };
  const t = await dfsTarget(admin, clientId, s);
  if (!t) return { fetched: 0, cost: 0 };
  const have = await loadSerp(admin, clientId);
  const now = Date.now();
  // a result older than a day, or fetched for another location, is fetched again
  const want = [...new Set(keywords.map(norm))].filter((k) => { const h = have.get(k); return !h || now - Date.parse(h.at) > TTL || h.loc !== t.serpLocLabel; }).slice(0, max);
  let cost = 0, fetched = 0;
  const one = async (keyword: string) => {
    const { result, cost: c } = await dfsPost("/serp/google/organic/live/advanced", { keyword, ...t.serpLoc, language_code: t.language_code, depth: 10 });
    cost += c;
    await recordSpend(admin, clientId, "aiqw_serp", c, "manual");
    const items = arr(result?.items);
    const organic = items.filter((i) => i.type === "organic");
    const mine = organic.find((i) => resultHost(i).endsWith(t.domain));
    const paa = items.filter((i) => i.type === "people_also_ask").flatMap((i) => arr(i.items).map((q) => str(q.title)).filter((q): q is string => Boolean(q)));
    const local = items.filter((i) => i.type === "local_pack").map((i) => str(i.title)).filter((x): x is string => Boolean(x));
    const at = new Date().toISOString();
    const d: SerpData = {
      keyword, at, loc: t.serpLocLabel, ourPosition: mine ? num(mine.rank_group) : null, ourUrl: mine ? resultUrl(mine) : null,
      features: [...new Set(items.map((i) => String(i.type)).filter((x) => x !== "organic"))], paa: [...new Set(paa)].slice(0, 8),
      top: organic.slice(0, 10).map((i) => ({ pos: num(i.rank_group) ?? 0, domain: resultHost(i), url: resultUrl(i), title: str(i.title) ?? "" })),
      aiOverview: items.some((i) => i.type === "ai_overview"), localPack: local.slice(0, 3),
    };
    await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: "aiqw_serp", params_hash: keyword.slice(0, 200), params: { keyword }, data: d, row_count: d.top.length, cost: c, fetched_at: at }, { onConflict: "client_id,endpoint,params_hash" });
    fetched++;
  };
  // all at once (at most 20): each live request takes 20-40 seconds on DataForSEO's side
  await Promise.all(want.map((k) => one(k).catch(() => undefined)));
  return { fetched, cost };
}

export interface GapRow { keyword: string; volume: number | null; difficulty: number | null; intent: string | null; their_position: number | null; their_url: string | null; their_traffic: number | null; competitor: string }
export interface LinkGapRow { domain: string; rank: number | null; spam: number | null; competitors: string[] }

/** Competitor keyword gaps and referring-domain gaps already fetched by the Competitors and Backlinks screens. */
export async function loadGaps(admin: SupabaseClient, clientId: string): Promise<{ kw: GapRow[]; links: LinkGapRow[]; competitors: string[]; at: string | null }> {
  const { data } = await admin.from("dfs_cache").select("endpoint, params, data, fetched_at").eq("client_id", clientId).in("endpoint", ["kw_gap", "link_gap"]).order("fetched_at", { ascending: false }).limit(40);
  const kw: GapRow[] = [], linkMap = new Map<string, LinkGapRow>(), comps = new Set<string>();
  const seen = new Set<string>();
  let at: string | null = null;
  for (const r of data ?? []) {
    const p = obj(r.params);
    const comp = String(p.target1 ?? p.competitor ?? obj(p.targets)["1"] ?? "");
    if (!comp || seen.has(`${r.endpoint}:${comp}`)) continue;
    seen.add(`${r.endpoint}:${comp}`);
    comps.add(comp);
    if (!at || r.fetched_at > at) at = r.fetched_at as string;
    const rows = arr(obj(r.data).rows);
    if (r.endpoint === "kw_gap") for (const x of rows) kw.push({ keyword: norm(String(x.keyword ?? "")), volume: num(x.volume), difficulty: num(x.difficulty), intent: str(x.intent), their_position: num(x.their_position), their_url: str(x.their_url), their_traffic: num(x.their_traffic), competitor: comp });
    else for (const x of rows) {
      const d = String(x.domain ?? "");
      if (!d) continue;
      const cur = linkMap.get(d) ?? { domain: d, rank: num(x.rank), spam: num(x.spam), competitors: [] };
      if (!cur.competitors.includes(comp)) cur.competitors.push(comp);
      linkMap.set(d, cur);
    }
  }
  return { kw, links: [...linkMap.values()], competitors: [...comps], at };
}
