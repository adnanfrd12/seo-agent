import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOT_UA } from "@/lib/blog/wordpress";
import { decodeEntities, htmlToText, wordCount } from "@/lib/blog/parse";
import { assertBudget, recordSpend, type SpendSource } from "@/lib/dataforseo/budget";
import { dfsPost } from "@/lib/dataforseo/client";
import { arr, num, obj, str } from "@/lib/dataforseo/research";

/**
 * Storage and shared helpers for the SEO Toolkit (/toolkit/*). Each tool keeps exactly ONE dfs_cache row per client
 * (endpoint "tk_<slug>", params_hash "tk_<slug>"), overwritten on every run, so the toolkit never crowds out
 * the research rows that loadCache reads. Methodology adapted from the MIT-licensed claude-seo skills
 * (https://github.com/AgricIDaniel/claude-seo).
 */
export interface Stored<T> { data: T; fetchedAt: string; cost: number }

export async function saveTool(admin: SupabaseClient, clientId: string, slug: string, data: unknown, cost: number, params: Record<string, unknown> = {}) {
  const key = `tk_${slug}`;
  const { error } = await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: key, params_hash: key, params, data, row_count: 0, cost: Number(cost.toFixed(4)), fetched_at: new Date().toISOString() },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  if (error) throw new Error(`Couldn't save the result: ${error.message}`);
}

export async function loadTool<T>(supabase: SupabaseClient, clientId: string, slug: string): Promise<Stored<T> | null> {
  const { data } = await supabase.from("dfs_cache").select("data, fetched_at, cost").eq("client_id", clientId).eq("endpoint", `tk_${slug}`).maybeSingle();
  return data ? { data: data.data as T, fetchedAt: data.fetched_at as string, cost: Number(data.cost ?? 0) } : null;
}

/* ------------------------------------------------------------------ fetching pages */
export const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
export const hostOf = (u: string) => { try { return bare(new URL(u).host); } catch { return ""; } };

/** Only pages on the client's own website are fetched from user input (no fetching arbitrary hosts). */
export function ownUrl(input: string, domain: string): string | null {
  const raw = input.trim() || `https://${domain}/`;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : raw.startsWith("/") ? `https://${domain}${raw}` : `https://${raw}`);
    if (!["http:", "https:"].includes(u.protocol) || hostOf(u.toString()) !== bare(domain)) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
}

export async function fetchHtml(url: string, timeoutMs = 45_000): Promise<{ status: number | null; finalUrl: string; html: string; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": BOT_UA, accept: "text/html,*/*;q=0.8" }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    const html = (res.headers.get("content-type") ?? "").includes("html") ? await res.text() : (await res.body?.cancel(), "");
    return { status: res.status, finalUrl: res.url || url, html, ms: Date.now() - t0 };
  } catch {
    return { status: null, finalUrl: url, html: "", ms: Date.now() - t0 };
  }
}

const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i")); return m ? decodeEntities(m[2] ?? m[3] ?? "") : null; };
export { attr as htmlAttr };

export interface Outline { title: string | null; desc: string | null; headings: { level: number; text: string }[]; words: number; text: string }
/** Title, description, H1-H6 outline and main text of a page. */
export function outline(html: string): Outline {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const descTag = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, "name") ?? "").toLowerCase() === "description");
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const main = body.match(/<main[\s\S]*<\/main>/i)?.[0] ?? body.match(/<article[\s\S]*<\/article>/i)?.[0] ?? body;
  const clean = main.replace(/<(header|footer|nav|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => ({ level: Number(m[1]), text: decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }))
    .filter((h) => h.text).slice(0, 80);
  const text = htmlToText(clean);
  return { title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() : null, desc: descTag ? attr(descTag, "content") : null, headings, words: wordCount(text), text };
}

/* ------------------------------------------------------------------ readability (deterministic) */
const syllables = (w: string) => {
  const s = w.toLowerCase().replace(/[^a-z]/g, "");
  if (s.length <= 3) return s ? 1 : 0;
  return Math.max(1, (s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g) ?? []).length);
};
export interface Readability { words: number; sentences: number; avgSentence: number; flesch: number; grade: number; longSentencePct: number }
/** Flesch Reading Ease and Flesch-Kincaid grade from the visible text. */
export function readability(text: string): Readability {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const sc = Math.max(1, sentences.length), wc = Math.max(1, words.length);
  const asl = wc / sc, asw = syl / wc;
  return {
    words: words.length, sentences: sentences.length, avgSentence: Number(asl.toFixed(1)),
    flesch: Math.round(Math.max(0, Math.min(100, 206.835 - 1.015 * asl - 84.6 * asw))),
    grade: Number(Math.max(0, 0.39 * asl + 11.8 * asw - 15.59).toFixed(1)),
    longSentencePct: Math.round((sentences.filter((s) => s.split(/\s+/).length > 25).length / sc) * 100),
  };
}

/* ------------------------------------------------------------------ Google SERP (DataForSEO, paid) */
export const SERP_EST = 0.002; // live advanced, depth 10 (same price as rank checks at depth <= 10)
export interface SerpResult { url: string; domain: string; title: string; description: string; position: number }
export interface Serp { keyword: string; checkedAt: string; organic: SerpResult[]; paa: string[]; related: string[]; features: string[] }

