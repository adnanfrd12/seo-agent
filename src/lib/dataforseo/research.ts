import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, BudgetError, recordSpend, type SpendSource } from "./budget";
import { dfsPost, DfsError } from "./client";

export interface Target { domain: string; location_code: number; language_code: string }
type Json = Record<string, unknown>;
type Row = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : null);
const top = (v: unknown, n = 10) =>
  Object.entries(obj(v)).map(([name, count]) => ({ name, count: Number(count) || 0 })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, n);

export interface Spec {
  key: string;
  tier: 1 | 2;
  /** how long a stored answer is reused before a refresh is allowed */
  ttlDays: number;
  /** pre-call budget estimate in dollars (measured on real calls, rounded up) */
  est: number;
  path: string;
  body: (t: Target, extra?: string) => Json;
  shape: (result: Json | null) => unknown;
}

const monthsAgo = (n: number) => new Date(Date.now() - n * 30.4 * 86_400_000).toISOString().slice(0, 10);

const backlinkRow = (i: Json): Row => ({
  from: str(i.url_from), domain: str(i.domain_from), to: str(i.url_to), anchor: str(i.anchor), dofollow: i.dofollow === true,
  first_seen: day(i.first_seen), last_seen: day(i.last_seen), rank: num(i.rank), domain_rank: num(i.domain_from_rank), page_rank: num(i.page_from_rank),
  spam: num(i.backlink_spam_score), is_new: i.is_new === true, is_lost: i.is_lost === true, type: str(i.item_type), title: str(i.page_from_title)?.slice(0, 120) ?? null,
  country: str(i.domain_from_country), broken: i.is_broken === true,
});
const keywordRow = (k: Json): Row => {
  const info = obj(k.keyword_info);
  const months = arr(info.monthly_searches).slice(0, 12).reverse().map((m) => num(m.search_volume) ?? 0);
  return {
    keyword: str(k.keyword), volume: num(info.search_volume), cpc: num(info.cpc), competition: str(info.competition_level),
    difficulty: num(obj(k.keyword_properties).keyword_difficulty), intent: str(obj(k.search_intent_info).main_intent),
    low_bid: num(info.low_top_of_page_bid), high_bid: num(info.high_top_of_page_bid), trend: months,
  };
};

