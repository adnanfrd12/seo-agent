/** Shared shapes of the AI quick wins engine (server and client). */
/** Every data source the portal has, as one quick-wins input each (social platforms one by one). */
export const SOCIAL_SOURCES = ["youtube", "facebook", "instagram", "threads", "x", "tiktok", "pinterest", "linkedin"] as const;
export type SocialSource = (typeof SOCIAL_SOURCES)[number];
export type Source = "gsc" | "ga4" | "gbp" | "bing" | "clarity" | SocialSource | "dataforseo" | "crawl" | "seosignalx";
export const SOURCES: Source[] = ["gsc", "ga4", "gbp", "bing", "clarity", ...SOCIAL_SOURCES, "dataforseo", "crawl", "seosignalx"];
export const SOURCE_LABEL: Record<Source | "claude", string> = {
  gsc: "Search Console", ga4: "Google Analytics 4", gbp: "Google Business Profile", bing: "Bing Webmaster Tools", clarity: "Microsoft Clarity",
  youtube: "YouTube", facebook: "Facebook", instagram: "Instagram", threads: "Threads", x: "X", tiktok: "TikTok", pinterest: "Pinterest", linkedin: "LinkedIn",
  dataforseo: "DataForSEO", crawl: "Site crawl", seosignalx: "SEOSignalX audits", claude: "Claude",
};
/** Short badge text on quick-win cards. */
export const SOURCE_SHORT: Record<Source | "claude", string> = { ...SOURCE_LABEL, ga4: "GA4", gbp: "Business Profile", bing: "Bing", clarity: "Clarity", crawl: "Crawl", seosignalx: "SEOSignalX" };

export interface Fact { name: string; value: number | string; source: Source }
export interface CandQuery { query: string; impressions?: number; clicks?: number; position?: number; ctr?: number; search_volume?: number; difficulty?: number; serp_features?: string[] }
export interface PageContext { title: string | null; h1: string | null; h2s: string[]; word_count: number | null; internal_links_in: number | null; schema_types: string[] }

/** One opportunity found by code. Every number Claude may quote is in `facts`, `queries` or `computed_gain`. */
export interface Candidate {
  candidate_id: string;
  rule: string;
  page_url: string;
  scope_screens: string[];
  facts: Fact[];
  queries: CandQuery[];
  page_context: PageContext | null;
  computed_gain: number;
  gain_unit: "clicks/mo" | "leads/mo";
  effort_hint: "Low" | "Medium" | "High";
  sources: Source[];
  /** the rule's own draft (title, place, steps, suggested text), a starting point Claude may improve */
  draft: { title: string; where: string; steps: string[]; suggest?: string; measure?: string };
}

export type Effort = "Low" | "Medium" | "High";
export type Confidence = "High" | "Medium" | "Low";
export type Status = "todo" | "doing" | "done" | "dismissed";
export const STATUS_LABEL: Record<Status, string> = { todo: "To do", doing: "In progress", done: "Done", dismissed: "Dismissed" };

/** A validated quick win as stored and shown. */
export interface StoredWin {
  key: string;
  run_id: string;
  rule: string;
  title: string;
  type: string;
  page_url: string;
  where: string;
  why: string;
  steps: string[];
  suggested_change: string | null;
  queries_to_use: string[];
  effort: Effort;
  confidence: Confidence;
  measure: string;
  plain_summary: string;
  sources: (Source | "claude")[];
  scope_screens: string[];
  evidence: { name: string; value: string; source: Source }[];
  computed_gain: number;
  gain_unit: "clicks/mo" | "leads/mo";
  score: number;
  rank: number;
  status: Status;
  owner: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  /** metrics for the affected page/queries when the item was created, to compare 28 days after "done" */
  baseline: { clicks?: number; impressions?: number; ctr?: number; position?: number; leads?: number; at: string } | null;
  /** filled 28+ days after done */
  result: { clicks?: number; impressions?: number; ctr?: number; position?: number; leads?: number; at: string } | null;
  /** latest run in which the data still showed it (null = no longer found) */
  seen_run: string | null;
}

export type Scope = { kind: "site" } | { kind: "screen"; screen: string } | { kind: "page"; url: string } | { kind: "item"; key: string };
export type Depth = "standard" | "deep";

export interface RunStep { key: string; label: string; state: "pending" | "running" | "done" | "skipped" | "failed"; detail?: string; /** elapsed time of the step */ ms?: number }
export interface RunState {
  id: string;
  clientId: string;
  scope: Scope;
  depth: Depth;
  sources: Source[];
  trigger: "manual" | "nightly";
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "failed" | "waiting_batch";
  error: string | null;
  steps: RunStep[];
  counts: { candidates: number; perRule: Record<string, number>; chunks: number; chunksDone: number; kept: number; skipped: number; rejected: number; repaired: number; merged: number };
  usage: { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; dfsCost: number; model: string; log: CallLog[] };
  diff: { added: string[]; stillOpen: string[]; resolved: string[]; gone: string[] } | null;
  rejections: { key: string; reason: string }[];
  batchId?: string | null;
}
export interface CallLog { chunk: number; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; ms: number; stop: string | null }
