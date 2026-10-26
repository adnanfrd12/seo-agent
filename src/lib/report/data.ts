import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNum } from "@/lib/analytics/format";
import type { TrendData } from "@/lib/analytics/trend";

export type Totals = { has_data: boolean } & Record<string, unknown>;
export type Compared = { current: Totals; previous: Totals; mom: Totals; yoy: Totals };
type Row = Record<string, unknown>;

export interface ChannelRow { channel: string; sessions: number; prevSessions: number | null; users: number; engagementRate: number | null }
export interface Opportunities {
  declining_keywords: Row[]; improving_keywords: Row[]; decaying_pages: Row[]; new_queries: Row[];
  newly_clicked_queries: number; cannibalization: Row[]; quick_wins: Row[]; has_query_page_data: boolean;
  thresholds: Row;
}

export interface ReportData {
  range: { start: string; end: string };
  connected: { ga4: boolean; gsc: boolean; gbp: boolean; clarity: boolean };
  ga4: Compared;
  gsc: Compared;
  gbp: Compared;
  ga4Trend: TrendData;
  gbpTrend: TrendData;
  /** Business Profile search keywords for the months overlapping the range */
  gbpKeywords: { keyword: string; impressions: number | null; impressions_threshold: number | null }[];
  /** reviews and geogrid local-rank scans (Local Brand Manager); null when none stored */
  gbpReviews: { total: number; average: number | null; newInRange: number; newAverage: number | null; replyRate: number | null } | null;
  gbpRanks: { term: string; scannedAt: string | null; agr: number | null; atgr: number | null; solv: number | null; prevAtgr: number | null; prevSolv: number | null; url: string | null }[];
  gscTrend: TrendData;
  channels: ChannelRow[];
  devices: { value: string; sessions: number }[];
  keyEvents: { value: string; key_events: number }[];
  landingPages: Row[];
  topQueries: Row[];
  topPages: Row[];
  /** null when the opportunities RPC isn't available yet (migration not applied) */
  opportunities: Opportunities | null;
  /** latest stored AI output (null when none / not configured) */
  ai: AiSection | null;
  /** Clarity friction totals over the stored days inside the range (null when not connected) */
  clarity: {
    days: number; from: string; to: string; outsideRange: boolean; totals: Record<string, number>;
    scrollDepth: number | null; activeSeconds: number | null; topPages: { url: string; total: number }[];
    /** ranked lists from Clarity's site-wide response: popular pages, referrers, countries, devices, browsers */
    lists: { title: string; items: { label: string; value: number }[] }[];
  } | null;
  errors: string[];
}

export interface AiSection {
  generatedAt: string; model: string | null; periodStart: string | null; periodEnd: string | null;
  summary: string | null; improvements: string[]; declines: string[];
  recommendations: { title: string; summary: string; priority: string; category: string; target_url: string | null; recommended_action: string; success_metric: string; implementation_status: string; evidence_references: string[] }[];
  plan: { summary: string | null; tasks: { week: number; title: string; priority: string; target_url: string | null; success_metric: string; status: string; estimated_effort: string }[] } | null;
}

const DAY = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * Everything the executive report needs, from the same authorized RPCs the dashboard uses.
 * The previous period for channel comparisons is the equal-length range immediately before.
 */
