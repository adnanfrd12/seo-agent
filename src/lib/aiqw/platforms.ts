import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { G as GscG } from "@/lib/gscx/g";
import type { InventoryRow } from "@/lib/gscx/inventory";
import { benchmarkCtr, pathOf } from "@/lib/gscx/model";
import type { SocialRow } from "@/lib/social/fetch";
import { PLATFORM_INFO } from "@/lib/social/platforms";
import { GBP, SITE_WIDE } from "./candidates";
import { SOCIAL_SOURCES, type Candidate, type Fact, type SocialSource, type Source } from "./types";

/**
 * Quick-win rules for the portal's other sources: Google Business Profile, Bing Webmaster Tools, Microsoft Clarity,
 * every connected social platform and SEOSignalX audits. Data is read from what the portal already stores; every
 * number in a candidate comes from it. Pure rules below the loader.
 */
const DAY = 86_400_000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const r1 = (v: number) => Math.round(v * 10) / 10;
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (Number(b) || 0), 0);

type GbpDay = { metric_date: string; call_clicks: number | null; website_clicks: number | null; direction_requests: number | null; impressions_desktop_maps: number | null; impressions_desktop_search: number | null; impressions_mobile_maps: number | null; impressions_mobile_search: number | null };
export interface PlatformData {
  gbp: {
    daily: GbpDay[];
    keywords: { month: string; keyword: string; impressions: number | null; impressions_threshold: number | null }[];
    reviews: { rating: number | null; reply_text: string | null; reviewed_at: string | null }[];
  } | null;
  bing: {
    queries: { week: string; query: string; clicks: number; impressions: number; avg_impression_position: number | null }[];
    pages: { week: string; page: string; clicks: number; impressions: number; avg_impression_position: number | null }[];
    crawl: Record<string, number | null> | null;
  } | null;
  clarity: { metric_date: string; value: string; metric: string; count: number | null; sessions: number | null }[] | null;
  social: Partial<Record<SocialSource, SocialRow>>;
  seosignalx: { audit: string; score: number | null; rating: string | null; failed: { name: string; section: string; status: string }[] }[] | null;
}

/** Everything the rules need, from storage only (no API calls). */
export async function loadPlatformData(admin: SupabaseClient, clientId: string, sources: Source[]): Promise<PlatformData> {
  const on = (s: Source) => sources.includes(s);
  const d56 = isoDaysAgo(56), d35 = isoDaysAgo(35);
  const [daily, keywords, reviews, bq, bp, bc, cl, social, ssx] = await Promise.all([
    on("gbp") ? admin.from("gbp_daily_metrics").select("metric_date, call_clicks, website_clicks, direction_requests, impressions_desktop_maps, impressions_desktop_search, impressions_mobile_maps, impressions_mobile_search").eq("client_id", clientId).gte("metric_date", d56).limit(2000) : null,
    on("gbp") ? admin.from("gbp_keyword_metrics").select("month, keyword, impressions, impressions_threshold").eq("client_id", clientId).gte("month", isoDaysAgo(70)).limit(2000) : null,
    on("gbp") ? admin.from("gbp_reviews").select("rating, reply_text, reviewed_at").eq("client_id", clientId).order("reviewed_at", { ascending: false }).limit(500) : null,
    on("bing") ? admin.from("bing_query_metrics").select("week, query, clicks, impressions, avg_impression_position").eq("client_id", clientId).gte("week", d35).limit(5000) : null,
    on("bing") ? admin.from("bing_page_metrics").select("week, page, clicks, impressions, avg_impression_position").eq("client_id", clientId).gte("week", d35).limit(3000) : null,
    on("bing") ? admin.from("bing_crawl_metrics").select("metric_date, crawled_pages, crawl_errors, in_index, code_4xx, code_5xx, blocked_by_robots, dns_failures, connection_timeout").eq("client_id", clientId).order("metric_date", { ascending: false }).limit(1).maybeSingle() : null,
    on("clarity") ? admin.from("clarity_behavior_metrics").select("metric_date, value, metric, count, sessions").eq("client_id", clientId).eq("dimension", "url").gte("metric_date", isoDaysAgo(30)).limit(5000) : null,
    SOCIAL_SOURCES.some(on) ? admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", "social").limit(20) : null,
    on("seosignalx") ? admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "seosignalx").eq("params_hash", "bundle").maybeSingle() : null,
  ]);
  const gbpRows = daily?.data ?? [];
  const audits = ((ssx?.data?.data as { audits?: Record<string, { result?: { score?: number; rating?: string; sections?: { title?: string; checks?: { name?: string; status?: string }[] }[] } }> } | undefined)?.audits) ?? null;
  return {
    gbp: on("gbp") && (gbpRows.length || (keywords?.data ?? []).length || (reviews?.data ?? []).length) ? { daily: gbpRows as GbpDay[], keywords: (keywords?.data ?? []) as NonNullable<PlatformData["gbp"]>["keywords"], reviews: (reviews?.data ?? []) as NonNullable<PlatformData["gbp"]>["reviews"] } : null,
    bing: on("bing") && ((bq?.data ?? []).length || bc?.data) ? { queries: (bq?.data ?? []) as NonNullable<PlatformData["bing"]>["queries"], pages: (bp?.data ?? []) as NonNullable<PlatformData["bing"]>["pages"], crawl: (bc?.data as Record<string, number | null> | null) ?? null } : null,
    clarity: on("clarity") && (cl?.data ?? []).length ? (cl!.data as NonNullable<PlatformData["clarity"]>) : null,
    social: Object.fromEntries((social?.data ?? []).filter((r) => on(r.params_hash as Source)).map((r) => [r.params_hash, r.data as SocialRow])),
    seosignalx: audits ? Object.entries(audits).map(([audit, a]) => ({
      audit, score: typeof a.result?.score === "number" ? a.result.score : null, rating: a.result?.rating ?? null,
      failed: (a.result?.sections ?? []).flatMap((s) => (s.checks ?? []).filter((c) => c.status === "fail" || c.status === "warning").map((c) => ({ name: c.name ?? "check", section: s.title ?? "", status: c.status ?? "" }))),
    })) : null,
  };
}

