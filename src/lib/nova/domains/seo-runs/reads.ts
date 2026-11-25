import "server-only";
import { z } from "zod";
import { auditEstimate, DEFAULT_AUDIT_PAGES, loadAudit, pollAudit, type AuditResult } from "@/lib/dataforseo/audit";
import { AUTO_SHARE } from "@/lib/dataforseo/budget";
import { dfsBalance, dfsConfigured } from "@/lib/dataforseo/client";
import { COMP_SPECS, pickTracked, type AutoCompetitor } from "@/lib/dataforseo/competitors";
import { loadPosts, pollPosts, POSTS_EST } from "@/lib/dataforseo/gbp-posts";
import { CRUX_THRESHOLDS, LH_EST, loadCrux, loadLighthouse, type CruxKey, type CruxRecord } from "@/lib/dataforseo/lighthouse";
import { GRID_POINT_EST, gridRivals, loadLocal, pollReviews, PROFILE_EST, REVIEWS_EST, reviewStats, type Grid } from "@/lib/dataforseo/local";
import { marketLabel } from "@/lib/dataforseo/locations";
import { estimate, KW_TTL_DAYS, SPECS, TIER1, TIER2, type Row } from "@/lib/dataforseo/research";
import { forgetAll } from "@/lib/memo";
import { AUDITS, auditLabel, loadBundle, sxConfigured } from "@/lib/seosignalx/mcp";
import { scores } from "@/lib/seosignalx/view";
import { loadTechChecks, type TechPage } from "@/lib/technical/checks";
import { TOOLS } from "@/lib/toolkit/tools";
import { json, read, ToolError, type NovaCtx, type NovaTool, type ToolOutcome } from "../../kit";
import { budgetNow, capJson, cut, day, daysOld, latest, marketDescription, MARKET_KEYS, marketOf, money, normSeed, pct, peekTarget, search, seedSchema, storedSearch } from "./shared";
import { compactResult, isScan, RESULT_SLUGS, SPEC, toolTitle } from "./toolkit";

type Ctx = Pick<NovaCtx, "admin" | "client">;
const path = (u: unknown) => { try { const x = new URL(String(u)); return `${x.pathname}${x.search}` || "/"; } catch { return u == null ? null : String(u); } };
const round = (v: unknown, d = 0) => (typeof v === "number" ? Number(v.toFixed(d)) : v ?? null);
/** A read that also collected a finished background job: the open page refreshes. */
const withChange = (tool: string, content: string, summary: string): ToolOutcome => {
  forgetAll();
  return { content, changed: true, action: { tool, ok: true, summary } };
};

/* ================================================================== status of everything stored */
const RESEARCH_ENDPOINTS = [...TIER1, ...TIER2, "broken_backlinks", "link_gap", "link_changes", "competitors_auto", "domain_overview", "kw_gap", "kw_shared", "comp_pages", "comp_links"];
const OTHER_ENDPOINTS = ["audit", "audit_task", "lighthouse", "crux", "tech_checks", "seosignalx", "gbp_profile", "reviews", "reviews_task", "maps_grid", "gbp_posts", ...RESULT_SLUGS.map((s) => `tk_${s}`)];
type Meta = { endpoint: string; params_hash: string; params: Row | null; fetched_at: string; row_count: number | null; cost: number | null };
type Extra = { endpoint: string; params_hash: string; fetched_at: string; total: number | null; status: string | null; score: number | null; finished: string | null; crawled: number | null; max: number | null; err: string | null; project: string | null; source: string | null; grid: Grid["summary"] | null };

