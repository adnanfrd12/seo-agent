import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BudgetError } from "./budget";
import { DfsError } from "./client";
import { arr, ensure, hostOf, num, obj, str, type Ctx, type Json, type Row, type Spec, type Target } from "./research";

/**
 * Daily competitor intelligence (DataForSEO Labs). Everything is stored, so the dashboard only ever
 * reads Supabase:
 *   - overview per domain  : daily snapshot (keywords, estimated traffic, positions) -> trend history
 *   - keyword gap          : keywords a competitor ranks top-20 for that the client doesn't rank for (weekly)
 *   - shared keywords      : both rank, with both positions (weekly)
 *   - competitor discovery : who overlaps most with the client (weekly)
 * All figures are DataForSEO model estimates from its own SERP index, not measured traffic.
 */
const BUCKETS = ["pos_1", "pos_2_3", "pos_4_10", "pos_11_20", "pos_21_30", "pos_31_40", "pos_41_50", "pos_51_60", "pos_61_70", "pos_71_80", "pos_81_90", "pos_91_100"];
export const MAX_TRACKED = 5;
export const DEFAULT_TRACKED = 3;

const brand = (domain: string) => domain.replace(/^www\./, "").split(".")[0].toLowerCase();

export const COMP_SPECS = {
  competitors_auto: {
    key: "competitors_auto", tier: 2, ttlDays: 7, est: 0.02, path: "/dataforseo_labs/google/competitors_domain/live",
    body: (t) => ({ target: t.domain, location_code: t.location_code, language_code: t.language_code, limit: 30, exclude_top_domains: true }),
    shape: (r) => arr(r?.items).filter((i) => str(i.domain)).map((i) => {
      const o = obj(obj(i.full_domain_metrics).organic);
      return { domain: str(i.domain), shared: num(i.intersections), avg_position: num(i.avg_position), keywords: num(o.count), traffic: num(o.etv) };
    }),
  },
  domain_overview: {
    key: "domain_overview", tier: 1, ttlDays: 0.9, est: 0.02, path: "/dataforseo_labs/google/domain_rank_overview/live",
    body: (t, domain) => ({ target: domain ?? t.domain, location_code: t.location_code, language_code: t.language_code }),
    shape: (r) => {
      const o = obj(obj(obj(arr(r?.items)[0]).metrics).organic);
      return {
        keywords: num(o.count) ?? 0, traffic: num(o.etv) ?? 0, traffic_value: num(o.estimated_paid_traffic_cost) ?? 0,
        new: num(o.is_new) ?? 0, up: num(o.is_up) ?? 0, down: num(o.is_down) ?? 0, lost: num(o.is_lost) ?? 0,
        top3: (num(o.pos_1) ?? 0) + (num(o.pos_2_3) ?? 0), top10: (num(o.pos_1) ?? 0) + (num(o.pos_2_3) ?? 0) + (num(o.pos_4_10) ?? 0),
        buckets: BUCKETS.map((b) => ({ name: b, count: num(o[b]) ?? 0 })),
      };
    },
  },
  kw_gap: {
    key: "kw_gap", tier: 2, ttlDays: 7, est: 0.03, path: "/dataforseo_labs/google/domain_intersection/live",
    // keywords the competitor ranks in the top 20 for, with real demand, that the client doesn't rank for at all
    body: (t, competitor) => ({
      target1: competitor, target2: t.domain, location_code: t.location_code, language_code: t.language_code, intersections: false, limit: 150,
      filters: [["keyword_data.keyword_info.search_volume", ">=", 50], "and", ["first_domain_serp_element.rank_absolute", "<=", 20]],
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
    }),
    shape: (r, competitor) => {
      const b = brand(competitor ?? "");
      return {
        total: num(r?.total_count) ?? 0,
        rows: arr(r?.items).map((i) => {
          const k = obj(i.keyword_data), info = obj(k.keyword_info), f = obj(i.first_domain_serp_element);
          return {
            keyword: str(k.keyword), volume: num(info.search_volume), cpc: num(info.cpc), difficulty: num(obj(k.keyword_properties).keyword_difficulty),
            intent: str(obj(k.search_intent_info).main_intent), their_position: num(f.rank_absolute), their_url: str(f.url), their_traffic: num(f.etv),
          };
        }).filter((x) => x.keyword && !(b.length > 3 && x.keyword.includes(b))), // a competitor's own brand name isn't an opportunity
      };
    },
  },
  kw_shared: {
    key: "kw_shared", tier: 2, ttlDays: 7, est: 0.03, path: "/dataforseo_labs/google/domain_intersection/live",
    body: (t, competitor) => ({
      target1: competitor, target2: t.domain, location_code: t.location_code, language_code: t.language_code, intersections: true, limit: 150,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
    }),
    shape: (r) => ({
      total: num(r?.total_count) ?? 0,
      rows: arr(r?.items).map((i) => {
        const k = obj(i.keyword_data), info = obj(k.keyword_info), f = obj(i.first_domain_serp_element), s = obj(i.second_domain_serp_element);
        return {
          keyword: str(k.keyword), volume: num(info.search_volume), difficulty: num(obj(k.keyword_properties).keyword_difficulty),
          you: num(s.rank_absolute), you_url: str(s.url), them: num(f.rank_absolute), them_url: str(f.url),
        };
      }).filter((x) => x.keyword),
    }),
  },
} satisfies Record<string, Spec>;

