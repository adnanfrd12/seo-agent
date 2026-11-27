import "server-only";
import { z } from "zod";
import { checkBrokenBacklinks } from "@/app/(dashboard)/backlinks/actions";
import { compareRivals, refreshLocal, runMapsGrid } from "@/app/(dashboard)/local-seo/actions";
import { refreshPosts } from "@/app/(dashboard)/local-seo/posts-actions";
import { checkLinkChanges, researchKeywords, runCompetitorsNow, runCoreRefresh, runDeepDive, runKeywordGap, runLinkGap, saveDfsSettings } from "@/app/(dashboard)/research-actions";
import { syncSeoSignalX } from "@/app/(dashboard)/seosignalx/actions";
import { refreshCruxNow, runLighthouseNow, runSiteAudit } from "@/app/(dashboard)/site-audit/actions";
import { runTechnicalChecksNow } from "@/app/(dashboard)/technical-seo/actions";
import { runToolkit } from "@/app/(dashboard)/toolkit/actions";
import { claudeBudget } from "@/lib/ai/usage";
import { auditEstimate, loadAudit, loadAuditRender, RENDER_MODES } from "@/lib/dataforseo/audit";
import { AUTO_SHARE, DEFAULT_DAILY_BUDGET, getSettings, PER_CLIENT_SHARE } from "@/lib/dataforseo/budget";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { clientOrgId } from "@/lib/org/config";
import { COMP_SPECS, pickTracked, type AutoCompetitor } from "@/lib/dataforseo/competitors";
import { POSTS_EST, postTargets } from "@/lib/dataforseo/gbp-posts";
import { LH_EST, lighthouseUrls } from "@/lib/dataforseo/lighthouse";
import { GRID_POINT_EST, localIdentity, PROFILE_EST, REVIEWS_EST, type Profile } from "@/lib/dataforseo/local";
import { KW_TTL_DAYS, SPECS, TIER1, TIER2, type Spec } from "@/lib/dataforseo/research";
import { loadBundle, SX_NOT_CONFIGURED, sxConfigured } from "@/lib/seosignalx/mcp";
import { defaultBriefKeyword } from "@/lib/toolkit/brief";
import { runSiteScanNow } from "@/lib/toolkit/scan-actions";
import { ownUrl, SERP_EST, storedSerps } from "@/lib/toolkit/store";
import { MAX_SXO } from "@/lib/toolkit/sxo";
import { bullets, fromAction, plural, write, type ExecResult, type NovaCtx, type NovaTool, type Preview } from "../../kit";
import {
  ageDays, ago, budgetCheck, budgetNow, day, domainOf, KW_EST, latest, marketDescription, MARKET_KEYS, marketKey, marketOf, money, NO_SITE, normSeed, NOT_CONFIGURED,
  peekTarget, planCalls, seconds, seedSchema, storedSearch, targetNote, usd, type PeekTarget, type PlannedCall,
} from "./shared";
import { isScan, RUNNABLE, SCAN_SLUGS, SPEC, toolTitle } from "./toolkit";

type Ctx = Pick<NovaCtx, "admin" | "client">;
const RESEARCH_PATHS = ["/backlinks", "/organic-keywords", "/keyword-research", "/competitors", "/overview"];
const extras = (t: PeekTarget | null) => (t && targetNote(t) ? [targetNote(t)!] : []);
/** Long-running runs get a progress bar on the Confirm card. */
const wait = (s: number): Pick<Preview, "expectSeconds"> => (s >= 10 ? { expectSeconds: Math.round(s) } : {});
const names = (calls: PlannedCall[], max = 6) => `${calls.slice(0, max).map((c) => c.label).join(", ")}${calls.length > max ? ` and ${calls.length - max} more` : ""}`;

/* ================================================================== research runs */
const LABEL: Record<string, string> = {
  summary: "backlink summary", new_lost: "new/lost links by month", history: "24-month link history", rank_overview: "organic rank overview", ranked_keywords: "ranked keywords (up to 1,000)",
  backlinks: "top 1,000 backlinks", new_backlinks: "newest backlinks", lost_backlinks: "lost backlinks", referring_domains: "referring domains", anchors: "anchor texts",
  domain_pages: "most-linked pages", competitors: "organic competitors", relevant_pages: "top pages by traffic",
};
/** trackLinkChanges' budget estimate for its two calls (lib/dataforseo/research.ts LINK_CHANGES_EST, not exported; ≈$0.05 on the button). */
const LINK_CHANGES_EST = 0.06;
const KINDS = ["overview", "deep_dive", "competitors", "link_changes", "broken_backlinks", "link_gap", "keyword_gap"] as const;
type Kind = (typeof KINDS)[number];
const RUN: Record<Kind, { title: string; effect: string }> = {
  overview: { title: "Refresh the overview data", effect: "Updates the stored backlink summary, ranked keywords, rank overview, new/lost links and link history, and records today's snapshot for the trend charts." },
  deep_dive: { title: "Run the backlink deep dive", effect: "Replaces the stored backlink lists, referring domains, anchors, most-linked pages, organic competitors and top pages (kept 14 days)." },
  competitors: { title: "Re-run the competitor analysis", effect: "Adds today's visibility snapshot for the client and its tracked competitors; the weekly lists (keyword gaps, shared keywords, top pages, link authority) refresh when older than a week. It normally runs by itself every 24 hours." },
  link_changes: { title: "Check for new and lost backlinks", effect: "Adds the links found or lost since the last check to the 90-day change log (the scheduled job already checks daily)." },
  broken_backlinks: { title: "Check for backlinks to missing pages", effect: "Replaces the stored list of backlinks that point at pages answering 4xx/5xx (recover them with 301 redirects)." },
  link_gap: { title: "Find link gaps", effect: "Stores the sites that link to the competitor but not to the client (replaces any stored link gap for that competitor; kept 14 days)." },
  keyword_gap: { title: "Find keyword gaps", effect: "Stores the keywords the competitor ranks top-20 for (50+ searches a month) that the client doesn't rank for at all (replaces any stored gap for that competitor; kept 7 days)." },
};