export async function loadReportData(
  supabase: SupabaseClient, clientId: string, range: { start: string; end: string }, compare = true,
): Promise<ReportData> {
  const args = { p_client_id: clientId, p_start: range.start, p_end: range.end };
  const len = Math.round((Date.parse(range.end) - Date.parse(range.start)) / DAY) + 1;
  const prev = { p_client_id: clientId, p_start: shift(range.start, -len), p_end: shift(range.start, -1) };

  const [overview, ga4Trend, gscTrend, ga4Summary, chCur, chPrev, landing, queries, pages, opps, gbpTrend, gbpSummary] = await Promise.all([
    supabase.rpc("get_seo_overview", args),
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "ga4", p_granularity: "day", p_compare: compare }),
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "gsc", p_granularity: "day", p_compare: compare, p_search_type: "web" }),
    supabase.rpc("get_ga4_summary", args),
    supabase.rpc("get_ga4_traffic_sources", { ...args, p_group_by: "channel", p_sort: "sessions", p_dir: "desc", p_limit: 50, p_offset: 0 }),
    supabase.rpc("get_ga4_traffic_sources", { ...prev, p_group_by: "channel", p_sort: "sessions", p_dir: "desc", p_limit: 50, p_offset: 0 }),
    supabase.rpc("get_ga4_top_pages", { ...args, p_kind: "landing", p_sort: "sessions", p_dir: "desc", p_limit: 10, p_offset: 0 }),
    supabase.rpc("get_gsc_keywords", { ...args, p_search_type: "web", p_sort: "clicks", p_dir: "desc", p_limit: 10, p_offset: 0 }),
    supabase.rpc("get_gsc_top_pages", { ...args, p_search_type: "web", p_sort: "clicks", p_dir: "desc", p_limit: 10, p_offset: 0 }),
    supabase.rpc("get_gsc_opportunities", args),
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "gbp", p_granularity: "day", p_compare: compare }),
    supabase.rpc("get_gbp_summary", args),
  ]);

  const errors = [overview, ga4Trend, gscTrend].filter((r) => r.error).map((r) => r.error!.message);
  if (errors.length) throw new Error("Could not load report data");

  const o = overview.data as { connected: { ga4: boolean; gsc: boolean; gbp: boolean }; ga4: Compared; gsc: Compared; gbp: Compared };
  const s = (ga4Summary.data ?? {}) as { devices?: { value: string; sessions: number }[]; key_events?: { value: string; key_events: number }[] };
  const prevMap = new Map(((chPrev.data as { rows?: Row[] } | null)?.rows ?? []).map((r) => [String(r.source), toNum(r.sessions)]));
  const channels: ChannelRow[] = ((chCur.data as { rows?: Row[] } | null)?.rows ?? []).map((r) => ({
    channel: String(r.source),
    sessions: toNum(r.sessions) ?? 0,
    prevSessions: prevMap.has(String(r.source)) ? prevMap.get(String(r.source)) ?? null : 0,
    users: toNum(r.users) ?? 0,
    engagementRate: toNum(r.engagement_rate),
  }));

  return {
    range,
    connected: { ...o.connected, clarity: false }, // set below once Clarity rows are loaded
    ga4: o.ga4,
    gsc: o.gsc,
    gbp: o.gbp,
    ga4Trend: ga4Trend.data as TrendData,
    gbpTrend: (gbpTrend.data ?? { current: [], previous: [] }) as TrendData,
    gbpKeywords: ((gbpSummary.data as { keywords?: ReportData["gbpKeywords"] } | null)?.keywords ?? []).slice(0, 15),
    gscTrend: gscTrend.data as TrendData,
    channels,
    devices: s.devices ?? [],
    keyEvents: s.key_events ?? [],
    landingPages: ((landing.data as { rows?: Row[] } | null)?.rows ?? []),
    topQueries: ((queries.data as { rows?: Row[] } | null)?.rows ?? []),
    topPages: ((pages.data as { rows?: Row[] } | null)?.rows ?? []),
    // a missing RPC (migration not yet applied) must not break the report
    opportunities: opps.error ? null : (opps.data as Opportunities),
    ...(await loadGbpExtras(supabase, clientId, range)),
    ai: await loadAi(supabase, clientId),
    clarity: await loadClarity(supabase, clientId, range),
    errors: opps.error ? ["opportunities"] : [],
  };
}