export interface AutoCompetitor { domain: string; shared: number | null; avg_position: number | null; keywords: number | null; traffic: number | null }
export interface TargetFull extends Target { competitors: string[]; competitors_excluded: string[]; competitor_mode: "auto" | "manual" }

/** Manual picks first, then (in auto mode) the strongest overlaps, never hidden ones, up to the cap. */
export function pickTracked(target: TargetFull, auto: AutoCompetitor[]): string[] {
  const self = target.domain;
  const excluded = new Set(target.competitors_excluded.map((d) => d.toLowerCase()));
  const manual = [...new Set(target.competitors.map((d) => d.toLowerCase()).filter((d) => d !== self && !excluded.has(d)))];
  if (target.competitor_mode === "manual") return manual.slice(0, MAX_TRACKED);
  const picked = [...manual];
  for (const a of [...auto].sort((x, y) => (y.shared ?? 0) - (x.shared ?? 0))) {
    if (picked.length >= Math.max(DEFAULT_TRACKED, manual.length)) break;
    const d = a.domain.toLowerCase();
    if (d === self || excluded.has(d) || picked.includes(d) || (a.shared ?? 0) < 5) continue;
    picked.push(d);
  }
  return picked.slice(0, MAX_TRACKED);
}

export interface AnalysisReport { tracked: string[]; fetched: number; cached: number; cost: number; errors: string[]; stoppedByBudget: boolean }

type Overview = { keywords: number; traffic: number; traffic_value: number; new: number; up: number; down: number; lost: number; top3: number; top10: number }

/**
 * One full competitor analysis. Each call is skipped while its stored answer is still fresh (daily
 * for the overviews, weekly for the heavier lists), so running it twice in a day costs nothing.
 */
export async function runCompetitorAnalysis(ctx: Ctx, target: TargetFull, opts: { force?: boolean } = {}): Promise<AnalysisReport> {
  const rep: AnalysisReport = { tracked: [], fetched: 0, cached: 0, cost: 0, errors: [], stoppedByBudget: false };
  const today = new Date().toISOString().slice(0, 10);
  const run = async (spec: Spec, extra?: string) => {
    const r = await ensure(ctx, spec, target, { force: opts.force, extra });
    if (r.fromCache) rep.cached++; else { rep.fetched++; rep.cost += r.cost; }
    return r.data;
  };
  const guard = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    if (rep.stoppedByBudget) return null;
    try { return await fn(); } catch (e) {
      if (e instanceof BudgetError) { rep.stoppedByBudget = true; rep.errors.push(e.message); return null; }
      rep.errors.push(`${label}: ${e instanceof Error ? e.message : "failed"}`);
      if (e instanceof DfsError && ["auth", "payment", "config"].includes(e.kind)) rep.stoppedByBudget = true;
      return null;
    }
  };

  const auto = (await guard("discovery", () => run(COMP_SPECS.competitors_auto))) as AutoCompetitor[] | null;
  const stored = auto ?? ((await ctx.admin.from("dfs_cache").select("data").eq("client_id", ctx.clientId).eq("endpoint", "competitors_auto").order("fetched_at", { ascending: false }).limit(1).maybeSingle()).data?.data as AutoCompetitor[] | undefined) ?? [];
  rep.tracked = pickTracked(target, stored);

  // daily visibility snapshot for the client and each tracked competitor
  for (const [domain, isSelf] of [[target.domain, true] as const, ...rep.tracked.map((d) => [d, false] as const)]) {
    const o = (await guard(`overview ${domain}`, () => run(COMP_SPECS.domain_overview, domain))) as Overview | null;
    if (!o) continue;
    const shared = stored.find((a) => a.domain.toLowerCase() === domain);
    await ctx.admin.from("competitor_snapshots").upsert({
      client_id: ctx.clientId, domain, is_self: isSelf, snapshot_date: today, keywords: o.keywords, traffic: o.traffic, traffic_value: o.traffic_value,
      top3: o.top3, top10: o.top10, new_kw: o.new, up_kw: o.up, down_kw: o.down, lost_kw: o.lost,
      shared_keywords: shared?.shared ?? null, avg_position: shared?.avg_position ?? null,
    }, { onConflict: "client_id,domain,snapshot_date" });
  }
  // weekly heavier lists, one pair per tracked competitor
  for (const d of rep.tracked) {
    await guard(`gap ${d}`, () => run(COMP_SPECS.kw_gap, d));
    await guard(`shared ${d}`, () => run(COMP_SPECS.kw_shared, d));
  }
  return rep;
}

