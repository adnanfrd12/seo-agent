import "server-only";
import { BudgetError } from "@/lib/dataforseo/budget";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localIdentity } from "@/lib/dataforseo/local";
import { arr, ensure, num, obj, str, type Ctx, type Json, type Spec, type Target } from "@/lib/dataforseo/research";
import { brandStats, loadAi } from "./visibility";

/**
 * AI market data from DataForSEO's LLM Mentions API: across millions of real ChatGPT and Google AI
 * Overview answers in the US, which websites are cited most for the client's topics, and how much AI
 * search volume those questions have. Sentiment is not part of this API; it comes from our own answers
 * (see visibility.ts). Small local sites rarely appear in this dataset, so it is shown as the market view.
 * About $0.10 per platform, refreshed weekly.
 */
export const LLM_PLATFORMS = ["google", "chat_gpt"] as const;
export type LlmPlatform = (typeof LLM_PLATFORMS)[number];
export const LLM_LABEL: Record<LlmPlatform, string> = { google: "Google AI Overviews", chat_gpt: "ChatGPT" };
export const LLM_EST = 0.11;

export interface LlmGroup { key: string; mentions: number; volume: number | null }
export interface LlmTopic {
  platform: LlmPlatform; topics: string[]; mentions: number; volume: number | null;
  /** most-mentioned domains for the topic, with their own mention counts */
  domains: LlmGroup[];
  sources: LlmGroup[]; results: LlmGroup[]; brands: LlmGroup[]; categories: LlmGroup[];
}

const bare = (d: string) => d.replace(/^www\./, "").toLowerCase();
const group = (v: unknown): LlmGroup[] => arr(v).map((g) => ({ key: str(g.key) ?? "", mentions: num(g.mentions) ?? 0, volume: num(g.ai_search_volume) })).filter((g) => g.key);
const sum = (l: LlmGroup[]) => l.reduce((a, g) => a + g.mentions, 0);

const spec = (platform: LlmPlatform): Spec => ({
  key: `llm_topic_${platform}`, tier: 2, ttlDays: 7, est: LLM_EST, path: "/ai_optimization/llm_mentions/top_domains/live",
  body: (_t: Target, extra?: string) => ({
    target: (extra ?? "").split("|").filter(Boolean).slice(0, 3).map((keyword) => ({ keyword: keyword.replace(/%/g, "%25").replace(/\+/g, "%2B"), search_scope: ["question"], match_type: "partial_match" })),
    platform, location_code: 2840, language_code: "en", links_scope: "sources", items_list_limit: 10, internal_list_limit: 10,
  }),
  shape: (r: Json | null, extra?: string): LlmTopic => {
    const total = obj(r?.total);
    const plat = group(total.platform);
    return {
      platform, topics: (extra ?? "").split("|").filter(Boolean), mentions: sum(plat), volume: plat.reduce<number | null>((a, g) => (g.volume == null ? a : (a ?? 0) + g.volume), null),
      domains: arr(r?.items).map((i) => { const p = group(i.platform); return { key: bare(str(i.key) ?? ""), mentions: sum(p), volume: p[0]?.volume ?? null }; }).filter((d) => d.key),
      sources: group(total.sources_domain).map((g) => ({ ...g, key: bare(g.key) })), results: group(total.search_results_domain).map((g) => ({ ...g, key: bare(g.key) })),
      brands: group(total.brand_entities_title), categories: group(total.brand_entities_category),
    };
  },
});
export const LLM_SPECS: Record<LlmPlatform, Spec> = { google: spec("google"), chat_gpt: spec("chat_gpt") };

/**
 * The client's topic as people phrase it, without the place or the question words: "led signs houston",
 * "led signs for business" → "led sign". Several targets in one request must ALL match, so one topic is
 * used: the two-word head the tracked AI questions share most (they are about the business, while ranked
 * keywords can drift, e.g. "billboard"), then the keywords by search volume, then the business category.
 */
const STOP = new Set(["how", "much", "what", "who", "best", "near", "me", "for", "the", "a", "an", "of", "to", "is", "are", "does", "do", "cost", "price", "in", "and", "custom", "cheap",
  "are", "can", "i", "where", "which", "why", "get", "made", "make", "recommend", "specific", "businesses", "business", "companies", "company", "offers", "top", "good", "local", "my", "you"]);