export async function fetchSerp(admin: SupabaseClient, clientId: string, keyword: string, locationCode: number, languageCode: string, source: SpendSource = "manual"): Promise<{ serp: Serp; cost: number }> {
  await assertBudget(admin, clientId, SERP_EST, source);
  const { result, cost } = await dfsPost("/serp/google/organic/live/advanced", { keyword, location_code: locationCode, language_code: languageCode, device: "desktop", depth: 10 }, { timeoutMs: 90_000, attempts: 1 });
  await recordSpend(admin, clientId, "toolkit_serp", cost, source);
  const items = arr(result?.items);
  const organic = items.filter((i) => i.type === "organic").map((i) => ({
    url: str(i.url) ?? "", domain: bare(str(i.domain) ?? ""), title: str(i.title) ?? "", description: (str(i.description) ?? "").slice(0, 240), position: num(i.rank_group) ?? 0,
  })).filter((r) => r.url).slice(0, 10);
  const paa = items.filter((i) => i.type === "people_also_ask").flatMap((i) => arr(i.items).map((q) => str(q.title) ?? "")).filter(Boolean).slice(0, 8);
  const related = items.filter((i) => i.type === "related_searches").flatMap((i) => (Array.isArray(i.items) ? (i.items as unknown[]).map((x) => (typeof x === "string" ? x : str(obj(x).title) ?? "")) : [])).filter(Boolean).slice(0, 10);
  const features = [...new Set(items.map((i) => str(i.type) ?? "").filter((t) => t && t !== "organic"))];
  return { serp: { keyword, checkedAt: new Date().toISOString(), organic, paa, related, features }, cost };
}

/** SERPs already stored by another toolkit tool (cluster / SXO / brief) within `days`, so the same search isn't paid twice. */
export async function storedSerps(admin: SupabaseClient, clientId: string, days = 14): Promise<Map<string, Serp>> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).in("endpoint", ["tk_seo-cluster", "tk_seo-sxo", "tk_seo-content-brief"]);
  const out = new Map<string, Serp>();
  const cutoff = Date.now() - days * 86_400_000;
  for (const r of data ?? []) {
    for (const s of ((r.data as { serps?: Serp[] } | null)?.serps ?? [])) if (s?.keyword && Date.parse(s.checkedAt) > cutoff) out.set(s.keyword.toLowerCase(), s);
  }
  return out;
}

/* ------------------------------------------------------------------ the site's keywords (stored data only) */
export interface SiteKeyword { keyword: string; volume: number | null; position: number | null; url: string | null; impressions: number; clicks: number; intent: string | null }

/** ranked_keywords from DataForSEO plus the last 90 days of Search Console queries, merged by keyword. */
export async function siteKeywords(admin: SupabaseClient, clientId: string): Promise<SiteKeyword[]> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [rk, gsc, gp] = await Promise.all([
    admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "ranked_keywords").order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("gsc_query_metrics").select("query, clicks, impressions, position_x_impressions").eq("client_id", clientId).gte("metric_date", since).limit(20000),
    admin.from("gsc_query_page_metrics").select("query, page, impressions").eq("client_id", clientId).gte("metric_date", since).limit(20000),
  ]);
  const map = new Map<string, SiteKeyword & { pxi: number }>();
  for (const r of ((rk.data?.data ?? []) as Record<string, unknown>[])) {
    const k = String(r.keyword ?? "").toLowerCase().trim();
    if (!k) continue;
    map.set(k, { keyword: k, volume: num(r.volume), position: num(r.position), url: str(r.url), impressions: 0, clicks: 0, intent: str(r.intent), pxi: 0 });
  }
  for (const r of gsc.data ?? []) {
    const k = String(r.query ?? "").toLowerCase().trim();
    if (!k) continue;
    const o = map.get(k) ?? { keyword: k, volume: null, position: null, url: null, impressions: 0, clicks: 0, intent: null, pxi: 0 };
    o.impressions += Number(r.impressions ?? 0); o.clicks += Number(r.clicks ?? 0); o.pxi += Number(r.position_x_impressions ?? 0);
    map.set(k, o);
  }
  const bestPage = new Map<string, { page: string; imp: number }>();
  for (const r of gp.data ?? []) {
    const k = String(r.query ?? "").toLowerCase().trim();
    const imp = Number(r.impressions ?? 0);
    const cur = bestPage.get(`${k}|${r.page}`);
    bestPage.set(`${k}|${r.page}`, { page: String(r.page), imp: (cur?.imp ?? 0) + imp });
  }
  const top = new Map<string, { page: string; imp: number }>();
  for (const [key, v] of bestPage) { const k = key.split("|")[0]; if ((top.get(k)?.imp ?? -1) < v.imp) top.set(k, v); }
  return [...map.values()].map(({ pxi, ...o }) => ({
    ...o, url: o.url ?? top.get(o.keyword)?.page ?? null,
    position: o.position ?? (o.impressions > 0 ? Number((pxi / o.impressions).toFixed(1)) : null),
  }));
}

export const demand = (k: SiteKeyword) => (k.volume ?? 0) + k.impressions / 3;