/* ------------------------------------------------------------------ reading (no API calls) */
export interface SnapshotRow { domain: string; is_self: boolean; snapshot_date: string; keywords: number | null; traffic: number | null; traffic_value: number | null; top3: number | null; top10: number | null; shared_keywords: number | null; avg_position: number | null }
export interface Threat { domain: string; kind: "rising" | "overtaking"; keywordsFrom: number; keywordsTo: number; trafficFrom: number; trafficTo: number; days: number }

/** Competitors whose estimated visibility grew fast over the stored history (at least 5 days apart). */
export function detectThreats(snaps: SnapshotRow[]): Threat[] {
  const by = new Map<string, SnapshotRow[]>();
  for (const s of snaps) by.set(s.domain, [...(by.get(s.domain) ?? []), s]);
  const self = [...by.values()].find((l) => l[0].is_self)?.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const out: Threat[] = [];
  for (const [domain, list] of by) {
    if (list[0].is_self) continue;
    const l = [...list].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const first = l[0], last = l.at(-1)!;
    const days = (Date.parse(last.snapshot_date) - Date.parse(first.snapshot_date)) / 86_400_000;
    if (days < 5) continue;
    const kf = first.keywords ?? 0, kt = last.keywords ?? 0, tf = first.traffic ?? 0, tt = last.traffic ?? 0;
    const mine = self?.at(-1)?.keywords ?? 0, mineThen = self?.find((s) => s.snapshot_date >= first.snapshot_date)?.keywords ?? mine;
    if (kt > mine && kf <= mineThen && kt - kf >= 10) out.push({ domain, kind: "overtaking", keywordsFrom: kf, keywordsTo: kt, trafficFrom: tf, trafficTo: tt, days });
    else if (kt - kf >= 20 && kt >= kf * 1.2) out.push({ domain, kind: "rising", keywordsFrom: kf, keywordsTo: kt, trafficFrom: tf, trafficTo: tt, days });
  }
  return out.sort((a, b) => (b.keywordsTo - b.keywordsFrom) - (a.keywordsTo - a.keywordsFrom));
}

export interface CompetitorData {
  target: TargetFull | null;
  auto: { data: AutoCompetitor[]; fetchedAt: string } | null;
  tracked: string[];
  snapshots: SnapshotRow[];
  gaps: { competitor: string; total: number; rows: Row[]; fetchedAt: string }[];
  shared: { competitor: string; total: number; rows: Row[]; fetchedAt: string }[];
  latestAt: string | null;
  threats: Threat[];
}

/** Everything the Competitors tab, Overview and reports show, from storage only. */
export async function loadCompetitors(supabase: SupabaseClient, clientId: string): Promise<CompetitorData> {
  const [{ data: t }, { data: cache }, { data: snaps }] = await Promise.all([
    supabase.from("research_targets").select("domain, location_code, language_code, competitors, competitors_excluded, competitor_mode").eq("client_id", clientId).maybeSingle(),
    supabase.from("dfs_cache").select("endpoint, data, params, fetched_at").eq("client_id", clientId).in("endpoint", ["competitors_auto", "kw_gap", "kw_shared"]).order("fetched_at", { ascending: false }).limit(60),
    supabase.from("competitor_snapshots").select("domain, is_self, snapshot_date, keywords, traffic, traffic_value, top3, top10, shared_keywords, avg_position").eq("client_id", clientId).order("snapshot_date").limit(3000),
  ]);
  const target = t as TargetFull | null;
  const rows = cache ?? [];
  const autoRow = rows.find((r) => r.endpoint === "competitors_auto");
  const own = target?.domain.toLowerCase();
  const auto = autoRow ? { data: (autoRow.data as AutoCompetitor[]).filter((a) => a.domain.toLowerCase() !== own), fetchedAt: autoRow.fetched_at as string } : null;
  const list = (endpoint: string) => {
    const seen = new Set<string>();
    return rows.filter((r) => r.endpoint === endpoint).flatMap((r) => {
      const d = String((r.params as Json).target1 ?? "");
      if (!d || seen.has(d)) return [];
      seen.add(d);
      const data = r.data as { total: number; rows: Row[] };
      return [{ competitor: d, total: data.total, rows: data.rows, fetchedAt: r.fetched_at as string }];
    });
  };
  const snapshots = (snaps ?? []) as SnapshotRow[];
  const latestAt = snapshots.length ? snapshots.reduce((a, s) => (s.snapshot_date > a ? s.snapshot_date : a), "") : null;
  const tracked = target ? pickTracked(target, auto?.data ?? []) : [];
  return { target, auto, tracked, snapshots, gaps: list("kw_gap"), shared: list("kw_shared"), latestAt, threats: detectThreats(snapshots) };
}

export { hostOf };