async function loadGbpExtras(supabase: SupabaseClient, clientId: string, range: { start: string; end: string }) {
  const { data: res } = await supabase.from("integration_resources").select("id").eq("client_id", clientId).eq("provider", "gbp").eq("is_selected", true);
  const ids = (res ?? []).map((r) => r.id);
  if (!ids.length) return { gbpReviews: null, gbpRanks: [] };
  const [{ data: rv, error: rvErr }, { data: gg }] = await Promise.all([
    supabase.from("gbp_reviews").select("rating, reply_text, reviewed_at").in("resource_id", ids).limit(10000),
    supabase.from("gbp_geogrids").select("search_term, scanned_at, agr, atgr, solv, state, public_url").in("resource_id", ids)
      .neq("state", "error").order("scanned_at", { ascending: false }).limit(2000),
  ]);
  const reviews = rvErr ? [] : rv ?? [];
  const rated = reviews.filter((r) => r.rating != null);
  const fresh = rated.filter((r) => r.reviewed_at && r.reviewed_at.slice(0, 10) >= range.start && r.reviewed_at.slice(0, 10) <= range.end);
  const mean = (xs: { rating: number | null }[]) => (xs.length ? xs.reduce((a, r) => a + (r.rating ?? 0), 0) / xs.length : null);
  const byTerm = new Map<string, NonNullable<typeof gg>>();
  for (const g of gg ?? []) byTerm.set(g.search_term, [...(byTerm.get(g.search_term) ?? []), g]);
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    gbpReviews: reviews.length ? {
      total: reviews.length, average: mean(rated), newInRange: fresh.length, newAverage: mean(fresh),
      replyRate: reviews.filter((r) => r.reply_text).length / reviews.length,
    } : null,
    gbpRanks: [...byTerm.entries()].map(([term, list]) => ({
      term, scannedAt: list[0].scanned_at, agr: n(list[0].agr), atgr: n(list[0].atgr), solv: n(list[0].solv),
      prevAtgr: n(list[1]?.atgr), prevSolv: n(list[1]?.solv), url: list[0].public_url,
    })),
  };
}

async function loadAi(supabase: SupabaseClient, clientId: string): Promise<AiSection | null> {
  const { data: run, error } = await supabase.from("ai_analysis_runs").select("id, created_at, model, range_start, range_end, output")
    .eq("client_id", clientId).eq("kind", "insights").eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: plan } = await supabase.from("seo_strategy_plans").select("id, summary").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || (!run && !plan)) return null;
  const [{ data: recs }, { data: tasks }] = await Promise.all([
    run ? supabase.from("analytics_insights").select("title, summary, priority, category, target_url, recommended_action, success_metric, implementation_status, evidence_references")
      .eq("run_id", run.id).neq("implementation_status", "dismissed").order("created_at") : Promise.resolve({ data: [] }),
    plan ? supabase.from("seo_strategy_tasks").select("week, title, priority, target_url, success_metric, status, estimated_effort").eq("plan_id", plan.id).order("week").order("sort")
      : Promise.resolve({ data: [] }),
  ]);
  const out = (run?.output ?? {}) as { executive_summary?: string; significant_improvements?: { statement: string }[]; significant_declines?: { statement: string }[] };
  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  return {
    generatedAt: run?.created_at ?? "", model: run?.model ?? null, periodStart: run?.range_start ?? null, periodEnd: run?.range_end ?? null,
    summary: out.executive_summary ?? null,
    improvements: (out.significant_improvements ?? []).map((x) => x.statement),
    declines: (out.significant_declines ?? []).map((x) => x.statement),
    recommendations: ((recs ?? []) as AiSection["recommendations"]).sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)),
    plan: plan ? { summary: plan.summary, tasks: (tasks ?? []) as NonNullable<AiSection["plan"]>["tasks"] } : null,
  };
}

const FRICTION = ["RageClickCount", "DeadClickCount", "ExcessiveScroll", "QuickbackClick", "ScriptErrorCount", "ErrorClickCount"];
const CLARITY_LISTS: Record<string, string> = {
  PopularPages: "Popular pages", ReferrerUrl: "Referrers", Country: "Countries", Device: "Devices", Browser: "Browsers",
};
type ClarityRow = { metric_date: string; dimension: string; value: string; metric: string; count: number | null; raw: Record<string, unknown> | null };