/** Every lookup a research run makes, and whether ensure() would reuse its stored answer (see planCalls). */
async function researchPlan(ctx: Ctx, t: PeekTarget, kind: Kind, force: boolean, competitor?: string): Promise<PlannedCall[]> {
  const id = ctx.client.id;
  const plan = (calls: { label: string; spec: Spec; extra?: string }[]) => planCalls(ctx.admin, id, t, calls, force);
  switch (kind) {
    case "overview": return plan(TIER1.map((k) => ({ label: LABEL[k], spec: SPECS[k] as Spec })));
    case "deep_dive": return plan(TIER2.map((k) => ({ label: LABEL[k], spec: SPECS[k] as Spec })));
    case "broken_backlinks": return plan([{ label: "backlinks to missing pages", spec: SPECS.broken_backlinks }]);
    case "link_gap": return plan([{ label: `sites linking to ${competitor}`, spec: SPECS.link_gap, extra: competitor }]);
    case "keyword_gap": return plan([{ label: `keyword gap vs ${competitor}`, spec: COMP_SPECS.kw_gap, extra: competitor }]);
    case "link_changes": {
      const row = await latest(ctx.admin, id, "link_changes", "link_changes");
      return [{ label: "newest and lost backlinks (2 lookups)", est: LINK_CHANGES_EST, fresh: !force && Boolean(row) && ageDays(row!.fetchedAt) < 0.9, fetchedAt: row?.fetchedAt ?? null }];
    }
    case "competitors": {
      // the same sequence as runCompetitorAnalysis, with the competitors it would track today
      const auto = await latest<AutoCompetitor[]>(ctx.admin, id, "competitors_auto");
      const tracked = pickTracked(t, auto?.data ?? []);
      return plan([
        { label: "competitor discovery", spec: COMP_SPECS.competitors_auto },
        ...[t.domain, ...tracked].map((d) => ({ label: `visibility of ${d}`, spec: COMP_SPECS.domain_overview, extra: d })),
        ...tracked.flatMap((d) => [
          { label: `keyword gap vs ${d}`, spec: COMP_SPECS.kw_gap, extra: d }, { label: `shared keywords with ${d}`, spec: COMP_SPECS.kw_shared, extra: d },
          { label: `top pages of ${d}`, spec: COMP_SPECS.comp_pages, extra: d }, { label: `link authority of ${d}`, spec: COMP_SPECS.comp_links, extra: d },
        ]),
      ]);
    }
  }
}

const runSeoResearch = write({
  name: "run_seo_research",
  description: "Run a paid DataForSEO research refresh: overview (ranked keywords, backlink summary, rank overview), deep_dive (backlink lists, referring domains, anchors, top pages), competitors (competitor analysis), link_changes, broken_backlinks, or link_gap / keyword_gap against a competitor domain. Stored results that are still fresh are reused free unless force.",
  schema: z.object({
    kind: z.enum(KINDS),
    competitor: z.string().trim().max(200).optional().describe("link_gap and keyword_gap: the competitor's domain"),
    force: z.boolean().default(false).describe("fetch again even when the stored result is still fresh"),
  }),
  async prepare(ctx, a) {
    if (!(await dfsConfigured(ctx.client.id))) return { error: NOT_CONFIGURED };
    const t = await peekTarget(ctx.admin, ctx.client.id);
    if (!t) return { error: NO_SITE };
    let competitor: string | undefined;
    if (a.kind === "link_gap" || a.kind === "keyword_gap") {
      competitor = domainOf(a.competitor) ?? undefined;
      if (!competitor) return { error: "Give the competitor's domain for a gap analysis, e.g. competitor.com." };
      if (competitor === t.domain) return { error: "Pick a competitor, not the client's own site." };
    }
    const calls = await researchPlan(ctx, t, a.kind, a.force, competitor);
    const due = calls.filter((c) => !c.fresh), reused = calls.filter((c) => c.fresh);
    const all = calls.reduce((s, c) => s + c.est, 0);
    if (!due.length) {
      const newest = calls.map((c) => c.fetchedAt).filter(Boolean).sort().at(-1);
      return { error: `Nothing to fetch: the stored result is still fresh (updated ${ago(newest)}), so this run would only reuse it. Read it with get_research_results, or set force to fetch everything again (about ${money(all)}).` };
    }
    const cost = due.reduce((s, c) => s + c.est, 0);
    const gate = await budgetCheck(ctx.admin, ctx.client.id, cost, Math.min(...due.map((c) => c.est)));
    if ("error" in gate) return gate;
    const secs = 3 + due.length * 4;
    return {
      title: `${RUN[a.kind].title}${competitor ? ` vs ${competitor}` : ""} for ${t.domain} (≈${money(cost)})`,
      detail: bullets([
        `${due.length === calls.length ? plural(due.length, "DataForSEO lookup") : `${due.length} of ${calls.length} DataForSEO lookups`}: ${names(due)}.`,
        ...(reused.length ? [`Still fresh, reused free: ${names(reused, 4)}.`] : []),
        `Cost: up to about ${money(cost)} (the dashboard's rounded-up budget estimates; the actual charge is usually lower).`,
        RUN[a.kind].effect,
        `Takes ${seconds(secs)}.`,
        ...gate.lines, ...extras(t),
      ], 14),
      input: { kind: a.kind, competitor, force: a.force },
      ...wait(secs),
    };
  },
  async execute(x, a) {
    const f = a.force;
    switch (a.kind) {
      case "overview": return fromAction(await runCoreRefresh(f), "Overview data updated.", RESEARCH_PATHS);
      case "deep_dive": return fromAction(await runDeepDive(f), "Deep dive updated.", RESEARCH_PATHS);
      case "competitors": return fromAction(await runCompetitorsNow(f), "Competitor analysis updated.", RESEARCH_PATHS);
      case "link_changes": return fromAction(await checkLinkChanges(f), "Link changes checked.", ["/backlinks", "/overview"]);
      case "broken_backlinks": return fromAction(await checkBrokenBacklinks(f), "Broken backlinks checked.", ["/backlinks"]);
      case "keyword_gap": return fromAction(await runKeywordGap(a.competitor ?? "", f), "Keyword gap found.", RESEARCH_PATHS);
      case "link_gap": {
        const r = await runLinkGap(a.competitor ?? "", f);
        if (!r.ok) return { ok: false, message: r.error };
        const { data } = await x.admin.from("dfs_cache").select("total:data->total").eq("client_id", x.client.id).eq("endpoint", "link_gap").contains("params", { competitor: a.competitor }).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
        const n = Number((data as { total?: number } | null)?.total ?? 0);
        return { ok: true, message: `${r.message}${n ? ` ${n.toLocaleString("en-US")} referring domains link to ${a.competitor} but not to the client.` : ""}`, paths: RESEARCH_PATHS };
      }
    }
  },
});