export function llmTopics(questions: string[], keywords: { keyword: string; volume: number | null }[], city: string | null, category: string | null): string[] {
  const place = (city ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const head = (k: string) => {
    const words = k.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w) && !place.includes(w) && !["tx", "texas"].includes(w)).slice(0, 2);
    if (!words.length) return "";
    const last = words[words.length - 1];
    words[words.length - 1] = last.length > 3 && last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
    return words.join(" ");
  };
  const score = new Map<string, number>();
  for (const q of questions) { const h = head(q); if (h.length >= 4) score.set(h, (score.get(h) ?? 0) + 1e9); }
  for (const k of keywords) { const h = head(k.keyword); if (h.length >= 4) score.set(h, (score.get(h) ?? 0) + Math.max(1, k.volume ?? 0)); }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (category ? head(category) : "");
  return best ? [best] : [];
}

/** Refreshes both platforms when older than a week. Budget errors stop the run quietly. */
export async function refreshLlmMentions(ctx: Ctx, target: Target, topics: string[], force = false): Promise<{ fetched: number; cost: number; error: string | null }> {
  if (!topics.length) return { fetched: 0, cost: 0, error: null };
  let fetched = 0, cost = 0;
  for (const p of LLM_PLATFORMS) {
    try {
      const r = await ensure(ctx, LLM_SPECS[p], target, { force, extra: topics.join("|") });
      if (!r.fromCache) fetched++;
      cost += r.cost;
    } catch (e) {
      return { fetched, cost, error: e instanceof BudgetError ? e.message : e instanceof Error ? e.message : "failed" };
    }
  }
  return { fetched, cost, error: null };
}

/* ------------------------------------------------------------------ brand lookup */
/**
 * Brand lookup: how often real US AI answers name the client's brand, and the same for up to three
 * competitor brands (share of voice), from DataForSEO's Multi-Target Metrics (one call per view, every
 * brand a keyword target):
 *   - entities  : ChatGPT answers where the assistant names the brand AS A BRAND (its brand entities), the
 *                 reliable signal, since local brand names are often everyday phrases ("LED lights and signs")
 *   - chat_gpt / google : the brand name as words anywhere in the answer text (ChatGPT, Google AI Overviews);
 *                 counts generic uses of the phrase too, so it is an upper bound
 * plus one Historical call for the client's monthly brand-entity trend. About $0.42 a week.
 */
export const BRAND_EST = 0.11;
export const MAX_BRAND_RIVALS = 3;
export type BrandView = "entities" | "chat_gpt" | "google";
export const BRAND_VIEWS: BrandView[] = ["entities", "chat_gpt", "google"];
export const BRAND_VIEW_LABEL: Record<BrandView, string> = { entities: "ChatGPT · named as a brand", chat_gpt: "ChatGPT · phrase in answer", google: "Google AI Overviews · phrase in answer" };
export interface BrandMetric { brand: string; own: boolean; mentions: number; volume: number | null }
export interface BrandLookup { view: BrandView; brands: BrandMetric[] }
export interface BrandHistory { brand: string; months: { month: string; mentions: number; volume: number | null }[] }

const kw = (k: string) => k.replace(/%/g, "%25").replace(/\+/g, "%2B");
const brandList = (extra?: string) => (extra ?? "").split("|").map((b) => b.trim()).filter(Boolean).slice(0, 1 + MAX_BRAND_RIVALS);
const entity = (b: string, view: BrandView) => (view === "entities" ? { keyword: kw(b), search_scope: ["brand_entities"] } : { keyword: kw(b), search_scope: ["answer"], match_type: "word_match" });