/**
 * Clarity totals for the stored days inside the range. Clarity's API only serves the last 1-3 days,
 * so a range with no stored days (e.g. last month, right after connecting) falls back to the most
 * recent stored days, flagged with `outsideRange` so the report says which dates it shows.
 */
async function loadClarity(supabase: SupabaseClient, clientId: string, range: { start: string; end: string }) {
  const cols = "metric_date, dimension, value, metric, count, raw";
  let outsideRange = false;
  let { data, error } = await supabase.from("clarity_behavior_metrics").select(cols)
    .eq("client_id", clientId).gte("metric_date", range.start).lte("metric_date", range.end).in("dimension", ["total", "url"]).limit(10000);
  if (!error && (data ?? []).length === 0) {
    const { data: latest } = await supabase.from("clarity_behavior_metrics").select("metric_date").eq("client_id", clientId)
      .order("metric_date", { ascending: false }).limit(1).maybeSingle();
    if (latest) {
      outsideRange = true;
      const from = shift(latest.metric_date, -6);
      ({ data, error } = await supabase.from("clarity_behavior_metrics").select(cols)
        .eq("client_id", clientId).gte("metric_date", from).lte("metric_date", latest.metric_date).in("dimension", ["total", "url"]).limit(10000));
    }
  }
  const rows = (data ?? []) as ClarityRow[];
  if (error || rows.length === 0) return null;
  const totals: Record<string, number> = {};
  const pages = new Map<string, number>();
  const listMaps = new Map<string, Map<string, number>>();
  let scroll = 0, scrollDays = 0, active = 0, activeDays = 0;
  for (const r of rows) {
    if (r.dimension === "total" && r.value && CLARITY_LISTS[r.metric]) {
      const m = listMaps.get(r.metric) ?? new Map<string, number>();
      m.set(r.value, (m.get(r.value) ?? 0) + Number(r.count ?? 0));
      listMaps.set(r.metric, m);
    }
    if (r.dimension === "total" && !r.value) {
      if (FRICTION.includes(r.metric)) totals[r.metric] = (totals[r.metric] ?? 0) + Number(r.count ?? 0);
      if (r.metric === "Traffic") totals.sessions = (totals.sessions ?? 0) + Number(r.raw?.totalSessionCount ?? 0);
      if (r.metric === "ScrollDepth" && r.raw?.averageScrollDepth != null) { scroll += Number(r.raw.averageScrollDepth); scrollDays++; }
      if (r.metric === "EngagementTime" && r.raw?.activeTime != null) { active += Number(r.raw.activeTime); activeDays++; }
    }
    if (r.dimension === "url" && FRICTION.includes(r.metric)) pages.set(r.value, (pages.get(r.value) ?? 0) + Number(r.count ?? 0));
  }
  const dates = [...new Set(rows.map((r) => r.metric_date))].sort();
  return {
    days: dates.length,
    from: dates[0], to: dates.at(-1)!, outsideRange,
    totals,
    scrollDepth: scrollDays ? scroll / scrollDays : null,
    activeSeconds: activeDays ? active / activeDays : null,
    lists: Object.entries(CLARITY_LISTS).flatMap(([metric, title]) => {
      const m = listMaps.get(metric);
      if (!m?.size) return [];
      return [{ title, items: [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8) }];
    }),
    topPages: [...pages.entries()].map(([url, total]) => ({ url, total })).filter((p) => p.total > 0).sort((a, b) => b.total - a.total).slice(0, 8),
  };
}

/* ------------------------------------------------------------ monthly wins */
export interface Win { label: string; source: string; current: number; base: number; changePct: number; text: string }

const pickN = (t: Totals | undefined, k: string) => (t?.has_data ? toNum(t[k]) : null);

/**
 * Deterministic "wins": metrics that improved by at least `minPct` vs the comparison period AND
 * have enough volume that the change means something. Nothing here is AI-generated.
 */