export const SPECS = {
  // ---------------------------------------------------------------- tier 1: scheduled, cheap
  summary: {
    key: "summary", tier: 1, ttlDays: 7, est: 0.03, path: "/backlinks/summary/live",
    body: (t) => ({ target: t.domain, include_subdomains: true, internal_list_limit: 1 }),
    shape: (r) => r && {
      rank: num(r.rank), backlinks: num(r.backlinks), referring_domains: num(r.referring_domains), referring_pages: num(r.referring_pages),
      referring_main_domains: num(r.referring_main_domains), referring_ips: num(r.referring_ips), referring_subnets: num(r.referring_subnets),
      spam_score: num(r.backlinks_spam_score), broken_backlinks: num(r.broken_backlinks), broken_pages: num(r.broken_pages),
      crawled_pages: num(r.crawled_pages), first_seen: day(r.first_seen),
      nofollow: num(obj(r.referring_links_attributes).nofollow), dofollow: (num(r.backlinks) ?? 0) - (num(obj(r.referring_links_attributes).nofollow) ?? 0),
      tld: top(r.referring_links_tld), types: top(r.referring_links_types), platforms: top(r.referring_links_platform_types),
      countries: top(r.referring_links_countries), attributes: top(r.referring_links_attributes), semantic: top(r.referring_links_semantic_locations),
    },
  },
  new_lost: {
    key: "new_lost", tier: 1, ttlDays: 7, est: 0.03, path: "/backlinks/timeseries_new_lost_summary/live",
    body: (t) => ({ target: t.domain, date_from: monthsAgo(18), date_to: new Date().toISOString().slice(0, 10), group_range: "month" }),
    shape: (r) => arr(r?.items).map((i) => ({
      date: day(i.date), new_backlinks: num(i.new_backlinks) ?? 0, lost_backlinks: num(i.lost_backlinks) ?? 0,
      new_domains: num(i.new_referring_domains) ?? 0, lost_domains: num(i.lost_referring_domains) ?? 0,
    })),
  },
  history: {
    key: "history", tier: 1, ttlDays: 60, est: 0.03, path: "/backlinks/history/live",
    body: (t) => ({ target: t.domain, date_from: monthsAgo(24) }),
    shape: (r) => arr(r?.items).map((i) => ({
      date: day(i.date), rank: num(i.rank), backlinks: num(i.backlinks), referring_domains: num(i.referring_domains), referring_pages: num(i.referring_pages),
      new_backlinks: num(i.new_backlinks), lost_backlinks: num(i.lost_backlinks), new_domains: num(i.new_referring_domains), lost_domains: num(i.lost_referring_domains),
      broken: num(i.broken_backlinks),
    })),
  },
  rank_overview: {
    key: "rank_overview", tier: 1, ttlDays: 7, est: 0.02, path: "/dataforseo_labs/google/domain_rank_overview/live",
    body: (t) => ({ target: t.domain, location_code: t.location_code, language_code: t.language_code }),
    shape: (r) => {
      const m = obj(obj(arr(r?.items)[0]).metrics);
      const o = obj(m.organic), p = obj(m.paid);
      const buckets = ["pos_1", "pos_2_3", "pos_4_10", "pos_11_20", "pos_21_30", "pos_31_40", "pos_41_50", "pos_51_60", "pos_61_70", "pos_71_80", "pos_81_90", "pos_91_100"];
      return {
        keywords: num(o.count) ?? 0, traffic: num(o.etv) ?? 0, traffic_value: num(o.estimated_paid_traffic_cost) ?? 0,
        new: num(o.is_new) ?? 0, up: num(o.is_up) ?? 0, down: num(o.is_down) ?? 0, lost: num(o.is_lost) ?? 0,
        buckets: buckets.map((b) => ({ name: b, count: num(o[b]) ?? 0 })), paid_keywords: num(p.count) ?? 0,
      };
    },
  },
  ranked_keywords: {
    key: "ranked_keywords", tier: 1, ttlDays: 7, est: 0.05, path: "/dataforseo_labs/google/ranked_keywords/live",
    body: (t) => ({ target: t.domain, location_code: t.location_code, language_code: t.language_code, limit: 1000 }),
    shape: (r) => arr(r?.items).map((i) => {
      const kd = obj(i.keyword_data), info = obj(kd.keyword_info), serp = obj(obj(i.ranked_serp_element).serp_item), ch = obj(serp.rank_changes);
      return {
        keyword: str(kd.keyword), position: num(serp.rank_absolute), group: num(serp.rank_group), previous: num(ch.previous_rank_absolute),
        is_new: ch.is_new === true, is_up: ch.is_up === true, is_down: ch.is_down === true,
        volume: num(info.search_volume), cpc: num(info.cpc), competition: str(info.competition_level),
        difficulty: num(obj(kd.keyword_properties).keyword_difficulty), intent: str(obj(kd.search_intent_info).main_intent),
        traffic: num(serp.etv), url: str(serp.url), type: str(serp.type),
      };
    }),
  },
  // ---------------------------------------------------------------- tier 2: on demand ("deep dive")
  backlinks: {
    key: "backlinks", tier: 2, ttlDays: 14, est: 0.06, path: "/backlinks/backlinks/live",
    body: (t) => ({ target: t.domain, mode: "as_is", limit: 1000, order_by: ["rank,desc"] }),
    shape: (r) => ({ total: num(r?.total_count) ?? 0, rows: arr(r?.items).map(backlinkRow) }),
  },
  new_backlinks: {
    key: "new_backlinks", tier: 2, ttlDays: 14, est: 0.04, path: "/backlinks/backlinks/live",
    body: (t) => ({ target: t.domain, mode: "as_is", limit: 300, filters: ["is_new", "=", true], order_by: ["rank,desc"] }),
    shape: (r) => ({ total: num(r?.total_count) ?? 0, rows: arr(r?.items).map(backlinkRow) }),
  },
  lost_backlinks: {
    key: "lost_backlinks", tier: 2, ttlDays: 14, est: 0.04, path: "/backlinks/backlinks/live",
    body: (t) => ({ target: t.domain, mode: "as_is", limit: 300, filters: ["is_lost", "=", true], order_by: ["rank,desc"] }),
    shape: (r) => ({ total: num(r?.total_count) ?? 0, rows: arr(r?.items).map(backlinkRow) }),
  },
  referring_domains: {
    key: "referring_domains", tier: 2, ttlDays: 14, est: 0.06, path: "/backlinks/referring_domains/live",
    body: (t) => ({ target: t.domain, limit: 1000, order_by: ["rank,desc"] }),
    shape: (r) => ({
      total: num(r?.total_count) ?? 0,
      rows: arr(r?.items).map((i) => ({
        domain: str(i.domain), rank: num(i.rank), backlinks: num(i.backlinks), pages: num(i.referring_pages), first_seen: day(i.first_seen),
        lost: day(i.lost_date), spam: num(i.backlinks_spam_score), broken: num(i.broken_backlinks),
        nofollow: num(obj(i.referring_links_attributes).nofollow),
      })),
    }),
  },
  anchors: {
    key: "anchors", tier: 2, ttlDays: 14, est: 0.04, path: "/backlinks/anchors/live",
    body: (t) => ({ target: t.domain, limit: 500, order_by: ["backlinks,desc"] }),
    shape: (r) => ({
      total: num(r?.total_count) ?? 0,
      rows: arr(r?.items).map((i) => ({
        anchor: str(i.anchor), backlinks: num(i.backlinks), domains: num(i.referring_domains), first_seen: day(i.first_seen), lost: day(i.lost_date),
        spam: num(i.backlinks_spam_score), rank: num(i.rank),
      })),
    }),
  },
  domain_pages: {
    key: "domain_pages", tier: 2, ttlDays: 14, est: 0.04, path: "/backlinks/domain_pages/live",
    body: (t) => ({ target: t.domain, limit: 300, order_by: ["page_summary.backlinks,desc"] }),
    shape: (r) => ({
      total: num(r?.total_count) ?? 0,
      rows: arr(r?.items).map((i) => {
        const s = obj(i.page_summary);
        return { page: str(i.page), backlinks: num(s.backlinks), domains: num(s.referring_domains), rank: num(s.rank), status: num(i.status_code), first_seen: day(i.first_visited) };
      }),
    }),
  },
  competitors: {
    key: "competitors", tier: 2, ttlDays: 14, est: 0.03, path: "/dataforseo_labs/google/competitors_domain/live",
    body: (t) => ({ target: t.domain, location_code: t.location_code, language_code: t.language_code, limit: 50, exclude_top_domains: true }),
    shape: (r) => arr(r?.items).filter((i) => str(i.domain)).map((i) => {
      const o = obj(obj(i.full_domain_metrics).organic);
      return { domain: str(i.domain), shared: num(i.intersections), avg_position: num(i.avg_position), keywords: num(o.count), traffic: num(o.etv) };
    }),
  },
  link_gap: {
    key: "link_gap", tier: 2, ttlDays: 14, est: 0.04, path: "/backlinks/domain_intersection/live",
    // domains that link to the competitor but not to us
    body: (t, competitor) => ({ targets: { "1": competitor }, exclude_targets: [t.domain], limit: 300, order_by: ["1.rank,desc"] }),
    shape: (r) => ({
      total: num(r?.total_count) ?? 0,
      rows: arr(r?.items).map((i) => {
        const x = obj(obj(i.domain_intersection)["1"]);
        return { domain: str(x.target), rank: num(x.rank), backlinks: num(x.backlinks), pages: num(x.referring_pages), first_seen: day(x.first_seen), spam: num(x.backlinks_spam_score) };
      }),
    }),
  },
} satisfies Record<string, Spec>;
export type SpecKey = keyof typeof SPECS;
export const TIER1: SpecKey[] = ["summary", "new_lost", "rank_overview", "ranked_keywords", "history"];
export const TIER2: SpecKey[] = ["backlinks", "new_backlinks", "lost_backlinks", "referring_domains", "anchors", "domain_pages", "competitors"];

