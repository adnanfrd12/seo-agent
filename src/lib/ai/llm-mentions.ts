import "server-only";
import { BudgetError } from "@/lib/dataforseo/budget";
import { arr, ensure, num, obj, str, type Ctx, type Json, type Spec, type Target } from "@/lib/dataforseo/research";

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