/* ================================================================== keyword research */
const KW_LABEL = { ideas: "Keyword ideas", suggestions: "Keyword suggestions", related: "Related searches" } as const;

const runKeywordResearch = write({
  name: "run_keyword_research",
  description: "Keyword research for up to 5 seed keywords (DataForSEO ideas, suggestions or related searches: volume, difficulty, CPC, intent, trend; up to 200 keywords each). About $0.02-0.03 per new search; searches stored in the last 30 days are free.",
  schema: z.object({
    seeds: z.array(seedSchema).min(1).max(5),
    kind: z.enum(["ideas", "suggestions", "related"]).default("ideas").describe("ideas = broad related keywords; suggestions = keywords containing the seed; related = Google's related searches"),
    market: z.enum(MARKET_KEYS).optional().describe(marketDescription),
    force: z.boolean().default(false).describe("search again even if a stored result is less than 30 days old"),
  }),
  async prepare(ctx, a) {
    if (!(await dfsConfigured(ctx.client.id))) return { error: NOT_CONFIGURED };
    const t = await peekTarget(ctx.admin, ctx.client.id);
    const m = marketOf(a.market, t?.location_code ?? 2840);
    const seeds = [...new Set(a.seeds.map(normSeed))];
    const stored = await Promise.all(seeds.map((s) => storedSearch(ctx.admin, a.kind, s, m.code, m.lang, false, ctx.client.id)));
    const plan = seeds.map((seed, i) => ({ seed, row: stored[i], fresh: !a.force && Boolean(stored[i]) && ageDays(stored[i]!.fetched_at) < KW_TTL_DAYS }));
    const due = plan.filter((p) => !p.fresh);
    const each = KW_EST[a.kind];
    if (!due.length) return { error: `${seeds.length === 1 ? "This search is" : `All ${seeds.length} searches are`} already stored from the last 30 days (free): read ${seeds.length === 1 ? "it" : "them"} with get_keyword_research. Set force to search again (about ${money(each * seeds.length)}).` };
    const cost = due.length * each;
    const gate = await budgetCheck(ctx.admin, ctx.client.id, cost, each);
    if ("error" in gate) return gate;
    const secs = 2 + due.length * 5;
    return {
      title: `Research ${KW_LABEL[a.kind].toLowerCase()} for ${seeds.length === 1 ? `"${seeds[0]}"` : plural(seeds.length, "seed keyword")} in ${m.label} (≈${money(cost)})`,
      detail: bullets([
        ...plan.map((p) => `"${p.seed}": ${p.fresh ? `stored result from ${day(p.row!.fetched_at)} is reused (free)` : `new search, about ${money(each)}${p.row ? ` (the stored one is from ${day(p.row.fetched_at)})` : ""}`}`),
        "Each search returns up to 200 keywords with monthly volume, difficulty, CPC, intent and a 12-month trend. Results are kept 30 days; repeating a search in that time is free.",
        `Takes ${seconds(secs)}.`,
        ...gate.lines,
      ]),
      input: { seeds, kind: a.kind, market: marketKey(m.code), force: a.force },
      ...wait(secs),
    };
  },
  async execute(_x, a) {
    const m = marketOf(a.market, 2840);
    const lines: string[] = [];
    let ok = 0, firstError = "";
    for (const seed of a.seeds) {
      const r = await researchKeywords(a.kind, seed, m.code, a.force);
      if (!r.ok) {
        firstError ||= r.error;
        lines.push(`• "${seed}": ${r.error}`);
        if (/budget|limit/i.test(r.error)) break;
        continue;
      }
      ok++;
      const d = r.data;
      const top = [...d.rows].sort((p, q) => Number(q.volume ?? 0) - Number(p.volume ?? 0)).slice(0, 8)
        .map((k) => `${k.keyword} (${Number(k.volume ?? 0).toLocaleString("en-US")}/mo${k.difficulty != null ? `, difficulty ${k.difficulty}` : ""})`);
      lines.push(`• "${seed}": ${d.rows.length} keywords${d.total > d.rows.length ? ` of ${d.total.toLocaleString("en-US")}` : ""} (${d.fromCache ? `stored ${day(d.fetchedAt)}, free` : `new search, ${money(d.cost)}`}). Top by volume: ${top.join(", ") || "none"}.`);
    }
    if (!ok) return { ok: false, message: firstError || "No search ran." };
    return { ok: true, message: `${KW_LABEL[a.kind]} (${m.label}):\n${lines.join("\n")}\nAsk me for the full list or a filter, e.g. easy wins with low difficulty.`, paths: ["/integrations"] };
  },
});