const hash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex");
const ageDays = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;

export interface Ctx { admin: SupabaseClient; clientId: string; source: SpendSource }
export interface Fetched { data: unknown; fetchedAt: string; fromCache: boolean; cost: number }

/**
 * Returns a stored answer when it is still fresh, otherwise (budget permitting) makes ONE paid call,
 * stores the compact result and logs its cost. `force` skips only the freshness check, never the budget.
 */
export async function ensure(ctx: Ctx, spec: Spec, target: Target, opts: { force?: boolean; extra?: string } = {}): Promise<Fetched> {
  const body = spec.body(target, opts.extra);
  const params_hash = hash(body);
  const { data: row } = await ctx.admin.from("dfs_cache").select("data, fetched_at")
    .eq("client_id", ctx.clientId).eq("endpoint", spec.key).eq("params_hash", params_hash).maybeSingle();
  if (row && !opts.force && ageDays(row.fetched_at) < spec.ttlDays) return { data: row.data, fetchedAt: row.fetched_at, fromCache: true, cost: 0 };

  await assertBudget(ctx.admin, ctx.clientId, spec.est, ctx.source);
  const { result, cost } = await dfsPost(spec.path, body);
  await recordSpend(ctx.admin, ctx.clientId, spec.key, cost, ctx.source);
  const data = spec.shape(result) ?? null;
  const rows = Array.isArray(data) ? data.length : Array.isArray((data as { rows?: unknown[] } | null)?.rows) ? (data as { rows: unknown[] }).rows.length : 0;
  const fetched_at = new Date().toISOString();
  await ctx.admin.from("dfs_cache").upsert(
    { client_id: ctx.clientId, endpoint: spec.key, params_hash, params: { ...body, ...(opts.extra ? { competitor: opts.extra } : {}) }, data, row_count: rows, cost, fetched_at },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  return { data, fetchedAt: fetched_at, fromCache: false, cost };
}

export interface RunReport { fetched: string[]; cached: string[]; cost: number; errors: string[]; stoppedByBudget: boolean }

async function runSpecs(ctx: Ctx, target: Target, keys: SpecKey[], force: boolean): Promise<RunReport> {
  const rep: RunReport = { fetched: [], cached: [], cost: 0, errors: [], stoppedByBudget: false };
  for (const key of keys) {
    try {
      const r = await ensure(ctx, SPECS[key], target, { force });
      (r.fromCache ? rep.cached : rep.fetched).push(key);
      rep.cost += r.cost;
    } catch (e) {
      if (e instanceof BudgetError) { rep.stoppedByBudget = true; rep.errors.push(e.message); break; }
      rep.errors.push(`${key}: ${e instanceof Error ? e.message : "failed"}`);
      if (e instanceof DfsError && ["auth", "payment", "config"].includes(e.kind)) break;
    }
  }
  return rep;
}

/** The cheap core set: also records today's snapshot so trends keep growing without extra calls. */
export async function refreshCore(ctx: Ctx, target: Target, force = false): Promise<RunReport> {
  const rep = await runSpecs(ctx, target, TIER1, force);
  if (rep.fetched.includes("summary") || rep.fetched.includes("rank_overview")) {
    const { data: rows } = await ctx.admin.from("dfs_cache").select("endpoint, data").eq("client_id", ctx.clientId).in("endpoint", ["summary", "rank_overview"]);
    const sum = (rows?.find((r) => r.endpoint === "summary")?.data ?? {}) as Row;
    const ov = (rows?.find((r) => r.endpoint === "rank_overview")?.data ?? {}) as Row;
    await ctx.admin.from("dfs_snapshots").upsert({
      client_id: ctx.clientId, snapshot_date: new Date().toISOString().slice(0, 10),
      backlinks: num(sum.backlinks), referring_domains: num(sum.referring_domains), referring_pages: num(sum.referring_pages), rank: num(sum.rank),
      spam_score: num(sum.spam_score), organic_keywords: num(ov.keywords), organic_traffic: num(ov.traffic),
    }, { onConflict: "client_id,snapshot_date" });
  }
  return rep;
}

export const refreshDeep = (ctx: Ctx, target: Target, force = false) => runSpecs(ctx, target, TIER2, force);
export const estimate = (keys: SpecKey[]) => keys.reduce((a, k) => a + SPECS[k].est, 0);

/* ------------------------------------------------------------------ reading (no API calls) */
export interface CacheEntry { endpoint: string; data: unknown; fetched_at: string; params: Json }

/** Everything stored for a client, newest first. Pages and reports read only this. */
export async function loadCache(supabase: SupabaseClient, clientId: string): Promise<{
  get: <T = unknown>(endpoint: SpecKey) => { data: T; fetchedAt: string } | null;
  gaps: { competitor: string; data: { total: number; rows: Row[] }; fetchedAt: string }[];
  snapshots: Row[];
  target: (Target & { auto_refresh: boolean; competitors: string[] }) | null;
}> {
  const [{ data: rows }, { data: snaps }, { data: t }] = await Promise.all([
    supabase.from("dfs_cache").select("endpoint, data, fetched_at, params").eq("client_id", clientId).order("fetched_at", { ascending: false }).limit(200),
    supabase.from("dfs_snapshots").select("*").eq("client_id", clientId).order("snapshot_date").limit(500),
    supabase.from("research_targets").select("domain, location_code, language_code, auto_refresh, competitors").eq("client_id", clientId).maybeSingle(),
  ]);
  const list = (rows ?? []) as CacheEntry[];
  return {
    get: <T,>(endpoint: SpecKey) => {
      const r = list.find((x) => x.endpoint === endpoint);
      return r ? { data: r.data as T, fetchedAt: r.fetched_at } : null;
    },
    gaps: list.filter((x) => x.endpoint === "link_gap").map((x) => ({
      competitor: String(x.params.competitor ?? ""), data: x.data as { total: number; rows: Row[] }, fetchedAt: x.fetched_at,
    })),
    snapshots: (snaps ?? []) as Row[],
    target: t as (Target & { auto_refresh: boolean; competitors: string[] }) | null,
  };
}

/* ------------------------------------------------------------------ link spike detection */
export interface LinkSpike { month: string; newDomains: number; newBacklinks: number; baseline: number; ratio: number }
type Month = { date: string | null; new_backlinks: number; new_domains: number };

/**
 * A month whose new referring domains are far above the usual level (at least 40, and 5x the median
 * of the earlier months) is flagged: typically a link farm, negative SEO or a viral mention.
 */
export function detectLinkSpike(months: Month[]): LinkSpike | null {
  const m = months.filter((x) => x.date);
  let worst: LinkSpike | null = null;
  for (let i = Math.max(1, m.length - 3); i < m.length; i++) {
    const before = m.slice(Math.max(0, i - 6), i).map((x) => x.new_domains).sort((a, b) => a - b);
    const baseline = before.length ? before[Math.floor(before.length / 2)] : 0;
    const cur = m[i].new_domains;
    if (cur >= 40 && cur >= 5 * Math.max(baseline, 1)) {
      const ratio = cur / Math.max(baseline, 1);
      if (!worst || ratio > worst.ratio) worst = { month: m[i].date!.slice(0, 7), newDomains: cur, newBacklinks: m[i].new_backlinks, baseline, ratio };
    }
  }
  return worst;
}

/* ------------------------------------------------------------------ keyword research (shared cache) */
export type KwKind = "ideas" | "suggestions" | "related";
const KW_PATH: Record<KwKind, string> = {
  ideas: "/dataforseo_labs/google/keyword_ideas/live",
  suggestions: "/dataforseo_labs/google/keyword_suggestions/live",
  related: "/dataforseo_labs/google/related_keywords/live",
};
const KW_EST: Record<KwKind, number> = { ideas: 0.03, suggestions: 0.03, related: 0.02 };
export const KW_TTL_DAYS = 30;

export async function keywordResearch(
  ctx: Ctx, kind: KwKind, seed: string, location_code: number, language_code: string, force = false,
): Promise<{ rows: Row[]; total: number; fetchedAt: string; fromCache: boolean; cost: number }> {
  const term = seed.trim().toLowerCase().replace(/\s+/g, " ");
  const body: Json = kind === "ideas"
    ? { keywords: [term], location_code, language_code, limit: 200, order_by: ["keyword_info.search_volume,desc"] }
    : kind === "suggestions"
      ? { keyword: term, location_code, language_code, limit: 200, order_by: ["keyword_info.search_volume,desc"] }
      : { keyword: term, location_code, language_code, limit: 200, depth: 2 };
  const params_hash = hash({ kind, body });
  const { data: row } = await ctx.admin.from("dfs_keyword_cache").select("data, fetched_at").eq("params_hash", params_hash).maybeSingle();
  if (row && !force && ageDays(row.fetched_at) < KW_TTL_DAYS) {
    const d = row.data as { rows: Row[]; total: number };
    return { rows: d.rows, total: d.total, fetchedAt: row.fetched_at, fromCache: true, cost: 0 };
  }
  await assertBudget(ctx.admin, ctx.clientId, KW_EST[kind], ctx.source);
  const { result, cost } = await dfsPost(KW_PATH[kind], body);
  await recordSpend(ctx.admin, ctx.clientId, `keywords_${kind}`, cost, ctx.source);
  const items = arr(result?.items);
  const rows = (kind === "related" ? items.map((i) => obj(i.keyword_data)) : items).map(keywordRow).filter((r) => r.keyword);
  const data = { rows, total: num(result?.total_count) ?? rows.length };
  const fetched_at = new Date().toISOString();
  await ctx.admin.from("dfs_keyword_cache").upsert({ params_hash, endpoint: `keywords_${kind}`, params: body, data, row_count: rows.length, cost, fetched_at }, { onConflict: "params_hash" });
  return { ...data, fetchedAt: fetched_at, fromCache: false, cost };
}

/* ------------------------------------------------------------------ targets */
const hostOf = (u: string | null | undefined) => {
  if (!u) return null;
  const raw = u.replace(/^sc-domain:/, "");
  try { return new URL(/^https?:/.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase() || null; } catch { return null; }
};

/** The client's research domain: the saved target, else the Bing / Search Console / Business Profile website. */
export async function resolveTarget(admin: SupabaseClient, clientId: string): Promise<(Target & { auto_refresh: boolean; competitors: string[] }) | null> {
  const { data: t } = await admin.from("research_targets").select("domain, location_code, language_code, auto_refresh, competitors").eq("client_id", clientId).maybeSingle();
  if (t) return t as Target & { auto_refresh: boolean; competitors: string[] };
  const { data: res } = await admin.from("integration_resources").select("provider, external_id, metadata").eq("client_id", clientId).eq("is_selected", true);
  const pickHost = (provider: string, f: (r: { external_id: string; metadata: Json | null }) => string | null | undefined) =>
    (res ?? []).filter((r) => r.provider === provider).map((r) => hostOf(f(r as { external_id: string; metadata: Json | null }))).find(Boolean);
  const domain = pickHost("bing", (r) => r.external_id) ?? pickHost("gsc", (r) => r.external_id)
    ?? pickHost("gbp", (r) => str((r.metadata as Json | null)?.website));
  if (!domain) return null;
  const row = { client_id: clientId, domain, location_code: 2840, language_code: "en", auto_refresh: true, competitors: [] as string[] };
  const { error } = await admin.from("research_targets").upsert(row, { onConflict: "client_id" });
  return error ? null : row;
}
export { hostOf };