async function dataStatus(ctx: NovaCtx) {
  const id = ctx.client.id;
  const configured = dfsConfigured();
  const [t, metaQ, extraQ, snapQ, autoRow] = await Promise.all([
    peekTarget(ctx.admin, id),
    ctx.admin.from("dfs_cache").select("endpoint, params_hash, params, fetched_at, row_count, cost").eq("client_id", id).in("endpoint", [...RESEARCH_ENDPOINTS, ...OTHER_ENDPOINTS]).order("fetched_at", { ascending: false }).limit(1500),
    ctx.admin.from("dfs_cache").select("endpoint, params_hash, fetched_at, total:data->total, status:data->>status, score:data->score, finished:data->>finishedAt, crawled:data->crawled, max:data->maxPages, err:data->>error, project:data->project->>name, source:data->>source, grid:data->summary")
      .eq("client_id", id).in("endpoint", ["audit", "audit_task", "broken_backlinks", "link_gap", "kw_gap", "reviews_task", "gbp_posts", "maps_grid", "seosignalx", "crux"]).order("fetched_at", { ascending: false }).limit(500),
    ctx.admin.from("competitor_snapshots").select("snapshot_date").eq("client_id", id).order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
    latest<AutoCompetitor[]>(ctx.admin, id, "competitors_auto"),
  ]);
  const meta = (metaQ.data ?? []) as unknown as Meta[], extra = (extraQ.data ?? []) as unknown as Extra[];
  const newest = (eps: string[]) => meta.find((m) => eps.includes(m.endpoint))?.fetched_at ?? null;
  // the stalest part of a set: each endpoint's newest row, then the oldest of those
  const oldest = (eps: string[]) => eps.map((e) => meta.find((m) => m.endpoint === e)?.fetched_at).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const when = (eps: string[]) => { const n = newest(eps), o = oldest(eps); return { updated: day(n), days_old: daysOld(n), ...(o && n && daysOld(o)! - daysOld(n)! > 1 ? { oldest_part: day(o) } : {}) }; };
  const ex = (endpoint: string, key?: string) => extra.find((x) => x.endpoint === endpoint && (key == null || x.params_hash === key));

  const tracked = t ? pickTracked(t, autoRow?.data ?? []) : [];
  // the competitor analysis: daily overviews for the client and each tracked competitor; discovery and 4 lists per competitor weekly
  const compDaily = (1 + tracked.length) * COMP_SPECS.domain_overview.est;
  const compAll = compDaily + COMP_SPECS.competitors_auto.est + tracked.length * (COMP_SPECS.kw_gap.est + COMP_SPECS.kw_shared.est + COMP_SPECS.comp_pages.est + COMP_SPECS.comp_links.est);
  const research = [
    { data: "overview (backlink summary, ranked keywords, rank overview, new/lost links, link history)", ...when(TIER1), ranked_keywords: meta.find((m) => m.endpoint === "ranked_keywords")?.row_count ?? null,
      refresh: `run_seo_research overview, up to ${money(estimate(TIER1))}; fresh parts reused free; refreshed weekly when automatic refresh is on` },
    { data: "deep dive (backlink lists, referring domains, anchors, most-linked pages, organic competitors, top pages)", ...when(TIER2), refresh: `run_seo_research deep_dive, up to ${money(estimate(TIER2))}; kept 14 days` },
    { data: "competitor analysis (daily visibility snapshots; weekly keyword gaps, shared keywords, top pages, link authority)", updated: snapQ.data?.snapshot_date ?? null, days_old: daysOld(snapQ.data?.snapshot_date), tracked,
      refresh: `run_seo_research competitors, ≈${money(compDaily)} for the daily part, up to ${money(compAll)} when everything is due or forced; runs automatically every 24 hours` },
    { data: "new and lost backlink check", ...when(["link_changes"]), events: meta.find((m) => m.endpoint === "link_changes")?.row_count ?? null, refresh: "run_seo_research link_changes, ≈$0.05; runs daily by itself" },
    { data: "broken backlinks (links pointing at missing pages)", ...when(["broken_backlinks"]), found: ex("broken_backlinks")?.total ?? null, refresh: `run_seo_research broken_backlinks, ≈${money(SPECS.broken_backlinks.est)}` },
    { data: "link gaps (sites linking to a competitor, not to the client)", gaps: meta.filter((m) => m.endpoint === "link_gap").map((m) => ({ competitor: m.params?.competitor ?? null, updated: day(m.fetched_at), domains: extra.find((x) => x.endpoint === "link_gap" && x.params_hash === m.params_hash)?.total ?? null })),
      refresh: `run_seo_research link_gap with a competitor, ≈${money(SPECS.link_gap.est)} each` },
    { data: "keyword gaps (keywords a competitor ranks for, the client doesn't)", gaps: meta.filter((m) => m.endpoint === "kw_gap").map((m) => ({ competitor: m.params?.competitor ?? m.params?.target1 ?? null, updated: day(m.fetched_at), keywords: extra.find((x) => x.endpoint === "kw_gap" && x.params_hash === m.params_hash)?.total ?? null })),
      refresh: "run_seo_research keyword_gap with a competitor, ≈$0.03 each" },
  ];

  const task = ex("audit_task"), audit = ex("audit"), crux = ex("crux"), sx = ex("seosignalx");
  const lh = meta.find((m) => m.endpoint === "lighthouse");
  const audits = [
    { data: "site audit (crawler)", updated: day(audit?.finished ?? audit?.fetched_at), days_old: daysOld(audit?.finished ?? audit?.fetched_at), score: audit?.score ?? null,
      crawl: task ? { status: task.status, pages: task.crawled ?? null, max: task.max ?? null, error: cut(task.err, 120) } : null,
      refresh: `start_site_audit, ${DEFAULT_AUDIT_PAGES} pages HTML-only ≈${money(auditEstimate(DEFAULT_AUDIT_PAGES))}; also runs weekly by itself` },
    { data: "Lighthouse lab scores", updated: day(lh?.fetched_at), days_old: daysOld(lh?.fetched_at), tests: lh?.row_count ?? null, refresh: `run_site_checks lighthouse, ≈${money(3 * 2 * LH_EST)} for 3 pages` },
    { data: "real-user Core Web Vitals (Chrome UX Report)", updated: day(crux?.fetched_at), days_old: daysOld(crux?.fetched_at), ok: crux ? Boolean(crux.source) : null, error: cut(crux?.err, 120), refresh: "run_site_checks core_web_vitals, free; weekly by itself" },
    { data: "technical checks (robots.txt, sitemaps, HTTPS, ~25 pages)", ...when(["tech_checks"]), pages: meta.find((m) => m.endpoint === "tech_checks")?.row_count ?? null, refresh: "run_site_checks technical_checks, free; weekly by itself" },
    { data: "SEOSignalX audits", configured: sxConfigured(), ...when(["seosignalx"]), project: sx?.project ?? null, error: cut(sx?.err, 120), refresh: "sync_seosignalx, free; also refreshed every 6 hours while its pages are opened" },
  ];

  // newest grid per keyword and size (rows are newest first)
  const gridKeys = new Set<string>();
  const grids = meta.filter((m) => m.endpoint === "maps_grid").filter((g) => { const k = `${g.params?.keyword}|${g.params?.size}`; if (gridKeys.has(k)) return false; gridKeys.add(k); return true; });
  const rivals = meta.filter((m) => m.endpoint === "gbp_profile" && m.params_hash !== "self");
  const local = [
    { data: "Business Profile and reviews (DataForSEO)", ...when(["gbp_profile"]), profile: day(meta.find((m) => m.endpoint === "gbp_profile" && m.params_hash === "self")?.fetched_at), reviews: day(meta.find((m) => m.endpoint === "reviews" && m.params_hash === "self")?.fetched_at),
      collecting_reviews: extra.some((x) => x.endpoint === "reviews_task" && x.status === "pending"), refresh: `run_local_seo profile_reviews, ≈${money(PROFILE_EST + REVIEWS_EST)}` },
    { data: "Google Maps rank grids", grids: grids.slice(0, 10).map((g) => {
      const s = extra.find((x) => x.endpoint === "maps_grid" && x.params_hash === g.params_hash)?.grid;
      return { keyword: g.params?.keyword ?? null, size: g.params?.size ?? null, checked: day(g.fetched_at), found: s ? `${s.found}/${s.searched}` : null, average: s?.average ?? null };
    }), refresh: `run_local_seo map_grid, ≈${money(9 * GRID_POINT_EST)} for 3x3, ≈${money(25 * GRID_POINT_EST)} for 5x5` },
    { data: "competing businesses (profiles and reviews)", businesses: rivals.map((r) => ({ name: r.params?.name ?? r.params_hash, updated: day(r.fetched_at) })), refresh: "run_local_seo competitor_profiles, ≈$0.012 each (up to 3)" },
    { data: "Business Profile posts", businesses: meta.filter((m) => m.endpoint === "gbp_posts").map((m) => ({ name: m.params?.name ?? m.params_hash, own: m.params?.own ?? null, updated: day(m.fetched_at), status: extra.find((x) => x.endpoint === "gbp_posts" && x.params_hash === m.params_hash)?.status ?? null })),
      refresh: `run_local_seo posts, ≈${money(POSTS_EST)} per business` },
  ];
  const toolkit = RESULT_SLUGS.map((s) => { const m = meta.find((x) => x.endpoint === `tk_${s}`); return { tool: s, updated: day(m?.fetched_at), cost: m ? Number(m.cost ?? 0) : null, input: m?.params && Object.values(m.params).some(Boolean) ? m.params : undefined }; });

  let spending: Record<string, unknown> = { configured };
  if (configured && ctx.canEdit) {
    const [b, balance] = await Promise.all([budgetNow(ctx.admin, id), dfsBalance()]);
    spending = {
      configured, daily_limit: b.cap, spent_today_all_clients: b.all == null ? "tracking unavailable" : round(b.all, 3), this_client_today: b.mine == null ? null : round(b.mine, 3), per_client_cap: round(b.clientCap, 2),
      left_for_this_client_today: round(b.left, 3), scheduled_refreshes_may_use: round(b.cap * AUTO_SHARE, 2), automatic_weekly_refresh: b.autoRefresh, account_balance: balance == null ? null : round(balance, 2),
      resets: "midnight UTC", change_with: "update_dataforseo_settings",
    };
  } else if (configured) spending = { configured, spend: "visible to owners and admins only" };

  return {
    website: t?.domain ?? null, website_saved: t?.saved ?? false, market: t ? marketLabel(t.location_code) : null,
    competitors: t ? { mode: t.competitor_mode, listed: t.competitors, hidden: t.competitors_excluded, tracked } : null,
    dataforseo: spending, research, audits, local, toolkit,
  };
}