/* ================================================================== site audit and checks */
const startSiteAudit = write({
  name: "start_site_audit",
  description: "Start a site audit crawl of the client's website (DataForSEO On-Page: about $0.00015 a page in HTML mode, e.g. ≈$0.025 for 150 pages). The crawl takes a few minutes; read the result later with get_site_audit_results.",
  schema: z.object({
    pages: z.number().int().min(10).max(500).default(150).describe("pages to crawl (the Site Audit page offers 50, 150, 300 or 500)"),
    mode: z.enum(["html", "js", "browser"]).optional().describe("html = server HTML only (cheapest); js = render JavaScript (10x the price); browser = full browser rendering with Core Web Vitals (34x). Default: the mode used last"),
  }),
  async prepare(ctx, a) {
    const id = ctx.client.id;
    if (!(await dfsConfigured(ctx.client.id))) return { error: NOT_CONFIGURED };
    const t = await peekTarget(ctx.admin, id);
    if (!t) return { error: NO_SITE };
    const [{ result, task }, saved] = await Promise.all([loadAudit(ctx.admin, id), loadAuditRender(ctx.admin, id)]);
    const tk = task?.data;
    // startAudit refuses while a crawl younger than 3 hours is running
    if (tk?.status === "crawling" && Date.now() - Date.parse(tk.startedAt) < 3 * 3_600_000) {
      return { error: `An audit is already running (started ${tk.startedAt.slice(0, 16).replace("T", " ")} UTC; ${tk.crawled ?? 0} of up to ${tk.maxPages} pages crawled). Check it with get_site_audit_results.` };
    }
    const mode = a.mode ?? saved, pages = Math.min(Math.max(Math.round(a.pages), 10), 500);
    const cost = auditEstimate(pages, mode);
    const gate = await budgetCheck(ctx.admin, id, cost);
    if ("error" in gate) return gate;
    const r = result?.data;
    return {
      title: `Start a site audit of ${t.domain}: ${pages} pages, ${RENDER_MODES[mode].label.toLowerCase()} (≈${money(cost)})`,
      detail: bullets([
        `Crawls up to ${pages} pages of ${t.domain} (${RENDER_MODES[mode].label}, $${RENDER_MODES[mode].perPage} a page): about ${money(cost)}.`,
        "Only the start happens now (a few seconds). The crawl takes a few minutes; its result then replaces the current audit (the score history is kept).",
        r ? `Current audit: ${day(r.finishedAt)}, score ${r.score ?? "?"}, ${r.pages} pages.` : "No audit has finished before.",
        mode !== saved ? `The weekly automatic audit uses this mode (${RENDER_MODES[mode].label}) from now on, instead of ${RENDER_MODES[saved].label}.` : `The weekly automatic audit keeps using ${RENDER_MODES[mode].label}.`,
        ...gate.lines, ...extras(t),
      ]),
      input: { pages, mode },
    };
  },
  async execute(x, a) {
    const r = await runSiteAudit(a.pages, a.mode ?? (await loadAuditRender(x.admin, x.client.id)));
    return r.ok ? { ok: true, message: `${r.message} Ask me to check the results in a few minutes.`, paths: ["/site-audit"] } : { ok: false, message: r.error };
  },
});

/** The pages runLighthouseNow tests: the home page, then the pages with the most organic traffic, then the shallowest crawled pages. */
async function lighthousePages(ctx: Ctx, domain: string, n: number): Promise<string[]> {
  const { data: cached } = await ctx.admin.from("dfs_cache").select("endpoint, data").eq("client_id", ctx.client.id).in("endpoint", ["relevant_pages", "audit"]);
  const rel = ((cached ?? []).find((r) => r.endpoint === "relevant_pages")?.data ?? []) as { page: string | null; traffic: number | null }[];
  const audit = (cached ?? []).find((r) => r.endpoint === "audit")?.data as { rows?: { url: string; status: number | null; depth: number | null }[] } | undefined;
  return [...new Set([
    `https://${domain}/`,
    ...rel.filter((r) => r.page).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)).map((r) => (r.page!.startsWith("http") ? r.page! : `https://${r.page}`)),
    ...(audit?.rows ?? []).filter((r) => r.status === 200).sort((a, b) => (a.depth ?? 9) - (b.depth ?? 9)).map((r) => r.url),
  ])].slice(0, Math.min(3, Math.max(1, Math.round(n))));
}

