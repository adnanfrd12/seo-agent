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
  ga4Trend: TrendData;
  gscTrend: TrendData;
  channels: ChannelRow[];
  devices: { value: string; sessions: number }[];
  keyEvents: { value: string; key_events: number }[];
  landingPages: Row[];
  topQueries: Row[];
  topPages: Row[];
  /** null when the opportunities RPC isn't available yet (migration not applied) */
  opportunities: Opportunities | null;
  errors: string[];
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

  const [overview, ga4Trend, gscTrend, ga4Summary, chCur, chPrev, landing, queries, pages, opps] = await Promise.all([
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
  ]);

  const errors = [overview, ga4Trend, gscTrend].filter((r) => r.error).map((r) => r.error!.message);
  if (errors.length) throw new Error("Could not load report data");

  const o = overview.data as { connected: { ga4: boolean; gsc: boolean; gbp: boolean }; ga4: Compared; gsc: Compared };
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
    connected: { ...o.connected, clarity: false },
    ga4: o.ga4,
    gsc: o.gsc,
    ga4Trend: ga4Trend.data as TrendData,
    gscTrend: gscTrend.data as TrendData,
    channels,
    devices: s.devices ?? [],
    keyEvents: s.key_events ?? [],
    landingPages: ((landing.data as { rows?: Row[] } | null)?.rows ?? []),
    topQueries: ((queries.data as { rows?: Row[] } | null)?.rows ?? []),
    topPages: ((pages.data as { rows?: Row[] } | null)?.rows ?? []),
    // a missing RPC (migration not yet applied) must not break the report
    opportunities: opps.error ? null : (opps.data as Opportunities),
    errors: opps.error ? ["opportunities"] : [],
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
  return out.sort((a, b) => a.changePct - b.changePct);
}