/* ================================================================== research results */
const VIEWS = ["backlink_summary", "backlinks", "new_lost_backlinks", "referring_domains", "anchors", "linked_pages", "broken_backlinks", "link_changes", "link_gap", "keyword_gap", "shared_keywords", "ranked_keywords", "top_pages", "competitors_found"] as const;
type View = (typeof VIEWS)[number];
const RUN_FOR: Record<View, string> = {
  backlink_summary: "overview", backlinks: "deep_dive", new_lost_backlinks: "deep_dive", referring_domains: "deep_dive", anchors: "deep_dive", linked_pages: "deep_dive", broken_backlinks: "broken_backlinks",
  link_changes: "link_changes", link_gap: "link_gap", keyword_gap: "keyword_gap", shared_keywords: "competitors", ranked_keywords: "overview", top_pages: "deep_dive", competitors_found: "deep_dive",
};
const link = (r: Row) => ({ from: r.from, anchor: cut(r.anchor, 80), to: path(r.to), dofollow: r.dofollow, domain_rank: r.domain_rank, spam: r.spam, first_seen: r.first_seen });
const listOf = (d: unknown): { rows: Row[]; total: number } => (Array.isArray(d) ? { rows: d as Row[], total: d.length } : { rows: ((d as { rows?: Row[] } | null)?.rows ?? []), total: Number((d as { total?: number } | null)?.total ?? 0) });

async function competitorRow(ctx: Ctx, endpoint: "link_gap" | "kw_gap" | "kw_shared", competitor?: string) {
  const { data: rows } = await ctx.admin.from("dfs_cache").select("params_hash, params, fetched_at").eq("client_id", ctx.client.id).eq("endpoint", endpoint).order("fetched_at", { ascending: false }).limit(60);
  const of = (p: Row | null) => String(p?.competitor ?? p?.target1 ?? "").toLowerCase();
  const available = [...new Map((rows ?? []).filter((r) => of(r.params as Row)).map((r) => [of(r.params as Row), { competitor: of(r.params as Row), updated: day(r.fetched_at as string) }])).values()];
  const want = competitor?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const hit = (rows ?? []).find((r) => !want || of(r.params as Row) === want);
  if (!hit) return { available, row: null };
  const { data } = await ctx.admin.from("dfs_cache").select("data, fetched_at").eq("client_id", ctx.client.id).eq("endpoint", endpoint).eq("params_hash", hit.params_hash).maybeSingle();
  return { available, competitor: of(hit.params as Row), row: data ? { data: data.data, fetchedAt: data.fetched_at as string } : null };
}