const runSiteChecks = write({
  name: "run_site_checks",
  description: "Run a site check: lighthouse (lab scores for the home page and up to 2 top pages, mobile and desktop, $0.01 a page; also refreshes real-user data), core_web_vitals (Google's real-user Chrome UX Report, free) or technical_checks (robots.txt, sitemaps, HTTPS and ~25 pages, free).",
  schema: z.object({
    kind: z.enum(["lighthouse", "core_web_vitals", "technical_checks"]),
    pages: z.number().int().min(1).max(3).default(3).describe("lighthouse: how many pages (home page first, then the top pages)"),
  }),
  async prepare(ctx, a) {
    const id = ctx.client.id;
    const t = await peekTarget(ctx.admin, id);
    if (a.kind === "lighthouse") {
      if (!(await dfsConfigured(ctx.client.id))) return { error: NOT_CONFIGURED };
      if (!t) return { error: NO_SITE };
      const urls = await lighthousePages(ctx, t.domain, a.pages);
      const cost = urls.length * 2 * LH_EST;
      const gate = await budgetCheck(ctx.admin, id, cost);
      if ("error" in gate) return gate;
      const secs = [0, 45, 75, 100][urls.length];
      return {
        title: `Run Lighthouse on ${plural(urls.length, "page")} of ${t.domain} (≈${money(cost)})`,
        detail: bullets([
          ...urls.map((u) => `${u}: mobile and desktop`),
          `Cost: ${money(cost)} (${money(LH_EST)} per page per device).`,
          "Stores today's scores (performance, accessibility, best practices, SEO, LCP, CLS, TBT) next to the earlier runs, and re-reads Google's real-user Core Web Vitals for these pages (free).",
          `Takes ${seconds(secs)}${urls.length > 1 ? " (up to two minutes)" : ""}.`,
          ...gate.lines, ...extras(t),
        ]),
        input: { kind: a.kind, pages: urls.length },
        ...wait(secs),
      };
    }
    if (a.kind === "core_web_vitals") {
      const tested = await lighthouseUrls(ctx.admin, id);
      const urls = tested.length ? tested : t ? [`https://${t.domain}/`] : [];
      if (!urls.length) return { error: NO_SITE };
      return {
        title: `Refresh real-user Core Web Vitals for ${plural(urls.length, "page")} (free)`,
        detail: bullets([
          ...urls.map((u) => `${u}: mobile and desktop`),
          "Reads Google's Chrome UX Report (what real Chrome users experienced over the last 28 days: INP, LCP, CLS, TTFB, FCP) for these pages and the whole site. Free; today's lookup is added to the earlier ones.",
          `Takes ${seconds(20)}.`,
        ]),
        input: { kind: a.kind, pages: a.pages },
        ...wait(20),
      };
    }
    if (!t) return { error: NO_SITE };
    const prev = await ctx.admin.from("dfs_cache").select("fetched_at").eq("client_id", id).eq("endpoint", "tech_checks").maybeSingle();
    return {
      title: `Run the technical checks on ${t.domain} (free)`,
      detail: bullets([
        "Reads robots.txt, the XML sitemaps, the HTTPS setup and up to 25 important pages (titles, descriptions, headings, canonicals, noindex, structured data, image alt text, redirects).",
        `Free: it reads the client's own website. Replaces the stored checks${prev.data ? ` from ${day(prev.data.fetched_at as string)}` : ""}.`,
        `Takes ${seconds(40)}.`,
        ...extras(t),
      ]),
      input: { kind: a.kind, pages: a.pages },
      ...wait(40),
    };
  },
  async execute(_x, a) {
    if (a.kind === "lighthouse") return fromAction(await runLighthouseNow(a.pages), "Lighthouse finished.", ["/site-audit"]);
    if (a.kind === "core_web_vitals") return fromAction(await refreshCruxNow(), "Real-user data refreshed.", ["/site-audit"]);
    return fromAction(await runTechnicalChecksNow(), "Technical checks finished.", ["/technical-seo"]);
  },
});

const syncSeoSignalx = write({
  name: "sync_seosignalx",
  description: "Read the client's SEOSignalX project again (saved audits and patches) through its read-only connection. Free; any member may do it.",
  // the Sync button and its server action are open to every member
  roles: ["owner", "admin", "viewer"],
  schema: z.object({}),
  async prepare(ctx) {
    if (!(await sxConfigured(ctx.client.id))) return { error: SX_NOT_CONFIGURED };
    const { bundle, fetchedAt } = await loadBundle(ctx.admin, ctx.client.id);
    return {
      title: "Sync SEOSignalX now (free)",
      detail: bullets([
        `Re-reads the saved SEOSignalX audits${bundle?.project ? ` of the project "${bundle.project.name}"` : ""} and the patches, for every SEOSignalX tab. Read-only and free.`,
        `Last synced ${ago(fetchedAt)}${bundle?.available.length ? ` (${plural(bundle.available.length, "saved audit")})` : ""}; it also refreshes by itself every 6 hours while its pages are opened.`,
        `Takes ${seconds(30)}.`,
      ]),
      ...wait(30),
    };
  },
  async execute(x) {
    const r = await syncSeoSignalX();
    if (!r.ok) return { ok: false, message: r.error };
    const { bundle } = await loadBundle(x.admin, x.client.id);
    const n = Object.keys(bundle?.audits ?? {}).length;
    return {
      ok: true, paths: ["/seosignalx"],
      message: bundle?.project ? `SEOSignalX synced: project "${bundle.project.name}", ${plural(n, "saved audit")}${bundle.patches.length ? `, ${plural(bundle.patches.length, "patch", "patches")}` : ""}.` : "SEOSignalX synced, but no SEOSignalX project matches this client's website.",
    };
  },
});

/* ================================================================== local SEO */
const NO_GBP = "Connect Google Business Profile for this client first (Integrations).";