/** Which sources hold data for this client (the checkboxes on the Generate panel). */
export async function sourceStatus(admin: SupabaseClient, clientId: string): Promise<Record<Source, { ok: boolean; note: string }>> {
  const [{ data: conns }, { data: social }, { data: cache }, { data: target }] = await Promise.all([
    admin.from("integration_connections").select("provider, status").eq("client_id", clientId),
    admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", "social").limit(20),
    admin.from("dfs_cache").select("endpoint").eq("client_id", clientId).in("endpoint", ["seosignalx", "kw_gap", "gbp_profile"]).limit(20),
    admin.from("research_targets").select("domain").eq("client_id", clientId).maybeSingle(),
  ]);
  const conn = (p: string) => (conns ?? []).some((c) => c.provider === p && c.status === "connected");
  const ok = (v: boolean, yes: string, no: string) => ({ ok: v, note: v ? yes : no });
  const soc = new Map((social ?? []).map((r) => [r.params_hash, r.data as SocialRow]));
  const out = {
    gsc: ok(conn("gsc"), "Connected", "Not connected (Integrations)"),
    ga4: ok(conn("ga4"), "Connected", "Not connected (Integrations)"),
    gbp: ok(conn("gbp") || conn("lbm") || (cache ?? []).some((c) => c.endpoint === "gbp_profile"), conn("gbp") ? "Connected" : conn("lbm") ? "Through Local Brand Manager" : "Public profile data", "Not connected (Integrations)"),
    bing: ok(conn("bing"), "Connected", "Not connected (Integrations)"),
    clarity: ok(conn("clarity"), "Connected", "Not connected (Integrations)"),
    dataforseo: ok(Boolean(target?.domain), "Research target set", "No research target"),
    crawl: ok(conn("gsc"), "Pages from the sitemaps and Search Console", "Needs Search Console"),
    seosignalx: ok((cache ?? []).some((c) => c.endpoint === "seosignalx"), "Audits found", "No SEOSignalX project for this site"),
  } as Record<Source, { ok: boolean; note: string }>;
  for (const p of SOCIAL_SOURCES) {
    const r = soc.get(p);
    out[p] = ok(Boolean(r && r.status === "ok"), r?.mode === "connected" ? "Connected" : "Public numbers only", r?.status === "needs" ? "Needs a login (Social media)" : "Not set up (Social media)");
  }
  return out;
}