async function researchView(ctx: Ctx, view: View, a: { competitor?: string; search?: string; limit: number }): Promise<string> {
  const id = ctx.client.id;
  const none = (extra: Row = {}) => json({ view, stored: false, ...extra, note: `Nothing stored yet. run_seo_research ${RUN_FOR[view]} fetches it (paid; check the cost with get_seo_data_status).` });
  const page = (src: { fetchedAt: string }, all: Row[], total: number, extra: Row = {}) => {
    const rows = search(all, a.search);
    return capJson({ view, updated: day(src.fetchedAt), days_old: daysOld(src.fetchedAt), total, ...(a.search ? { matching: rows.length } : {}), shown: Math.min(rows.length, a.limit), ...extra, rows: rows.slice(0, a.limit) });
  };
  switch (view) {
    case "backlink_summary": {
      const [s, nl, h, snaps] = await Promise.all([latest<Row>(ctx.admin, id, "summary"), latest<Row[]>(ctx.admin, id, "new_lost"), latest<Row[]>(ctx.admin, id, "history"),
        ctx.admin.from("dfs_snapshots").select("snapshot_date, backlinks, referring_domains, rank, spam_score, organic_keywords, organic_traffic").eq("client_id", id).order("snapshot_date", { ascending: false }).limit(10)]);
      if (!s?.data) return none();
      const d = s.data, top = (k: string) => ((d[k] ?? []) as { name: string; count: number }[]).slice(0, 5);
      return capJson({
        view, updated: day(s.fetchedAt), days_old: daysOld(s.fetchedAt),
        summary: { domain_rank: d.rank, backlinks: d.backlinks, referring_domains: d.referring_domains, referring_pages: d.referring_pages, referring_main_domains: d.referring_main_domains, dofollow: d.dofollow, nofollow: d.nofollow, spam_score: d.spam_score, broken_backlinks: d.broken_backlinks, broken_pages: d.broken_pages, first_seen: d.first_seen, top_tlds: top("tld"), countries: top("countries"), platforms: top("platforms"), link_types: top("types") },
        new_lost_by_month: (nl?.data ?? []).slice(-12), monthly_history: (h?.data ?? []).slice(-12).map((x) => ({ date: x.date, backlinks: x.backlinks, referring_domains: x.referring_domains, rank: x.rank })),
        snapshots: (snaps.data ?? []).reverse(),
      });
    }
    case "backlinks": case "referring_domains": case "anchors": case "linked_pages": case "broken_backlinks": case "top_pages": case "ranked_keywords": {
      const ep = { backlinks: "backlinks", referring_domains: "referring_domains", anchors: "anchors", linked_pages: "domain_pages", broken_backlinks: "broken_backlinks", top_pages: "relevant_pages", ranked_keywords: "ranked_keywords" }[view];
      const r = await latest(ctx.admin, id, ep);
      if (!r) return none();
      const { rows, total } = listOf(r.data);
      const map: Record<string, (x: Row) => Row> = {
        backlinks: (x) => ({ ...link(x), type: x.type }),
        referring_domains: (x) => ({ domain: x.domain, rank: x.rank, backlinks: x.backlinks, pages: x.pages, spam: x.spam, first_seen: x.first_seen, lost: x.lost, broken: x.broken, nofollow: x.nofollow }),
        anchors: (x) => ({ anchor: cut(x.anchor, 100), backlinks: x.backlinks, domains: x.domains, spam: x.spam, first_seen: x.first_seen, lost: x.lost }),
        domain_pages: (x) => ({ page: path(x.page), backlinks: x.backlinks, domains: x.domains, rank: x.rank, status: x.status }),
        broken_backlinks: (x) => ({ from: x.from, links_to: path(x.to), status: x.status, redirects_to: x.redirect_to, anchor: cut(x.anchor, 80), domain_rank: x.domain_rank, dofollow: x.dofollow }),
        relevant_pages: (x) => ({ page: path(x.page), traffic: round(x.traffic, 1), keywords: x.keywords, value: round(x.value), top3: x.top3, top10: x.top10, pos_11_20: x.p11_20, new: x.new, up: x.up, down: x.down, lost: x.lost }),
        ranked_keywords: (x) => ({ keyword: x.keyword, position: x.position, previous: x.previous, change: x.is_new ? "new" : x.is_up ? "up" : x.is_down ? "down" : undefined, volume: x.volume, difficulty: x.difficulty, intent: x.intent, traffic: round(x.traffic, 1), url: path(x.url) }),
      };
      const sorted = ep === "ranked_keywords" || ep === "relevant_pages" ? [...rows].sort((p, q) => Number(q.traffic ?? 0) - Number(p.traffic ?? 0)) : rows;
      return page(r, sorted.map(map[ep]), total, ep === "broken_backlinks" ? { tip: "301-redirect each missing page to its closest live page to recover these links." } : {});
    }
    case "new_lost_backlinks": {
      const [n, l] = await Promise.all([latest(ctx.admin, id, "new_backlinks"), latest(ctx.admin, id, "lost_backlinks")]);
      if (!n && !l) return none();
      const nn = listOf(n?.data), ll = listOf(l?.data), half = Math.max(1, Math.floor(a.limit / 2));
      return capJson({ view, updated: day(n?.fetchedAt ?? l?.fetchedAt), days_old: daysOld(n?.fetchedAt ?? l?.fetchedAt),
        new: { total: nn.total, rows: search(nn.rows.map(link), a.search).slice(0, half) },
        lost: { total: ll.total, rows: search(ll.rows.map((x) => ({ from: x.from, anchor: cut(x.anchor, 80), to: path(x.to), domain_rank: x.domain_rank, last_seen: x.last_seen })), a.search).slice(0, half) },
        note: "Daily changes since the last check are in view link_changes." });
    }
    case "link_changes": {
      const r = await latest<{ checkedAt: string; baseline: boolean; events: Row[] }>(ctx.admin, id, "link_changes", "link_changes");
      if (!r) return none();
      const ev = r.data.events ?? [];
      const since = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      const count = (kind: string, d: number) => ev.filter((e) => e.kind === kind && String(e.detected) >= since(d)).length;
      return page({ fetchedAt: r.data.checkedAt ?? r.fetchedAt }, ev.map((e) => ({ kind: e.kind, detected: e.detected, domain: e.domain, from: e.from, to: path(e.to), anchor: cut(e.anchor, 80), domain_rank: e.domain_rank, spam: e.spam, dofollow: e.dofollow })), ev.length,
        { first_check_baseline_only: r.data.baseline, last_7_days: { new: count("new", 7), lost: count("lost", 7) }, last_30_days: { new: count("new", 30), lost: count("lost", 30) } });
    }
    case "link_gap": case "keyword_gap": case "shared_keywords": {
      const ep = view === "link_gap" ? "link_gap" : view === "keyword_gap" ? "kw_gap" : "kw_shared";
      const g = await competitorRow(ctx, ep, a.competitor);
      if (!g.row) return none({ competitor: a.competitor ?? null, stored_for: g.available });
      const { rows, total } = listOf(g.row.data);
      const map: (x: Row) => Row = view === "link_gap" ? (x: Row) => ({ domain: x.domain, rank: x.rank, backlinks: x.backlinks, pages: x.pages, spam: x.spam, first_seen: x.first_seen })
        : view === "keyword_gap" ? (x: Row) => ({ keyword: x.keyword, volume: x.volume, difficulty: x.difficulty, cpc: x.cpc, intent: x.intent, their_position: x.their_position, their_page: x.their_url, their_traffic: round(x.their_traffic, 1) })
          : (x: Row) => ({ keyword: x.keyword, volume: x.volume, difficulty: x.difficulty, client: x.you, client_page: path(x.you_url), competitor: x.them, competitor_page: path(x.them_url) });
      return page(g.row, rows.map(map), total, { competitor: g.competitor, other_competitors: g.available.filter((x) => x.competitor !== g.competitor) });
    }
    case "competitors_found": {
      const [deep, auto, t] = await Promise.all([latest<Row[]>(ctx.admin, id, "competitors"), latest<AutoCompetitor[]>(ctx.admin, id, "competitors_auto"), peekTarget(ctx.admin, id)]);
      const src = auto ?? deep;
      if (!src) return none();
      const merged = new Map<string, Row>();
      for (const x of [...(auto?.data ?? []), ...((deep?.data ?? []) as unknown as AutoCompetitor[])]) if (x.domain && !merged.has(x.domain)) merged.set(x.domain, { domain: x.domain, shared_keywords: x.shared, avg_position: round(x.avg_position, 1), keywords: x.keywords, traffic: round(x.traffic) });
      const rows = [...merged.values()].filter((x) => x.domain !== t?.domain).sort((p, q) => Number(q.shared_keywords ?? 0) - Number(p.shared_keywords ?? 0));
      return page(src, rows, rows.length, { tracked: t ? pickTracked(t, auto?.data ?? []) : [], mode: t?.competitor_mode ?? null });
    }
  }
}