const runLocalSeo = write({
  name: "run_local_seo",
  description: "Run a paid local SEO check (DataForSEO): profile_reviews (Business Profile + newest 100 reviews, ≈$0.014), posts (Business Profile posts of the client and compared competitors, ≈$0.004 each), map_grid (Google Maps rank for one keyword at 9 or 25 points around the business, $0.0025 a point) or competitor_profiles (profiles and newest 50 reviews of up to 3 named businesses, ≈$0.01 each).",
  schema: z.object({
    kind: z.enum(["profile_reviews", "posts", "map_grid", "competitor_profiles"]),
    keyword: z.string().trim().min(2).max(80).optional().describe("map_grid: the search to check, e.g. \"sign shop near me\""),
    grid_size: z.union([z.literal(3), z.literal(5)]).default(3).describe("map_grid: 3 = 3x3 (9 points), 5 = 5x5 (25 points)"),
    spacing_km: z.number().min(0.25).max(10).default(2).describe("map_grid: distance between points (the page offers 0.5, 1, 2, 3 or 5 km)"),
    businesses: z.array(z.string().trim().min(2).max(120)).min(1).max(3).optional().describe("competitor_profiles: business names as on Google Maps"),
  }),
  async prepare(ctx, a) {
    const id = ctx.client.id;
    if (!(await dfsConfigured(ctx.client.id))) return { error: NOT_CONFIGURED };
    const me = await localIdentity(ctx.admin, id);
    if (!me) return { error: NO_GBP };
    const biz = me.name || "the business";
    switch (a.kind) {
      case "profile_reviews": {
        const cost = PROFILE_EST + REVIEWS_EST;
        const [prof, task] = await Promise.all([latest(ctx.admin, id, "gbp_profile", "self"), latest<{ status: string }>(ctx.admin, id, "reviews_task", "self")]);
        const gate = await budgetCheck(ctx.admin, id, cost, PROFILE_EST);
        if ("error" in gate) return gate;
        return {
          title: `Refresh the Business Profile and reviews of ${biz} (≈${money(cost)})`,
          detail: bullets([
            `Reads the Google Business Profile (rating, review count, categories, hours, photos, attributes, "people also search"): about ${money(PROFILE_EST)}.`,
            `Starts collecting the newest 100 reviews (about ${money(REVIEWS_EST)}); they arrive within a few minutes and replace the stored reviews.`,
            `Last refreshed ${ago(prof?.fetchedAt)}.${task?.data.status === "pending" ? " A review collection is still running; the new one replaces it." : ""}`,
            `Takes ${seconds(10)}; the reviews follow later.`,
            ...gate.lines,
          ]),
          input: { kind: a.kind },
          ...wait(10),
        };
      }
      case "posts": {
        const targets = await postTargets(ctx.admin, id);
        if (!targets.length) return { error: NO_GBP };
        const { data: rows } = await ctx.admin.from("dfs_cache").select("status:data->>status, posted:data->>postedAt").eq("client_id", id).eq("endpoint", "gbp_posts");
        // the page disables its button while a collection is running
        if ((rows ?? []).some((r) => r.status === "pending" && Date.now() - Date.parse(String(r.posted)) < 6 * 3_600_000)) {
          return { error: "A posts collection is already running; the posts arrive within a few minutes (get_local_seo_results with section posts collects them)." };
        }
        const cost = targets.length * POSTS_EST;
        const gate = await budgetCheck(ctx.admin, id, cost, POSTS_EST);
        if ("error" in gate) return gate;
        const secs = 3 + targets.length * 3;
        return {
          title: `Collect Business Profile posts for ${plural(targets.length, "business", "businesses")} (≈${money(cost)})`,
          detail: bullets([
            `Businesses: ${targets.map((x) => `${x.who.name}${x.own ? " (the client)" : ""}`).join(", ")}.`,
            `Starts a collection of the newest 20 posts of each (about ${money(POSTS_EST)} per business). The posts arrive within a few minutes, then every post link is checked; earlier posts stay visible until then.`,
            `Takes ${seconds(secs)} to start.`,
            ...gate.lines,
          ]),
          input: { kind: a.kind },
          ...wait(secs),
        };
      }
      case "map_grid": {
        if (!a.keyword) return { error: "Give the keyword to check on Google Maps, e.g. \"sign shop near me\"." };
        if (me.lat == null || me.lng == null) return { error: "The business location isn't known (the Business Profile has no coordinates), so a map grid can't run." };
        const kw = a.keyword.toLowerCase().replace(/\s+/g, " ");
        const points = a.grid_size * a.grid_size, cost = points * GRID_POINT_EST;
        const gate = await budgetCheck(ctx.admin, id, cost);
        if ("error" in gate) return gate;
        const { data: prev } = await ctx.admin.from("dfs_cache").select("fetched_at").eq("client_id", id).eq("endpoint", "maps_grid").contains("params", { keyword: kw, size: a.grid_size }).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
        const last = day(prev?.fetched_at as string | undefined);
        const secs = points <= 9 ? 25 : 60;
        return {
          title: `Check Google Maps rankings for "${kw}" on a ${a.grid_size}x${a.grid_size} grid (≈${money(cost)})`,
          detail: bullets([
            `${points} Google Maps searches ${a.spacing_km} km apart around ${biz}${me.city ? ` (${me.city})` : ""}, covering about ${(a.grid_size - 1) * a.spacing_km} km across.`,
            `Cost: about ${money(cost)} (${money(GRID_POINT_EST)} a point).`,
            last ? `Last checked ${last}; ${last === new Date().toISOString().slice(0, 10) ? "today's result is replaced" : "earlier results stay as history"}.` : "First check of this keyword at this size; one result per keyword per day is kept as history.",
            `Takes ${seconds(secs)}.`,
            ...gate.lines,
          ]),
          input: { kind: a.kind, keyword: kw, grid_size: a.grid_size, spacing_km: a.spacing_km },
          ...wait(secs),
        };
      }
      case "competitor_profiles": {
        const list = [...new Set((a.businesses ?? []).map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 3);
        if (!list.length) return { error: "Name up to 3 competing businesses as they appear on Google Maps." };
        const self = await latest<Profile | null>(ctx.admin, id, "gbp_profile", "self");
        const also = self?.data?.alsoSearch ?? [];
        const each = PROFILE_EST + REVIEWS_EST * 0.5, cost = list.length * each;
        const gate = await budgetCheck(ctx.admin, id, cost, PROFILE_EST);
        if ("error" in gate) return gate;
        const secs = 3 + list.length * 4;
        return {
          title: `Compare ${plural(list.length, "competing business", "competing businesses")} on Google (≈${money(cost)})`,
          detail: bullets([
            ...list.map((n) => `${n}: ${also.some((x) => x.title.toLowerCase() === n.toLowerCase()) ? "the exact listing from \"people also search\"" : "matched to a map-grid listing of the same name, else searched by name near the business"}`),
            `For each: the Business Profile (about ${money(PROFILE_EST)}) and a collection of its newest 50 reviews (about ${money(REVIEWS_EST * 0.5)}), which arrive within a few minutes. A name Google can't find still costs the profile lookup.`,
            "Replaces any stored data for these businesses.",
            `Takes ${seconds(secs)}.`,
            ...gate.lines,
          ]),
          input: { kind: a.kind, businesses: list },
          ...wait(secs),
        };
      }
    }
  },
  async execute(_x, a): Promise<ExecResult> {
    const paths = ["/local-seo"];
    switch (a.kind) {
      case "profile_reviews": { const r = await refreshLocal(); return r.ok ? { ok: true, message: `${r.message} Ask me to look at them in a few minutes.`, paths } : { ok: false, message: r.error }; }
      case "posts": { const r = await refreshPosts(); return r.ok ? { ok: true, message: `${r.message} Ask me to look at them in a few minutes.`, paths } : { ok: false, message: r.error }; }
      case "map_grid": { const r = await runMapsGrid(a.keyword ?? "", a.grid_size, a.spacing_km); return r.ok ? { ok: true, message: `Map grid for "${a.keyword}": ${r.message}`, paths } : { ok: false, message: r.error }; }
      case "competitor_profiles": return fromAction(await compareRivals((a.businesses ?? []).join("\n")), "Competitor profiles fetched.", paths);
    }
  },
});

/* ================================================================== SEO Toolkit */
const runToolkitTool = write({
  name: "run_toolkit_tool",
  description: "Run an SEO Toolkit tool: seo-page (page analysis, free), seo-content (content quality, ≈$0.005 AI), seo-content-brief (≈$0.04), seo-cluster (keyword clustering, up to $0.024), seo-sxo (intent check, up to $0.016), seo-competitor-pages (comparison page outlines, under $0.01 AI), or the free site scan (seo-drift, seo-agentic, seo-images, seo-hreflang, seo-programmatic, seo-ecommerce all refresh together).",
  schema: z.object({
    tool: z.enum(RUNNABLE),
    input: z.string().trim().max(300).optional().describe("seo-page: a URL on the client's site (default: home page); seo-content: a URL (default: the top 10 blog posts); seo-content-brief: the keyword (default: the best opportunity)"),
    reset_baseline: z.boolean().default(false).describe("site scan only: make today's pages the new SEO Drift baseline"),
  }),
  async prepare(ctx, a) {
    const id = ctx.client.id, s = SPEC[a.tool];
    const t = await peekTarget(ctx.admin, id);
    if (!t) return { error: NO_SITE };
    const lines: string[] = [];
    // only the page analyzer, content quality and content brief take an input
    let input = ["seo-page", "seo-content", "seo-content-brief"].includes(a.tool) ? a.input?.trim() || undefined : undefined;
    let dfs = s.dfs, short = s.short;
    switch (a.tool) {
      case "seo-page": {
        const url = ownUrl(input ?? "", t.domain);
        if (!url) return { error: `Give a page on ${t.domain} (a full URL or a path like /services/).` };
        input = url;
        lines.push(`Analyzes ${url}: title, description, headings, content, links, schema, images, canonical/robots, stored Lighthouse scores and Search Console queries, scored with prioritized fixes.`);
        break;
      }
      case "seo-content": {
        if (input) {
          const url = ownUrl(input, t.domain);
          if (!url) return { error: `Give a page on ${t.domain}, or no input for the top 10 blog posts.` };
          input = url;
          lines.push(`Reviews ${url} for E-E-A-T, readability, thin content and AI-citation readiness.`);
        } else {
          const { count } = await ctx.admin.from("blog_posts").select("url", { count: "exact", head: true }).eq("client_id", id);
          if (!count) return { error: "No blog posts are stored yet: sync them on the Blog Content page, or give a page URL." };
          lines.push("Reviews the 10 blog posts with the most Search Console clicks (last 90 days) for E-E-A-T, readability, thin content and AI-citation readiness.");
        }
        break;
      }
      case "seo-content-brief": {
        const kw = (input ?? "").toLowerCase() || (await defaultBriefKeyword(ctx.admin, id));
        if (!kw) return { error: "Give the keyword for the brief." };
        const reuse = (await storedSerps(ctx.admin, id)).has(kw);
        if (reuse) { dfs = 0; short = "≈$0.03"; } else if (!(await dfsConfigured(ctx.client.id))) return { error: NOT_CONFIGURED };
        lines.push(`Brief for "${kw}"${input ? "" : " (the best opportunity in the stored keywords)"}: ${reuse ? "reuses the Google results another toolkit run stored (free)" : `one Google search (${money(SERP_EST)})`}, reads the top 5 ranking pages, then Claude Sonnet writes the brief (sections, word counts, keyword placement, questions, internal links).`);
        input = kw;
        break;
      }
      case "seo-cluster":
      case "seo-sxo":
        if (!(await dfsConfigured(ctx.client.id))) return { error: NOT_CONFIGURED };
        lines.push(a.tool === "seo-cluster"
          ? "Clusters the client's keywords (stored ranked keywords plus Search Console queries) by shared Google results into hub-and-spoke groups mapped to existing pages, with internal-link suggestions."
          : `Compares the page types Google ranks for the client's top ${MAX_SXO} keywords with the client's ranking page and flags intent mismatches.`);
        break;
      case "seo-competitor-pages": {
        const { count } = await ctx.admin.from("dfs_cache").select("endpoint", { count: "exact", head: true }).eq("client_id", id).eq("endpoint", "competitors");
        if (!t.competitors.length && !count) return { error: "No competitors are stored yet: run the competitor analysis or the deep dive first." };
        lines.push("Drafts \"vs\" and \"alternatives\" page outlines against the stored competitors (Claude Haiku; no DataForSEO call).");
        break;
      }
      default:
        lines.push(`One free scan of up to 25 key pages plus robots.txt and llms.txt refreshes all six site-scan tools (SEO drift, AI readiness, images, hreflang, service x area planner, e-commerce).${a.reset_baseline ? " It also resets the SEO Drift baseline: today's pages become the reference (the change log is kept)." : ""}`);
    }
    if (s.claude) {
      const b = await claudeBudget(ctx.admin, id);
      if (b.left <= 0) return { error: `The monthly Claude budget ($${b.budget}) is used up. An owner can raise it in AI Quick Wins → Settings.` };
      lines.push(`Counts toward the monthly Claude budget (${usd(b.left)} of ${usd(b.budget)} left).`);
    }
    let gateLines: string[] = [];
    if (dfs > 0) {
      const g = await budgetCheck(ctx.admin, id, dfs, s.dfsStep);
      if ("error" in g) return g;
      gateLines = g.lines;
    }
    const { data: prev } = await ctx.admin.from("dfs_cache").select("fetched_at").eq("client_id", id).eq("endpoint", `tk_${a.tool}`).maybeSingle();
    return {
      title: `Run ${toolTitle(a.tool)}${input ? (a.tool === "seo-content-brief" ? ` for "${input}"` : ` on ${input}`) : ""} (${short})`,
      detail: bullets([
        ...lines,
        `Cost: ${a.tool === "seo-content-brief" && !dfs ? "about $0.03 (Claude Sonnet; the Google results are reused)" : s.cost}.`,
        `Replaces the stored result${prev ? ` from ${day(prev.fetched_at as string)}` : ""}.`,
        `Takes ${s.wait}.`,
        ...gateLines, ...extras(t),
      ]),
      input: { tool: a.tool, input, reset_baseline: isScan(a.tool) ? a.reset_baseline : false },
      ...wait(s.seconds),
    };
  },
  async execute(_x, a) {
    if (isScan(a.tool)) return fromAction(await runSiteScanNow(a.reset_baseline), "Site scan finished.", [...SCAN_SLUGS.map((s) => `/toolkit/${s}`), "/toolkit"]);
    return fromAction(await runToolkit(a.tool, a.input ?? ""), `${toolTitle(a.tool)} finished.`, [`/toolkit/${a.tool}`, "/toolkit"]);
  },
});

/* ================================================================== DataForSEO settings */
const updateDfsSettings = write({
  name: "update_dataforseo_settings",
  description: "Change the organization's DataForSEO daily spending limit ($0.10-$100 a day, shared by all its clients) and/or the automatic weekly refresh switch. Organization owners and admins.",
  schema: z.object({
    daily_limit: z.number().min(0.1).max(100).optional().describe("USD per day, across all clients of the organization"),
    auto_refresh: z.boolean().optional().describe("automatic weekly refresh of the research data"),
  }),
  async prepare(ctx, a) {
    if (a.daily_limit == null && a.auto_refresh == null) return { error: "Give a new daily_limit and/or auto_refresh." };
    const [cur, b] = await Promise.all([getSettings(ctx.admin, { clientId: ctx.client.id }), budgetNow(ctx.admin, ctx.client.id)]);
    const limit = a.daily_limit == null ? cur.dailyBudget : Math.round(a.daily_limit * 100) / 100;
    const auto = a.auto_refresh ?? cur.autoRefresh;
    if (limit === cur.dailyBudget && auto === cur.autoRefresh) return { error: `Nothing would change: the daily limit is already ${usd(limit)} and the automatic weekly refresh is ${auto ? "on" : "off"}.` };
    const changes = [
      ...(limit !== cur.dailyBudget ? [`set the DataForSEO daily limit to ${usd(limit)}`] : []),
      ...(auto !== cur.autoRefresh ? [`turn the automatic weekly refresh ${auto ? "on" : "off"}`] : []),
    ];
    return {
      title: `${changes.join(" and ").replace(/^./, (c) => c.toUpperCase())}`,
      detail: bullets([
        ...(limit !== cur.dailyBudget ? [`Daily limit: ${usd(cur.dailyBudget)} → ${usd(limit)}${limit === DEFAULT_DAILY_BUDGET ? " (the default)" : ""}. It covers all clients of the organization together (they share its DataForSEO account): scheduled refreshes may use up to ${usd(limit * AUTO_SHARE)} of it and one client at most ${usd(limit * PER_CLIENT_SHARE)} a day.`] : []),
        ...(auto !== cur.autoRefresh ? [`Automatic weekly refresh: ${cur.autoRefresh ? "on" : "off"} → ${auto ? "on" : "off"}, for every client of the organization${auto ? "" : "; research data then only updates when someone runs a refresh"}.`] : []),
        b.all == null ? "Today's spend isn't available." : `Spent today: ${usd(b.all)} across the organization's clients. The limit resets at midnight UTC.`,
      ]),
      input: { daily_limit: a.daily_limit == null ? undefined : limit, auto_refresh: a.auto_refresh },
    };
  },
  async execute(x, a) {
    const orgId = await clientOrgId(x.client.id);
    const cur = await getSettings(x.admin, { orgId });
    const limit = a.daily_limit ?? cur.dailyBudget, auto = a.auto_refresh ?? cur.autoRefresh;
    const r = await saveDfsSettings({ dailyBudget: limit, autoRefresh: auto }, orgId);
    return r.ok ? { ok: true, message: `Saved: DataForSEO daily limit ${usd(limit)}, automatic weekly refresh ${auto ? "on" : "off"}.`, paths: ["/integrations"] } : { ok: false, message: r.error };
  },
});

export const writeTools: NovaTool[] = [runSeoResearch, runKeywordResearch, startSiteAudit, runSiteChecks, runLocalSeo, runToolkitTool, updateDfsSettings, syncSeoSignalx];