export function monthlyWins(d: ReportData, basis: "previous" | "mom" = "previous", minPct = 10): Win[] {
  const out: Win[] = [];
  const consider = (label: string, source: string, cmp: Compared, key: string, minBase: number, higherIsBetter = true, fmt = (n: number) => n.toLocaleString("en-US")) => {
    const cur = pickN(cmp.current, key);
    const base = pickN(cmp[basis], key);
    if (cur == null || base == null || base === 0 || Math.max(cur, base) < minBase) return;
    const changePct = ((cur - base) / Math.abs(base)) * 100;
    const better = higherIsBetter ? changePct >= minPct : changePct <= -minPct;
    if (!better) return;
    out.push({
      label, source, current: cur, base, changePct,
      text: `${label} ${higherIsBetter ? "rose" : "improved"} ${Math.abs(changePct).toFixed(0)}% (${fmt(base)} → ${fmt(cur)})`,
    });
  };
  if (d.connected.ga4) {
    consider("Users", "GA4", d.ga4, "users", 50);
    consider("Sessions", "GA4", d.ga4, "sessions", 50);
    consider("Engaged sessions", "GA4", d.ga4, "engaged_sessions", 20);
    consider("Key events", "GA4", d.ga4, "key_events", 5);
  }
  if (d.connected.gsc) {
    consider("Organic clicks", "GSC", d.gsc, "clicks", 10);
    consider("Search impressions", "GSC", d.gsc, "impressions", 100);
    consider("Average position", "GSC", d.gsc, "position", 0, false, (n) => n.toFixed(1));
  }
  if (d.connected.gbp) {
    consider("Business Profile views", "GBP", d.gbp, "impressions", 100);
    consider("Profile website clicks", "GBP", d.gbp, "website_clicks", 10);
    consider("Call button clicks", "GBP", d.gbp, "call_clicks", 5);
    consider("Direction requests", "GBP", d.gbp, "direction_requests", 5);
  }
  for (const c of d.channels) {
    if (c.prevSessions && c.prevSessions >= 20) {
      const pct = ((c.sessions - c.prevSessions) / c.prevSessions) * 100;
      if (pct >= minPct) out.push({
        label: `${c.channel} sessions`, source: "GA4", current: c.sessions, base: c.prevSessions, changePct: pct,
        text: `${c.channel} traffic rose ${pct.toFixed(0)}% (${c.prevSessions} → ${c.sessions} sessions)`,
      });
    }
  }
  return out.sort((a, b) => b.changePct - a.changePct);
}

/** Declines worth flagging, mirror of monthlyWins. */
export function notableDeclines(d: ReportData, minPct = 10): Win[] {
  const out: Win[] = [];
  const consider = (label: string, source: string, cmp: Compared, key: string, minBase: number, higherIsBetter = true) => {
    const cur = pickN(cmp.current, key), base = pickN(cmp.previous, key);
    if (cur == null || base == null || base === 0 || Math.max(cur, base) < minBase) return;
    const changePct = ((cur - base) / Math.abs(base)) * 100;
    if (higherIsBetter ? changePct <= -minPct : changePct >= minPct) {
      out.push({ label, source, current: cur, base, changePct, text: `${label} ${higherIsBetter ? "fell" : "worsened"} ${Math.abs(changePct).toFixed(0)}%` });
    }
  };
  if (d.connected.ga4) { consider("Users", "GA4", d.ga4, "users", 50); consider("Sessions", "GA4", d.ga4, "sessions", 50); consider("Engagement rate", "GA4", d.ga4, "engagement_rate", 0); }
  if (d.connected.gsc) { consider("Organic clicks", "GSC", d.gsc, "clicks", 10); consider("Search impressions", "GSC", d.gsc, "impressions", 100); consider("Average position", "GSC", d.gsc, "position", 0, false); }
  if (d.connected.gbp) {
    consider("Business Profile views", "GBP", d.gbp, "impressions", 100); consider("Profile website clicks", "GBP", d.gbp, "website_clicks", 10);
    consider("Call button clicks", "GBP", d.gbp, "call_clicks", 5); consider("Direction requests", "GBP", d.gbp, "direction_requests", 5);
  }
  return out.sort((a, b) => a.changePct - b.changePct);
}