/* ================================================================== audits */
const BAD = new Set(["fail", "failed", "found", "error", "warning", "warn", "bad", "notfound"]);
const rate = (k: CruxKey, v: number | null | undefined) => (v == null ? null : v <= CRUX_THRESHOLDS[k][0] ? "good" : v <= CRUX_THRESHOLDS[k][1] ? "needs improvement" : "poor");
const vitals = (x: CruxRecord | null) => x && { scope: x.scope, period: x.period, ...Object.fromEntries((Object.entries(x.metrics) as [CruxKey, { p75: number | null; good: number; poor: number }][]).map(([k, m]) => [k, { p75: m.p75, rating: rate(k, m.p75), good_pct: pct(m.good), poor_pct: pct(m.poor) }])) };
const norm = (u: string | null) => { try { const x = new URL(String(u)); return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`.toLowerCase(); } catch { return u ?? ""; } };

/** "label (detail)": the technical-check problems of one page (the label alone is tallied). */
function pageIssues(p: TechPage): string[] {
  const out: string[] = [];
  if (p.status !== 200) out.push(p.status == null ? `no answer${p.error ? ` (${cut(p.error, 50)})` : ""}` : `HTTP error (${p.status})`);
  if (p.hops > 0) out.push(`redirects (${p.hops})`);
  if (p.status !== 200) return out;
  if (!p.title) out.push("no title"); else if (p.titleLen > 60) out.push(`title too long (${p.titleLen} chars)`); else if (p.titleLen < 30) out.push(`title too short (${p.titleLen} chars)`);
  if (!p.desc) out.push("no meta description"); else if (p.descLen > 160) out.push(`description too long (${p.descLen} chars)`);
  if (p.h1 === 0) out.push("no H1"); else if (p.h1 > 1) out.push(`several H1s (${p.h1})`);
  if (p.noindex) out.push("noindex");
  if (!p.canonical) out.push("no canonical"); else if (norm(p.canonical) !== norm(p.finalUrl ?? p.url)) out.push("canonical points elsewhere");
  if (!p.schema.length) out.push("no structured data");
  if (p.mixed > 0) out.push(`insecure http resources (${p.mixed})`);
  if (!p.viewport) out.push("no viewport tag");
  if (!p.lang) out.push("no lang attribute");
  if (p.imgNoAlt > 0) out.push(`images without alt (${p.imgNoAlt} of ${p.imgs})`);
  if (p.words < 300) out.push(`thin content (${p.words} words)`);
  if (!p.inSitemap) out.push("not in sitemap");
  return out;
}

async function auditSection(ctx: Ctx, a: { section: string; issue?: string }): Promise<{ content: string; changed?: boolean; summary: string }> {
  const id = ctx.client.id;
  switch (a.section) {
    case "audit": case "audit_pages": {
      let { result, task } = await loadAudit(ctx.admin, id);
      let changed = false;
      if (task?.data.status === "crawling" && dfsConfigured()) {
        // the same free progress check the Site Audit page makes while a crawl runs; it collects a finished crawl
        const s = await pollAudit(ctx.admin, id).catch(() => null);
        if (s && s.state !== "crawling") { changed = true; ({ result, task } = await loadAudit(ctx.admin, id)); }
        else if (s?.state === "crawling") task = { ...task, data: { ...task.data, crawled: s.crawled } };
      }
      const tk = task?.data;
      const crawl = tk ? { status: tk.status, started: tk.startedAt.slice(0, 16), pages_crawled: tk.crawled ?? 0, max_pages: tk.maxPages, mode: tk.render ?? "html", started_by: tk.source, error: tk.error } : null;
      const r = result?.data as AuditResult | undefined;
      if (!r) return { content: json({ crawl, audit: null, note: "No audit has finished yet. start_site_audit starts one (about $0.025 for 150 pages)." }), changed, summary: "Checked the site audit" };
      if (a.section === "audit_pages") {
        return { content: capJson({ finished: day(r.finishedAt), pages: r.pages, clean_pages: r.cleanPages, note: "Pages with the most problems first.", rows: r.rows.slice(0, 40).map((p) => ({ url: p.url, status: p.status, title: cut(p.title, 70), words: p.words, depth: p.depth, ms: p.ms, score: p.score, errors: p.errors, warnings: p.warnings })) }), changed, summary: "Read the site audit pages" };
      }
      const count = (sev: string) => r.issues.filter((i) => i.severity === sev).reduce((s, i) => s + i.count, 0);
      if (a.issue) {
        const q = a.issue.toLowerCase();
        const i = r.issues.find((x) => x.key.toLowerCase() === q) ?? r.issues.find((x) => x.label.toLowerCase().includes(q) || x.key.toLowerCase().includes(q));
        if (!i) return { content: json({ issue: a.issue, found: false, issues: r.issues.map((x) => `${x.key} (${x.label})`) }), changed, summary: "Read a site audit issue" };
        return { content: capJson({ finished: day(r.finishedAt), issue: { ...i, previous_count: r.previous?.counts[i.key] ?? null, note: "At most 10 example URLs are stored per issue." } }), changed, summary: `Read the audit issue "${i.label}"` };
      }
      const now = new Set(r.issues.map((i) => i.key));
      return {
        content: capJson({
          crawl, audit: {
            finished: day(r.finishedAt), days_old: daysOld(r.finishedAt), domain: r.domain, pages: r.pages, max_pages: r.maxPages, mode: r.render ?? "html", score: r.score,
            errors: count("error"), warnings: count("warning"), notices: count("notice"), clean_pages: r.cleanPages,
            previous: r.previous ? { date: r.previous.date, score: r.previous.score, errors: r.previous.errors, warnings: r.previous.warnings } : null,
            metrics: r.metrics, site: r.site,
            issues: r.issues.map((i) => ({ key: i.key, label: i.label, severity: i.severity, pages: i.count, change: r.previous ? i.count - (r.previous.counts[i.key] ?? 0) : undefined, fix: i.fix, examples: i.urls.slice(0, 3) })),
            fixed_since_previous: r.previous ? Object.entries(r.previous.counts).filter(([k]) => !now.has(k)).map(([k, n]) => ({ key: k, was: n })) : [],
            history: r.history.slice(-8),
          },
        }),
        changed, summary: "Read the site audit",
      };
    }
    case "lighthouse": {
      const runs = await loadLighthouse(ctx.admin, id);
      if (!runs.length) return { content: json({ lighthouse: null, note: `Never run. run_site_checks lighthouse tests up to 3 pages on mobile and desktop (≈${money(6 * LH_EST)}).` }), summary: "Checked Lighthouse" };
      const [cur, prev] = runs;
      return {
        content: capJson({
          tested: day(cur.checkedAt), days_old: daysOld(cur.checkedAt), cost: cur.cost,
          results: cur.rows.map((r) => ({ url: r.url, device: r.device, performance: r.performance, accessibility: r.accessibility, best_practices: r.best_practices, seo: r.seo, lcp_ms: round(r.lcp_ms), cls: round(r.cls, 3), tbt_ms: round(r.tbt_ms), ttfb_ms: round(r.ttfb_ms), error: cut(r.error, 120),
            previous_performance: prev?.rows.find((p) => norm(p.url) === norm(r.url) && p.device === r.device)?.performance ?? undefined })),
          previous_runs: runs.slice(1, 8).map((r) => ({ date: day(r.checkedAt), tests: r.rows.length })),
        }),
        summary: "Read Lighthouse scores",
      };
    }
    case "core_web_vitals": {
      const { latest: last, good } = await loadCrux(ctx.admin, id);
      if (!last) return { content: json({ core_web_vitals: null, note: "Never read. run_site_checks core_web_vitals reads Google's real-user data (free)." }), summary: "Checked Core Web Vitals" };
      return {
        content: capJson({
          last_lookup: day(last.checkedAt), last_lookup_error: last.source ? null : cut(last.error, 300), data_from: day(good?.checkedAt), source: good?.source ?? null,
          site_wide: good ? { mobile: vitals(good.origin.mobile), desktop: vitals(good.origin.desktop) } : null,
          pages: (good?.pages ?? []).filter((p) => p.page).map((p) => ({ url: p.url, device: p.device, ...vitals(p.page) })),
          thresholds: "good up to / poor above: INP 200/500 ms, LCP 2500/4000 ms, CLS 0.1/0.25, TTFB 800/1800 ms, FCP 1800/3000 ms (75th percentile, last 28 days)",
        }),
        summary: "Read Core Web Vitals",
      };
    }
    case "technical_checks": {
      const tc = await loadTechChecks(ctx.admin, id);
      if (!tc) return { content: json({ technical_checks: null, note: "Never run. run_site_checks technical_checks runs them (free)." }), summary: "Checked technical checks" };
      const pages = tc.pages.map((p) => ({ url: p.url, issues: pageIssues(p) }));
      const tally: Record<string, number> = {};
      for (const p of pages) for (const i of p.issues) { const k = i.split(" (")[0]; tally[k] = (tally[k] ?? 0) + 1; }
      return {
        content: capJson({
          checked: day(tc.checkedAt), days_old: daysOld(tc.checkedAt), domain: tc.domain, origin: tc.origin,
          robots_txt: { status: tc.robots.status, blocks_everything: tc.robots.disallowAll, sitemaps_listed: tc.robots.sitemaps, disallows: tc.robots.disallows.slice(0, 12) },
          sitemaps: tc.sitemaps.map((s) => ({ url: s.url, status: s.status, valid: s.valid, urls: s.urls, index: s.index })), sitemap_urls: tc.sitemapUrls,
          https: tc.https, pages_checked: pages.length, issue_counts: tally,
          pages: pages.filter((p) => p.issues.length).sort((p, q) => q.issues.length - p.issues.length),
        }),
        summary: "Read the technical checks",
      };
    }
    default: {
      if (!sxConfigured()) return { content: json({ seosignalx: null, note: "SEOSignalX isn't connected on the server (SEOSIGNALX_MCP_TOKEN)." }), summary: "Checked SEOSignalX" };
      const { bundle, fetchedAt } = await loadBundle(ctx.admin, id);
      if (!bundle) return { content: json({ seosignalx: null, note: "Not synced yet. sync_seosignalx reads it (free)." }), summary: "Checked SEOSignalX" };
      const sc = scores(bundle);
      const failing = (k: string) => {
        const r = (bundle.audits[k]?.result ?? {}) as Row;
        const checks = [...((Array.isArray(r.sections) ? r.sections : []) as Row[]).flatMap((s) => (Array.isArray(s.checks) ? s.checks : []) as Row[]), ...((Array.isArray(r.checks) ? r.checks : []) as Row[])];
        return checks.filter((c) => BAD.has(String(c.status ?? "").toLowerCase())).slice(0, 8).map((c) => cut(c.name ?? c.title ?? c.desc ?? c.id, 80));
      };
      return {
        content: capJson({
          synced: day(fetchedAt), days_old: daysOld(fetchedAt), sync_error: cut(bundle.error, 200),
          project: bundle.project ? { name: bundle.project.name, domain: bundle.project.domain, last_crawl: bundle.project.lastCrawlAt } : null,
          overall_score: sc.overall,
          audits: [...AUDITS.map((x) => x.key as string), ...Object.keys(bundle.audits).filter((k) => !AUDITS.some((x) => x.key === k))].filter((k) => bundle.audits[k]).map((k) => {
            const known = sc.per[k as keyof typeof sc.per] ?? sc.extra.find((e) => e.key === k);
            return { audit: auditLabel(k), saved: day(bundle.audits[k]?.updatedAt), score: known?.score ?? null, summary: known?.summary ?? null, failing_checks: failing(k) };
          }),
          patches: bundle.patches.length, recent_patches: bundle.patches.slice(0, 5).map((p) => ({ title: cut(p.title ?? p.name, 80), status: p.status, type: p.type, updated: day(p.updatedAt) })),
        }),
        summary: "Read SEOSignalX audits",
      };
    }
  }
}

/* ================================================================== local SEO */
async function localSection(ctx: Ctx, section: string): Promise<{ content: string; changed: boolean }> {
  const id = ctx.client.id;
  let changed = false;
  if (dfsConfigured()) {
    // the free collection checks the Local SEO page makes while review / post collections are running
    const { data: pend } = await ctx.admin.from("dfs_cache").select("endpoint, status:data->>status").eq("client_id", id).in("endpoint", ["reviews_task", "gbp_posts"]);
    const waiting = (e: string) => (pend ?? []).some((r) => r.endpoint === e && r.status === "pending");
    if (waiting("reviews_task") && (await pollReviews(ctx.admin, id).catch(() => null))?.done) changed = true;
    if (waiting("gbp_posts") && (await pollPosts(ctx.admin, id).catch(() => null))?.done) changed = true;
  }
  const [local, posts] = await Promise.all([loadLocal(ctx.admin, ctx.admin, id), loadPosts(ctx.admin, id)]);
  const me = local.identity;
  if (!me && !local.profile) return { content: json({ gbp_connected: false, note: "Connect Google Business Profile for this client first (Integrations)." }), changed };
  const st = local.reviews ? reviewStats(local.reviews.items) : null;
  const stats = (s: ReturnType<typeof reviewStats> | null) => s && { loaded: s.loaded, average: round(s.average, 2), reply_rate_pct: pct(s.replyRate), not_replied: s.notReplied, unanswered_negative: s.unansweredNegative, last_90_days: s.last90, median_reply_days: round(s.medianReplyDays, 1), stars: Object.fromEntries(s.distribution.map((d) => [d.stars, d.count])) };
  const seen = new Set<string>();
  const grids = local.grids.filter((g) => { const k = `${g.keyword}|${g.size}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const gridLine = (g: Grid) => ({ keyword: g.keyword, grid: `${g.size}x${g.size}`, spacing_km: g.spacingKm, checked: day(g.checkedAt), found: `${g.summary.found}/${g.summary.searched}`, average_position: g.summary.average, top3: g.summary.top3, top10: g.summary.top10 });
  const p = local.profile?.data;
  switch (section) {
    case "reviews": {
      if (!local.reviews) return { content: json({ reviews: null, collecting: local.reviewTask?.status === "pending", note: "No reviews collected yet. run_local_seo profile_reviews collects the newest 100." }), changed };
      const items = [...local.reviews.items].sort((x, y) => {
        const nx = !x.reply && (x.rating ?? 5) <= 3, ny = !y.reply && (y.rating ?? 5) <= 3;
        return nx === ny ? String(y.date ?? "").localeCompare(String(x.date ?? "")) : nx ? -1 : 1;
      });
      return { content: capJson({ collected: day(local.reviews.fetchedAt), on_google: local.reviews.total, rating: local.reviews.rating, stats: stats(st), monthly: st?.monthly.slice(-12),
        reviews: items.slice(0, 25).map((r) => ({ date: r.date, rating: r.rating, text: cut(r.text, 220), replied: Boolean(r.reply), local_guide: r.localGuide || undefined })),
        note: "Unanswered reviews of 3 stars or less first, then newest." }), changed };
    }
    case "map_grids": {
      if (!grids.length) return { content: json({ map_grids: [], note: "No map grid yet. run_local_seo map_grid checks a keyword on Google Maps around the business." }), changed };
      return { content: capJson({ business: me?.name ?? p?.title ?? null, grids: grids.slice(0, 6).map((g) => {
        const m: (string | number)[][] = Array.from({ length: g.size }, () => Array.from({ length: g.size }, () => "-"));
        for (const pt of g.points) m[pt.row][pt.col] = pt.rank ?? "20+";
        return { ...gridLine(g), ranks_by_row: m.map((r) => r.join(" ")), outranked_by: gridRivals([g], me?.name ?? p?.title ?? "").map((x) => x.name).slice(0, 5),
          history: local.grids.filter((x) => x.keyword === g.keyword && x.size === g.size).slice(0, 6).map((x) => ({ checked: day(x.checkedAt), average: x.summary.average, found: x.summary.found })) };
      }), note: "ranks_by_row: north row first; \"20+\" = not in the top 20 there; the business is at the centre." }), changed };
    }
    case "competitors": {
      return { content: capJson({
        compared: local.rivals.map((r) => ({ business: r.profile?.title ?? r.key, category: r.profile?.category, rating: r.profile?.rating, reviews_on_google: r.profile?.votes, photos: r.profile?.photos, claimed: r.profile?.claimed, website: r.profile?.domain, address: r.profile?.address,
          review_stats: stats(r.reviews ? reviewStats(r.reviews.items) : null), collecting: r.task?.status === "pending", topics: r.profile?.topics.slice(0, 5).map((x) => x.topic) })),
        client: p ? { business: p.title, rating: p.rating, reviews_on_google: p.votes, photos: p.photos, review_stats: stats(st) } : null,
        suggestions: { people_also_search: (p?.alsoSearch ?? []).map((x) => `${x.title} (${x.rating ?? "?"}★, ${x.votes ?? 0} reviews)`), outrank_on_maps: gridRivals(local.grids.slice(0, 20), me?.name ?? p?.title ?? "").map((x) => x.name) },
      }), changed };
    }
    case "posts": {
      if (!posts.length) return { content: json({ posts: [], note: "No posts collected yet. run_local_seo posts collects the newest posts of the client and compared competitors." }), changed };
      return { content: capJson({ businesses: posts.map((r) => ({ business: r.name, own: r.own, status: r.status, collected: day(r.fetchedAt), posts: r.posts.length, broken_links: r.posts.filter((x) => x.broken).length,
        recent: r.posts.slice(0, r.own ? 10 : 4).map((x) => ({ date: x.date, type: x.type, words: x.words, text: cut(x.text, 150), button: x.cta, links_to: x.dest, broken: x.broken || undefined })) })) }), changed };
    }
    default: {
      return { content: capJson({
        business: me ? { name: me.name, city: me.city } : null,
        profile: p ? { updated: day(local.profile!.fetchedAt), title: p.title, category: p.category, other_categories: p.additional, rating: p.rating, reviews_on_google: p.votes, address: p.address, phone: p.phone, website: p.domain, claimed: p.claimed, photos: p.photos, status: p.status,
          hours: p.hours.map((h) => `${h.day.slice(0, 3)} ${h.open}`).join("; ") || null, attributes: p.attributes.length, services: p.services.slice(0, 10), review_topics: p.topics.slice(0, 8).map((x) => `${x.topic} (${x.count})`), questions: p.questions } : null,
        reviews: st ? { collected: day(local.reviews!.fetchedAt), ...stats(st) } : null, collecting_reviews: local.reviewTask?.status === "pending",
        map_grids: grids.slice(0, 8).map(gridLine),
        competitors: local.rivals.map((r) => ({ business: r.profile?.title ?? r.key, rating: r.profile?.rating, reviews_on_google: r.profile?.votes, reply_rate_pct: r.reviews ? pct(reviewStats(r.reviews.items).replyRate) : null })),
        posts: posts.map((r) => ({ business: r.name, own: r.own, status: r.status, posts: r.posts.length, last_post: r.posts[0]?.date ?? null, broken_links: r.posts.filter((x) => x.broken).length })),
      }), changed };
    }
  }
}

/* ================================================================== tools */
export const readTools: NovaTool[] = [
  read({
    name: "get_seo_data_status",
    description: "What SEO research, audit, local SEO and toolkit data is stored, how old each is and what refreshing it costs; for owners/admins also today's DataForSEO spend, the daily limit and the account balance. Check this before proposing a paid run.",
    schema: z.object({}),
    async run(ctx) { return capJson(await dataStatus(ctx)); },
    summary: () => "Checked stored SEO data and spending",
  }),
  read({
    name: "get_research_results",
    description: "Stored DataForSEO research results: backlink_summary, backlinks, new_lost_backlinks, referring_domains, anchors, linked_pages, broken_backlinks, link_changes, link_gap / keyword_gap / shared_keywords (per competitor), ranked_keywords, top_pages, competitors_found. Free.",
    schema: z.object({
      view: z.enum(VIEWS),
      competitor: z.string().trim().max(200).optional().describe("link_gap, keyword_gap, shared_keywords: the competitor domain (default: the newest stored)"),
      search: z.string().trim().max(100).optional().describe("only rows containing this text (keyword, URL, domain, anchor)"),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    async run(ctx, a) { return researchView(ctx, a.view, a); },
    summary: (a) => `Read ${a.view.replace(/_/g, " ")}${a.competitor ? ` vs ${a.competitor}` : ""}`,
  }),
  read({
    name: "get_keyword_research",
    description: "A stored keyword research search (ideas, suggestions or related) for a seed keyword: volume, difficulty, CPC, intent, 12-month trend. Free; run_keyword_research fetches new ones. Owners and admins.",
    schema: z.object({
      seed: seedSchema,
      kind: z.enum(["ideas", "suggestions", "related"]).default("ideas"),
      market: z.enum(MARKET_KEYS).optional().describe(marketDescription),
      min_volume: z.number().int().min(0).max(10_000_000).optional(),
      max_difficulty: z.number().int().min(0).max(100).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    async run(ctx, a) {
      // the dashboard only shows keyword research to the owners and admins who can run it
      if (!ctx.canEdit) throw new ToolError("Keyword research is only available to owners and admins.");
      const t = await peekTarget(ctx.admin, ctx.client.id);
      const m = marketOf(a.market, t?.location_code ?? 2840);
      const term = normSeed(a.seed);
      const row = await storedSearch(ctx.admin, a.kind, term, m.code, m.lang, true);
      if (!row?.data) return json({ seed: term, kind: a.kind, market: m.label, stored: false, note: `Not researched yet for this market. run_keyword_research fetches it (about ${a.kind === "related" ? "$0.02" : "$0.03"}).` });
      const rows = row.data.rows.filter((r) => (a.min_volume == null || Number(r.volume ?? 0) >= a.min_volume) && (a.max_difficulty == null || (r.difficulty != null && Number(r.difficulty) <= a.max_difficulty)))
        .sort((x, y) => Number(y.volume ?? 0) - Number(x.volume ?? 0));
      return capJson({ seed: term, kind: a.kind, market: m.label, fetched: day(row.fetched_at), days_old: daysOld(row.fetched_at), ...(daysOld(row.fetched_at)! >= KW_TTL_DAYS ? { stale: "older than 30 days; a new search would refetch it" } : {}),
        total_available: row.data.total, stored: row.data.rows.length, matching: rows.length,
        rows: rows.slice(0, a.limit).map((r) => ({ keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, cpc: round(r.cpc, 2), competition: r.competition, intent: r.intent, trend_12m: r.trend })) });
    },
    summary: (a) => `Read keyword ${a.kind} for "${a.seed}"`,
  }),
  read({
    name: "get_site_audit_results",
    description: "Site health: the latest site audit (score, issues with fixes and example URLs; a running crawl is checked for free and collected when done), audit_pages (worst pages), Lighthouse scores, real-user Core Web Vitals, the free technical checks (robots.txt, sitemaps, HTTPS, page checks) or SEOSignalX audits.",
    schema: z.object({
      section: z.enum(["audit", "audit_pages", "lighthouse", "core_web_vitals", "technical_checks", "seosignalx"]).default("audit"),
      issue: z.string().trim().max(80).optional().describe("audit: one issue key or label, to list all of its stored example URLs"),
    }),
    async run(ctx, a) {
      const r = await auditSection(ctx, a);
      return r.changed ? withChange("get_site_audit_results", r.content, `${r.summary} (a finished crawl was collected)`) : { content: r.content, action: { tool: "get_site_audit_results", ok: true, summary: r.summary } };
    },
  }),
  read({
    name: "get_local_seo_results",
    description: "Local SEO from DataForSEO: overview, reviews (stats and recent reviews), map_grids (Google Maps rank grids), competitors (compared businesses and suggestions) or posts (Business Profile posts). Finished review/post collections are collected for free first.",
    schema: z.object({ section: z.enum(["overview", "reviews", "map_grids", "competitors", "posts"]).default("overview") }),
    async run(ctx, a) {
      const r = await localSection(ctx, a.section);
      const summary = `Read local SEO ${a.section.replace("_", " ")}`;
      return r.changed ? withChange("get_local_seo_results", r.content, `${summary} (new results collected)`) : { content: r.content, action: { tool: "get_local_seo_results", ok: true, summary } };
    },
  }),
  read({
    name: "get_toolkit_results",
    description: "SEO Toolkit: without tool, every tool with when it last ran and what a run costs; with tool, a compact view of its last stored result.",
    schema: z.object({ tool: z.enum(RESULT_SLUGS).optional() }),
    async run(ctx, a) {
      const id = ctx.client.id;
      if (!a.tool) {
        const { data } = await ctx.admin.from("dfs_cache").select("endpoint, fetched_at, cost, params").eq("client_id", id).like("endpoint", "tk_%");
        return capJson({ tools: TOOLS.map((t) => {
          const row = (data ?? []).find((r) => r.endpoint === `tk_${t.slug}`);
          const runnable = (RESULT_SLUGS as readonly string[]).includes(t.slug);
          return { tool: t.slug, title: t.title, what: cut(t.description, 140), last_run: day(row?.fetched_at as string | undefined), last_cost: row ? Number(row.cost ?? 0) : undefined,
            input: row?.params && Object.values(row.params as Row).some(Boolean) ? row.params : undefined,
            run: runnable ? `run_toolkit_tool, ${SPEC[t.slug as keyof typeof SPEC].cost}${isScan(t.slug) ? "; one scan refreshes all six site-scan tools" : ""}` : "nothing to run from chat: its page works from stored data" };
        }) });
      }
      const row = await latest(ctx.admin, id, `tk_${a.tool}`);
      if (!row) return json({ tool: a.tool, title: toolTitle(a.tool), stored: false, note: `Never run. run_toolkit_tool runs it (${SPEC[a.tool].cost}).` });
      return capJson({ tool: a.tool, title: toolTitle(a.tool), updated: day(row.fetchedAt), days_old: daysOld(row.fetchedAt), input: Object.values(row.params).some(Boolean) ? row.params : undefined, cost: row.cost, result: compactResult(a.tool, row.data) });
    },
    summary: (a) => (a.tool ? `Read the ${toolTitle(a.tool)} result` : "Listed the SEO Toolkit tools"),
  }),
];