const brandSpec = (view: BrandView): Spec => ({
  key: `llm_brand_${view}`, tier: 2, ttlDays: 7, est: BRAND_EST, path: "/ai_optimization/llm_mentions/multi_target_metrics/live",
  body: (_t: Target, extra?: string) => ({
    targets: brandList(extra).map((b) => ({ key: b, target: [entity(b, view)] })),
    platform: view === "google" ? "google" : "chat_gpt", location_code: 2840, language_code: "en", internal_list_limit: 1,
  }),
  shape: (r: Json | null, extra?: string): BrandLookup => {
    const items = arr(r?.items);
    return {
      view,
      brands: brandList(extra).map((b, i) => {
        const it = items.find((x) => str(x.key) === b) ?? {};
        const total = obj(it.total), plat = group(it.platform);
        return { brand: b, own: i === 0, mentions: num(total.mentions) ?? sum(plat), volume: num(total.ai_search_volume) ?? plat.reduce<number | null>((a, g) => (g.volume == null ? a : (a ?? 0) + g.volume), null) };
      }),
    };
  },
});
export const BRAND_SPECS: Record<BrandView, Spec> = { entities: brandSpec("entities"), chat_gpt: brandSpec("chat_gpt"), google: brandSpec("google") };
/** Monthly ChatGPT answers naming the client's brand as a brand, since August 2025. */
export const BRAND_HISTORY_SPEC: Spec = {
  key: "llm_brand_history", tier: 2, ttlDays: 7, est: BRAND_EST, path: "/ai_optimization/llm_mentions/historical/live",
  body: (_t: Target, extra?: string) => ({ target: [entity(brandList(extra)[0] ?? "", "entities")], platform: "chat_gpt", date_from: "2025-08-01", location_code: 2840, language_code: "en" }),
  shape: (r: Json | null, extra?: string): BrandHistory => ({
    brand: brandList(extra)[0] ?? "",
    months: arr(r?.items).map((i) => {
      const m = obj(i.metrics);
      const y = num(i.year), mo = num(i.month);
      return { month: y && mo ? `${y}-${String(mo).padStart(2, "0")}` : "", mentions: num(m.mentions) ?? 0, volume: num(m.ai_search_volume) };
    }).filter((x) => x.month && x.month >= "2025-08").sort((a, b) => a.month.localeCompare(b.month)),
  }),
};

/** The brand names to look up: the Business Profile name first, then the competitors AI answers name most (else nearby Google competitors). */
export function brandLookupNames(own: string, aiRivals: string[], gbpRivals: string[]): string[] {
  const clean = (s: string) => s.split(/\s[|–-]\s|\s\|/)[0].replace(/\s+/g, " ").trim();
  const me = clean(own);
  const out = [me];
  for (const n of [...aiRivals, ...gbpRivals].map(clean)) {
    if (out.length > MAX_BRAND_RIVALS) break;
    if (n.length >= 3 && n.length <= 60 && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return me ? out : [];
}

/** Refreshes the brand lookup (three views + the client's monthly history) when older than a week. */
export async function refreshBrandLookup(ctx: Ctx, target: Target, brands: string[], force = false): Promise<{ fetched: number; cost: number; error: string | null }> {
  if (brands.length < 2) return { fetched: 0, cost: 0, error: brands.length ? "No competitor brands to compare yet." : null };
  let fetched = 0, cost = 0;
  const extra = brands.join("|");
  for (const spec of [...BRAND_VIEWS.map((v) => BRAND_SPECS[v]), BRAND_HISTORY_SPEC]) {
    try {
      const r = await ensure(ctx, spec, target, { force, extra });
      if (!r.fromCache) fetched++;
      cost += r.cost;
    } catch (e) {
      return { fetched, cost, error: e instanceof BudgetError ? e.message : e instanceof Error ? e.message : "failed" };
    }
  }
  return { fetched, cost, error: null };
}

/** Brand names for a client from stored data only (no API calls). */
export async function brandNamesFor(admin: SupabaseClient, clientId: string, site: string): Promise<string[]> {
  const [me, ai, { data: client }, { data: profiles }] = await Promise.all([
    localIdentity(admin, clientId), loadAi(admin, clientId),
    admin.from("clients").select("name").eq("id", clientId).maybeSingle(),
    admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", "gbp_profile"),
  ]);
  const self = (profiles ?? []).find((p) => p.params_hash === "self")?.data as { title?: string | null } | null;
  const own = me?.name || self?.title || (client?.name as string | undefined) || "";
  const aiRivals = ai.ok ? brandStats(ai, site).filter((b) => !b.own).map((b) => b.name) : [];
  const gbpRivals = (profiles ?? []).filter((p) => p.params_hash !== "self").map((p) => String((p.data as { title?: string } | null)?.title ?? "")).filter(Boolean);
  return brandLookupNames(own, aiRivals, gbpRivals);
}
