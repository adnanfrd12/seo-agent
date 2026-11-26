/**
 * Fan-out queries: types, limits and cost estimates shared by the server code and the browser (no server imports here).
 * A "fan-out" is the set of sub-queries an AI search engine (Google AI Mode / AI Overviews, ChatGPT search) expands
 * one question into before it answers.
 */
export const FANOUT_TYPES = ["reformulation", "related", "implicit", "comparative", "entity", "personalised", "recent"] as const;
export type FanoutType = (typeof FANOUT_TYPES)[number];
export const TYPE_LABEL: Record<FanoutType, string> = {
  reformulation: "Reformulation", related: "Related", implicit: "Implicit", comparative: "Comparative",
  entity: "Entity expansion", personalised: "Personalised", recent: "Recent / follow-up",
};

export type FanoutMode = "ai_overview" | "ai_mode";
export const MODE_LABEL: Record<FanoutMode, string> = { ai_overview: "AI Overview (about 10)", ai_mode: "AI Mode (about 20)" };
export type Coverage = "covered" | "partial" | "missing";

export interface FanoutQuery { query: string; type: FanoutType; intent: string; reasoning: string; coverage?: Coverage; suggestion?: string; volume?: number | null }
export interface PageSummary { url: string; title: string | null; topic: string; mainQuery: string; covered: number; partial: number; missing: number }

/** Per-run caps: keep a run inside one request (about 5 minutes) and a predictable cost. */
export const MAX_KEYWORDS = 25;
export const MAX_PAGES = 10;

/** Rough Claude cost (Sonnet 5.5, $2 / $10 per million tokens) per keyword and per page, measured on real runs. */
export const EST = {
  keyword: { ai_overview: 0.012, ai_mode: 0.022 } as Record<FanoutMode, number>,
  page: { ai_overview: 0.03, ai_mode: 0.045 } as Record<FanoutMode, number>,
  /** DataForSEO keyword_overview: about $0.01 per call plus $0.0001 per keyword */
  volume: (keywords: number) => (keywords > 0 ? 0.01 + keywords * 0.0001 : 0),
};
export const QUERIES_PER: Record<FanoutMode, number> = { ai_overview: 10, ai_mode: 20 };

export function estimate(kind: "keywords" | "pages", count: number, mode: FanoutMode, volume: boolean) {
  const ai = count * (kind === "keywords" ? EST.keyword[mode] : EST.page[mode]);
  const vol = volume ? EST.volume(count * QUERIES_PER[mode]) : 0;
  return { ai, volume: vol, total: ai + vol };
}

export const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

/** One keyword per line (commas and semicolons also split), cleaned and de-duplicated. */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  return text.split(/[\n,;\t]+/).map((k) => k.trim().toLowerCase().replace(/\s+/g, " ")).filter((k) => k.length > 1 && k.length <= 120 && !seen.has(k) && (seen.add(k), true));
}