/* ------------------------------------------------------------------ rules */
export interface PlatformCtx { gsc: GscG | null; inv: InventoryRow[]; leadRate: number | null }

export function platformCandidates(d: PlatformData, ctx: PlatformCtx): Candidate[] {
  const out: Candidate[] = [];
  const f = (name: string, value: number | string, source: Source): Fact => ({ name, value, source });
  const siteText = ctx.inv.map((r) => `${r.crawl?.title ?? ""} ${r.crawl?.h1 ?? ""} ${(r.crawl?.headings ?? []).join(" ")}`.toLowerCase()).join(" \n ");
  const pageCtx = (path: string) => { const r = ctx.inv.find((x) => pathOf(x.url) === path); return r?.crawl ? { title: r.crawl.title, h1: r.crawl.h1, h2s: r.crawl.headings.slice(0, 12), word_count: r.crawl.words, internal_links_in: null, schema_types: r.crawl.schema.slice(0, 8) } : null; };

  /* ---------------- Google Business Profile */
  if (d.gbp) {
    const days = d.gbp.daily;
    const last = days.reduce((a, r) => (r.metric_date > a ? r.metric_date : a), "");
    if (last) {
      const cut = new Date(Date.parse(last) - 27 * DAY).toISOString().slice(0, 10), pcut = new Date(Date.parse(last) - 55 * DAY).toISOString().slice(0, 10);
      const cur = days.filter((r) => r.metric_date >= cut), prev = days.filter((r) => r.metric_date >= pcut && r.metric_date < cut);
      const actions = (xs: typeof days) => sum(xs.map((r) => (r.call_clicks ?? 0) + (r.website_clicks ?? 0) + (r.direction_requests ?? 0)));
      const views = (xs: typeof days) => sum(xs.map((r) => (r.impressions_desktop_maps ?? 0) + (r.impressions_desktop_search ?? 0) + (r.impressions_mobile_maps ?? 0) + (r.impressions_mobile_search ?? 0)));
      const a = actions(cur), b = actions(prev);
      if (prev.length >= 20 && b >= 10 && a < b * 0.8) out.push({
        candidate_id: "gbp_actions_drop:profile", rule: "gbp_actions_drop", page_url: GBP, scope_screens: ["business-profile"],
        facts: [f("Calls + website clicks + direction requests, last 28 days", a, "gbp"), f("Same, previous 28 days", b, "gbp"), f("Calls, last 28 days", sum(cur.map((r) => r.call_clicks)), "gbp"), f("Calls, previous 28 days", sum(prev.map((r) => r.call_clicks)), "gbp"),
          f("Profile views, last 28 days", views(cur), "gbp"), f("Profile views, previous 28 days", views(prev), "gbp"), f("Gain basis", "recovering the lost profile actions", "gbp")],
        queries: [], page_context: null, computed_gain: (b - a) * 30 / 28, gain_unit: "clicks/mo", effort_hint: "Low", sources: ["gbp"],
        draft: { title: "Win back the calls and clicks the Business Profile lost", where: "Google Business Profile", steps: ["Post an update and add new photos.", "Check hours, phone and website link are correct.", "Answer recent reviews."] },
      });
    }
    // searches that find the profile but aren't covered on the website
    const months = [...new Set(d.gbp.keywords.map((k) => k.month))].sort().reverse();
    const latest = d.gbp.keywords.filter((k) => k.month === months[0]).map((k) => ({ ...k, n: k.impressions ?? k.impressions_threshold ?? 0 })).sort((x, y) => y.n - x.n);
    const missing = latest.filter((k) => k.n >= 15 && !siteText.includes(k.keyword.toLowerCase())).slice(0, 12);
    if (missing.length >= 2) out.push({
      candidate_id: "gbp_keywords_site:profile", rule: "gbp_keywords_site", page_url: SITE_WIDE, scope_screens: ["business-profile", "gsc:local"],
      facts: [f("Month", months[0], "gbp"), ...missing.map((k) => f(`Business Profile searches for "${k.keyword}"`, k.impressions != null ? k.impressions : `fewer than ${k.impressions_threshold}`, "gbp")), f("Gain basis (estimate)", "monthly profile searches × 2% that would click through to a matching page", "gbp")],
      queries: missing.map((k) => ({ query: k.keyword, impressions: k.impressions ?? k.impressions_threshold ?? undefined })), page_context: null,
      computed_gain: sum(missing.map((k) => k.n)) * 0.02, gain_unit: "clicks/mo", effort_hint: "Medium", sources: ["gbp", "crawl"],
      draft: { title: "Cover the searches people use to find the Business Profile on the website", where: "Service pages (H2 sections) and the Business Profile services list", steps: ["Match each search to the closest service page.", "Add a section that names it.", "Add it to the Business Profile services."] },
    });
    // reviews without a reply
    const r90 = d.gbp.reviews.filter((r) => r.reviewed_at && r.reviewed_at.slice(0, 10) >= isoDaysAgo(180));
    const unanswered = r90.filter((r) => !r.reply_text);
    if (unanswered.length >= 2) out.push({
      candidate_id: "gbp_review_replies:profile", rule: "gbp_review_replies", page_url: GBP, scope_screens: ["business-profile", "gsc:brand"],
      facts: [f("Reviews in the last 180 days", r90.length, "gbp"), f("Without a reply", unanswered.length, "gbp"), f("Unanswered with 3 stars or fewer", unanswered.filter((r) => (r.rating ?? 5) <= 3).length, "gbp"),
        f("Average rating of those reviews", r1(sum(r90.map((r) => r.rating)) / Math.max(1, r90.filter((r) => r.rating != null).length)), "gbp"), f("Gain basis (estimate)", "0.3 profile action a month per answered review", "gbp")],
      queries: [], page_context: null, computed_gain: unanswered.length * 0.3, gain_unit: "clicks/mo", effort_hint: "Low", sources: ["gbp"],
      draft: { title: `Reply to the ${unanswered.length} reviews that have no answer`, where: "Google Business Profile → Reviews", steps: ["Reply to low ratings first, calmly and specifically.", "Thank each positive reviewer by the service they mention.", "Reply to new reviews within 2 days from now on."] },
    });
  }

  /* ---------------- Bing Webmaster Tools */
  if (d.bing) {
    const byQ = new Map<string, { clicks: number; impressions: number; pw: number }>();
    for (const r of d.bing.queries) { const x = byQ.get(r.query) ?? { clicks: 0, impressions: 0, pw: 0 }; x.clicks += Number(r.clicks); x.impressions += Number(r.impressions); x.pw += Number(r.impressions) * Number(r.avg_impression_position ?? 0); byQ.set(r.query, x); }
    const qps = ctx.gsc ? ctx.gsc.qp() : [];
    const pageFor = (q: string) => { const rows = qps.filter((x) => x.query === q).sort((a, b) => Number(b.impressions) - Number(a.impressions)); return rows[0] ? pathOf(String(rows[0].page)) : null; };
    const striking = [...byQ].map(([q, x]) => ({ q, ...x, pos: x.impressions ? x.pw / x.impressions : 0 })).filter((x) => x.pos >= 4 && x.pos <= 20 && x.impressions >= 30).sort((a, b) => b.impressions - a.impressions).slice(0, 10);
    for (const s of striking) {
      const page = pageFor(s.q);
      out.push({
        candidate_id: `bing_striking:${s.q}`, rule: "bing_striking", page_url: page ?? SITE_WIDE, scope_screens: ["bing"],
        facts: [f("Bing impressions, last 4 weeks", s.impressions, "bing"), f("Bing clicks, last 4 weeks", s.clicks, "bing"), f("Average Bing position", r1(s.pos), "bing"), ...(page ? [f("Page ranking for it on Google (Search Console)", page, "gsc")] : []),
          f("Gain basis (estimate)", "Bing impressions × (10% CTR at position 3 − CTR at the current position)", "bing")],
        queries: [{ query: s.q, impressions: s.impressions, clicks: s.clicks, position: r1(s.pos) }], page_context: page ? pageCtx(page) : null,
        computed_gain: s.impressions * Math.max(0.005, benchmarkCtr(3) - benchmarkCtr(s.pos)), gain_unit: "clicks/mo", effort_hint: "Medium", sources: page ? ["bing", "gsc"] : ["bing"],
        draft: { title: `Lift "${s.q}" into Bing's top 3`, where: "Title tag, H1 and first paragraph of the ranking page", steps: [`Use "${s.q}" early in the title and H1.`, "Answer it in the first paragraph.", "Submit the page in Bing Webmaster Tools (URL submission)."] },
      });
    }
    const c = d.bing.crawl;
    const problems = c ? (["crawl_errors", "code_4xx", "code_5xx", "blocked_by_robots", "dns_failures", "connection_timeout"] as const).filter((k) => (c[k] ?? 0) > 0) : [];
    if (c && problems.length) out.push({
      candidate_id: "bing_crawl:site", rule: "bing_crawl", page_url: SITE_WIDE, scope_screens: ["bing"],
      facts: [f("Date", String(c.metric_date ?? ""), "bing"), f("Pages crawled by Bing", c.crawled_pages ?? 0, "bing"), f("Pages in Bing's index", c.in_index ?? 0, "bing"), ...problems.map((k) => f(k.replace(/_/g, " "), c[k] ?? 0, "bing")),
        f("Gain basis (estimate)", "0.5 click a month per page Bing can't crawl", "bing")],
      queries: [], page_context: null, computed_gain: Math.max(0.5, sum(problems.map((k) => c[k])) * 0.5), gain_unit: "clicks/mo", effort_hint: "Medium", sources: ["bing"],
      draft: { title: "Fix the pages Bing can't crawl", where: "Server responses, redirects and robots.txt", steps: ["Open Bing Webmaster Tools → Site Explorer and filter by errors.", "Fix or redirect 4xx pages; investigate 5xx with the host.", "Check robots.txt isn't blocking pages that should rank."] },
    });
  }

  /* ---------------- Microsoft Clarity */
  if (d.clarity) {
    const byUrl = new Map<string, Record<string, number>>();
    for (const r of d.clarity) {
      let path: string; try { const u = new URL(r.value); path = u.pathname; } catch { continue; }
      const m = byUrl.get(path) ?? {}; m[r.metric] = (m[r.metric] ?? 0) + Number(r.metric === "Traffic" ? r.sessions ?? r.count ?? 0 : r.count ?? 0); byUrl.set(path, m);
    }
    const lr = ctx.leadRate ?? 0.01;
    const rows = [...byUrl].map(([path, m]) => ({ path, sessions: m.Traffic ?? 0, rage: m.RageClickCount ?? 0, dead: m.DeadClickCount ?? 0, quick: m.QuickbackClick ?? 0, js: m.ScriptErrorCount ?? 0 }))
      .filter((x) => x.sessions >= 5 && (x.rage + x.dead + x.quick >= 3 || x.js >= 5)).sort((a, b) => (b.rage + b.dead + b.quick) - (a.rage + a.dead + a.quick)).slice(0, 8);
    for (const x of rows) out.push({
      candidate_id: `clarity_ux:${x.path}`, rule: "clarity_ux", page_url: x.path, scope_screens: ["clarity", "ga4:eng"],
      facts: [f("Sessions, last 30 days (Clarity)", x.sessions, "clarity"), f("Rage clicks", x.rage, "clarity"), f("Dead clicks", x.dead, "clarity"), f("Quick backs", x.quick, "clarity"), f("JavaScript errors", x.js, "clarity"),
        f(ctx.leadRate != null ? "Site lead rate (GA4, 30 days)" : "Assumed lead rate", `${(lr * 100).toFixed(2)}%`, ctx.leadRate != null ? "ga4" : "clarity"),
        f("Gain basis (estimate)", "sessions × lead rate × 20% (share of frustrated visits a fix recovers)", "clarity")],
      queries: [], page_context: pageCtx(x.path), computed_gain: Math.max(0.05, x.sessions * lr * 0.2), gain_unit: "leads/mo", effort_hint: "Medium", sources: ctx.leadRate != null ? ["clarity", "ga4"] : ["clarity"],
      draft: { title: `Fix what frustrates visitors on ${x.path}`, where: "The elements visitors click that don't respond (see Clarity heatmap)", steps: ["Open Clarity → Heatmaps → this page, filter rage and dead clicks.", "Make the clicked elements work (link them) or stop them looking clickable.", "Fix the JavaScript errors shown in Clarity."] },
    });
  }

  /* ---------------- social platforms */
  for (const p of SOCIAL_SOURCES) {
    const row = d.social[p];
    if (!row) continue;
    const label = PLATFORM_INFO[p].label;
    // only a login that used to work and now doesn't (expired, revoked, wrong account), not one never connected
    const broken = row.status === "error" || (row.status === "needs" && /expired|revoked|not @|wrong|manages no|Disconnect it|can't be read/i.test(row.needs ?? ""));
    if (row.status === "needs" && !broken) continue;
    if (broken) {
      out.push({
        candidate_id: `social_reconnect:${p}`, rule: "social_reconnect", page_url: SITE_WIDE, scope_screens: ["social"],
        facts: [f(`${label} status`, row.status === "needs" ? row.needs ?? "needs a login" : row.error ?? "error", p), f("Gain basis", "fixed small value: data quality", p)],
        queries: [], page_context: null, computed_gain: 0.3, gain_unit: "clicks/mo", effort_hint: "Low", sources: [p],
        draft: { title: `Reconnect ${label} so its stats can be read`, where: "SEO Insights → Social media → Connect", steps: [`Press Connect next to ${label}.`, "Log in with the business account.", "Press Refresh stats."] },
      });
      continue;
    }
    if (row.status !== "ok") continue;
    const since30 = isoDaysAgo(30);
    const recent = row.posts.filter((x) => (x.date ?? "") >= since30);
    const dated = row.posts.filter((x) => x.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const eng = (x: (typeof row.posts)[number]) => (x.likes ?? 0) + (x.comments ?? 0) + (x.shares ?? 0);
    const best = [...row.posts].sort((a, b) => eng(b) - eng(a) || (b.views ?? 0) - (a.views ?? 0))[0];
    if (recent.length < 4) out.push({
      candidate_id: `social_cadence:${p}`, rule: "social_cadence", page_url: SITE_WIDE, scope_screens: ["social"],
      facts: [f(`${label} posts in the last 30 days`, recent.length, p), f(`${label} followers`, row.profile.followers ?? "unknown", p), f("Last post", dated[0]?.date ?? "none found", p),
        ...(best ? [f("Best post so far", `${(best.title ?? "").slice(0, 80)} · ${eng(best)} interactions${best.views != null ? ` · ${best.views} views` : ""}`, p)] : []), f("Gain basis (estimate)", "0.5 website visit a month per extra weekly post", p)],
      queries: [], page_context: null, computed_gain: Math.max(0.5, (4 - recent.length) * 0.5), gain_unit: "clicks/mo", effort_hint: "Medium", sources: [p],
      draft: { title: `Post on ${label} at least once a week`, where: label, steps: ["Plan 4 posts a month from the services people search for.", "Repurpose the best-performing post's format.", "Link to the matching service page."] },
    });
  }

  /* ---------------- SEOSignalX audits */
  for (const a of d.seosignalx ?? []) {
    const failed = a.failed.filter((x) => x.status === "fail");
    if (!failed.length) continue;
    out.push({
      candidate_id: `seosignalx:${a.audit}`, rule: "seosignalx_audit", page_url: SITE_WIDE, scope_screens: ["seosignalx"],
      facts: [f(`SEOSignalX ${a.audit} score`, a.score ?? "unknown", "seosignalx"), f("Rating", a.rating ?? "unknown", "seosignalx"), f("Failed checks", failed.length, "seosignalx"),
        ...failed.slice(0, 12).map((x) => f(`Failed: ${x.name}`, x.section, "seosignalx")), f("Gain basis (estimate)", "0.3 click a month per fixed check", "seosignalx")],
      queries: [], page_context: null, computed_gain: failed.length * 0.3, gain_unit: "clicks/mo", effort_hint: failed.length > 5 ? "High" : "Medium", sources: ["seosignalx"],
      draft: { title: `Fix the failed ${a.audit} checks from the SEOSignalX audit`, where: "Site-wide (see each check)", steps: failed.slice(0, 5).map((x) => `Fix: ${x.name}.`) },
    });
  }
  return out;
}
