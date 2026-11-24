import "server-only";
import type { Profile } from "@/lib/dataforseo/local";
import type { G as Ga4G } from "@/lib/ga4x/g";
import { SCREEN_TYPES, type QuickWin } from "@/lib/ga4x/quickwins";
import { pageTable, queryPages } from "@/lib/gscx/analysis";
import type { G as GscG } from "@/lib/gscx/g";
import type { InventoryRow } from "@/lib/gscx/inventory";
import { benchmarkCtr, pathOf } from "@/lib/gscx/model";
import { GSC_SCREEN_TYPES, type GscWin } from "@/lib/gscx/quickwins";
import type { GapRow, KwData, LinkGapRow, SerpData } from "./dfs";
import type { AiQwSettings } from "./settings";
import type { CandQuery, Candidate, Fact, PageContext, Scope, Source } from "./types";

/**
 * Candidate builder: pure code, no AI. Runs the Search Console and GA4 quick-win rules, adds the DataForSEO and crawl
 * rules below, and turns each opportunity into a Candidate whose every number comes from API data. Claude later
 * chooses, prioritises and writes; it may quote only what is in a candidate.
 */
export const NEW_PAGE = "(new page)", SITE_WIDE = "(site-wide)", GBP = "(Google Business Profile)", OFFSITE = "(other websites: backlinks)";
/** One metro area's share of US searches (Houston ≈ 7 million of 335 million people). */
export const LOCAL_SHARE = 0.02;
const GENERIC = /^(near|me|best|cheap|top|local|company|companies|business|businesses|store|stores|shop|shops|service|services|custom|cost|price|prices|the|and|for|how|what|with)$/;
export const SENTINELS = [NEW_PAGE, SITE_WIDE, GBP, OFFSITE];

/** A lead is weighted as 10 clicks when clicks-based and lead-based wins share one list. */
export const LEAD_WEIGHT = 10;
export const weightedGain = (c: Pick<Candidate, "computed_gain" | "gain_unit">) => c.computed_gain * (c.gain_unit === "leads/mo" ? LEAD_WEIGHT : 1);

export { RULE_LABEL, ruleLabel } from "./labels";

const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ");
const r1 = (v: number) => Math.round(v * 10) / 10;
const toNum = (s: string | number) => { if (typeof s === "number") return s; const v = Number(String(s).replace(/[,%$\s]/g, "")); return Number.isFinite(v) ? (String(s).includes("%") ? v / 100 : v) : null; };

export interface BuildInput {
  settings: AiQwSettings;
  sources: Source[];
  gsc: { g: GscG; wins: GscWin[]; inv: InventoryRow[] } | null;
  ga4: { g: Ga4G; wins: QuickWin[] } | null;
  kw: Map<string, KwData>;
  serp: Map<string, SerpData>;
  gaps: { kw: GapRow[]; links: LinkGapRow[]; competitors: string[] };
  local: { self: Profile | null; rivals: Profile[] };
  /** candidates from the other sources (Business Profile, Bing, Clarity, social, SEOSignalX), built in platforms.ts */
  extra?: Candidate[];
}

export interface BuildResult { all: Candidate[]; perRule: Record<string, number>; inventory: Set<string> }

export function pageContextFor(inv: InventoryRow[], path: string, linksIn?: Map<string, number>): PageContext | null {
  const row = inv.find((r) => pathOf(r.url) === path);
  const c = row?.crawl;
  if (!row || !c) return null;
  return { title: c.title, h1: c.h1, h2s: c.headings.slice(0, 12), word_count: c.words, internal_links_in: linksIn?.get(row.url) ?? null, schema_types: c.schema.slice(0, 8) };
}

export function buildCandidates(inp: BuildInput): BuildResult {
  const out: Candidate[] = [];
  const ids = new Set<string>();
  const on = (s: Source) => inp.sources.includes(s);
  const push = (c: Candidate) => {
    if (ids.has(c.candidate_id) || !(c.computed_gain > 0)) return;
    ids.add(c.candidate_id);
    c.computed_gain = Math.max(0.1, r1(c.computed_gain));
    out.push(c);
  };
  const inv = inp.gsc?.inv ?? [];
  const linksIn = inp.gsc?.g.linksIn;
  const ctx = (path: string) => pageContextFor(inv, path, linksIn);
  const kwOf = (q: string) => inp.kw.get(norm(q));
  const enrich = (q: CandQuery): CandQuery => {
    const k = kwOf(q.query);
    const s = inp.serp.get(norm(q.query));
    return { ...q, ...(k?.volume != null ? { search_volume: k.volume } : {}), ...(k?.difficulty != null ? { difficulty: k.difficulty } : {}), ...((s?.features.length || k?.serp.length) ? { serp_features: s?.features ?? k!.serp } : {}) };
  };

  // URL inventory: every page the data knows (crawl, sitemaps, Search Console, GA4) plus the sentinels
  const inventory = new Set<string>([...SENTINELS, ...inv.map((r) => pathOf(r.url))]);
  if (inp.gsc) for (const [p] of inp.gsc.g.pages()) inventory.add(pathOf(p));

  /* -------------------------------------------------- Search Console rules */
  const gscScreens = (type: string) => Object.entries(GSC_SCREEN_TYPES).filter(([, t]) => t === "*" || t.includes(type)).map(([s]) => `gsc:${s}`);
  if (inp.gsc && on("gsc")) {
    for (const w of inp.gsc.wins) {
      const qi = w.table?.cols.indexOf("Query") ?? -1, ii = w.table?.cols.indexOf("Impr.") ?? -1, pi = w.table?.cols.indexOf("Pos") ?? -1, ci = w.table?.cols.indexOf("CTR") ?? -1;
      const queries: CandQuery[] = qi >= 0 ? (w.table!.rows.map((r) => ({ query: String(r[qi]), ...(ii >= 0 ? { impressions: toNum(r[ii]) ?? undefined } : {}), ...(pi >= 0 ? { position: toNum(r[pi]) ?? undefined } : {}), ...(ci >= 0 ? { ctr: toNum(r[ci]) ?? undefined } : {}) })) as CandQuery[]).map(enrich) : [];
      const facts: Fact[] = (w.evidence ?? []).map(([name, value]) => ({ name, value, source: "gsc" as Source }));
      if (w.table && qi < 0) w.table.rows.slice(0, 10).forEach((r, i) => facts.push({ name: `Row ${i + 1} (${w.table!.cols.join(" | ")})`, value: r.join(" | "), source: "gsc" }));
      facts.push({ name: "Finding", value: w.why, source: "gsc" });
      push({
        candidate_id: `gsc:${w.key}`, rule: `gsc:${w.type}`, page_url: /^(\/|https?:\/\/|[a-z0-9-]+\.[a-z])/i.test(w.page ?? "") ? w.page : SITE_WIDE, scope_screens: gscScreens(w.type), facts, queries, page_context: w.page ? ctx(w.page) : null,
        computed_gain: w.gain, gain_unit: "clicks/mo", effort_hint: w.effort, sources: queries.some((q) => q.search_volume != null) ? ["gsc", "crawl", "dataforseo"] : ["gsc", "crawl"],
        draft: { title: w.title, where: w.where, steps: w.steps, suggest: w.suggest, measure: w.measure },
      });
    }
  }

  /* -------------------------------------------------- GA4 rules */
  const ga4Screens = (type: string) => Object.entries(SCREEN_TYPES).filter(([, t]) => t === "*" || (t as string[]).includes(type)).map(([s]) => `ga4:${s}`);
  if (inp.ga4 && on("ga4")) {
    for (const w of inp.ga4.wins) {
      const page = w.page && w.page.startsWith("/") ? w.page : w.page ? w.page : SITE_WIDE;
      if (page.startsWith("/")) inventory.add(page);
      push({
        candidate_id: `ga4:${w.key}`, rule: `ga4:${w.type}`, page_url: page, scope_screens: ga4Screens(w.type),
        facts: [...(w.evidence ?? []).map(([name, value]) => ({ name, value, source: "ga4" as Source })), { name: "Finding", value: w.why, source: "ga4" }],
        queries: [], page_context: page.startsWith("/") ? ctx(page) : null, computed_gain: w.gain, gain_unit: "leads/mo", effort_hint: w.effort, sources: ["ga4"],
        draft: { title: w.title, where: w.where, steps: w.steps, suggest: w.suggest, measure: w.measure },
      });
    }
  }

  /* -------------------------------------------------- DataForSEO rules */
  const g = inp.gsc?.g;
  // DataForSEO volumes are national. A local business only gets the searches made in its own area: a search that
  // names its city counts in full, any other at about 2% (one metro area's share of US searches).
  const cities = (g?.settings.cities ?? []).map((c) => c.toLowerCase().trim()).filter((c) => c.length > 2);
  const localBiz = Boolean(inp.local.self) || cities.length > 0;
  const geoShare = (q: string) => (!localBiz || cities.some((c) => q.toLowerCase().includes(c)) ? 1 : LOCAL_SHARE);
  const shareFact = (q: string): Fact => ({ name: "Share of the searches in the service area (estimate)", value: geoShare(q) === 1 ? (localBiz ? "100% (the search names the city)" : "100%") : "2% (one metro area's share of US searches)", source: "dataforseo" });
  // what the business does: its services and Business Profile categories and services (generic words don't count)
  const sing = (w: string) => w.replace(/ies$/, "y").replace(/s$/, "");
  const serviceWords = new Set([...(g?.settings.services ?? []), inp.local.self?.category ?? "", ...(inp.local.self?.additional ?? []), ...(inp.local.self?.services ?? [])]
    .flatMap((x) => x.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3 && !GENERIC.test(w)).map(sing));
  const aboutServices = (q: string) => !serviceWords.size || q.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 3 && !GENERIC.test(w) && serviceWords.has(sing(w)));
  const ourQ = g ? g.queries() : new Map();
  const ourPrevQ = g ? g.queries(true) : new Map();
  const qps = g ? queryPages(g) : [];
  const topPageOf = (q: string) => qps.filter((r) => r.query === q).sort((a, b) => b.impressions - a.impressions)[0]?.page ?? null;
  const f30 = g ? 30 / g.p.days : 1;
  if (on("dataforseo") && inp.settings.dfs.competitors) {
    // keyword gap: competitors rank for it, real demand, not too hard, and we have no page in the top 30
    const byKw = new Map<string, GapRow[]>();
    for (const r of inp.gaps.kw) if ((r.volume ?? 0) >= 50 && (r.difficulty == null || r.difficulty <= 40)) {
      const mine = ourQ.get(r.keyword);
      if (mine && mine.pos != null && mine.pos <= 30) continue;
      byKw.set(r.keyword, [...(byKw.get(r.keyword) ?? []), r]);
    }
    // only keywords that share a meaningful word with what the site already gets found for (the business's own field)
    const vocab = new Set([...ourQ.keys()].flatMap((q: string) => q.split(/[^a-z0-9]+/)).filter((w) => w.length >= 4 && !/^(near|best|cost|price|prices|much|does|what|with|from|your|this|that|company|companies|services?)$/.test(w)));
    const relevant = (kw: string) => !vocab.size || kw.split(/[^a-z0-9]+/).some((w) => vocab.has(w));
    const gapList = [...byKw].filter(([kw]) => relevant(kw)).sort((a, b) => (b[1][0].volume ?? 0) - (a[1][0].volume ?? 0)).slice(0, 25);
    for (const [kw, rows] of gapList) {
      const v = rows[0].volume ?? 0;
      // DataForSEO's estimate of the monthly visits the best-placed competitor page gets from this keyword
      const best = [...rows].sort((a, b) => (b.their_traffic ?? 0) - (a.their_traffic ?? 0))[0];
      const localShare = geoShare(kw);
      const cap = v * benchmarkCtr(5) * localShare;
      const etv = Math.min(best.their_traffic ?? 0, cap);
      if (etv < 0.5) continue;
      push({
        candidate_id: `dfs_keyword_gap:${kw}`, rule: "dfs_keyword_gap", page_url: NEW_PAGE, scope_screens: ["gsc:opps", "gsc:queries", "dfs:keywords"],
        facts: [
          { name: "Monthly searches (DataForSEO)", value: v, source: "dataforseo" },
          { name: "Keyword difficulty (0-100)", value: rows[0].difficulty ?? "unknown", source: "dataforseo" },
          { name: "Search intent", value: rows[0].intent ?? "unknown", source: "dataforseo" },
          ...rows.slice(0, 3).map((r) => ({ name: `${r.competitor} ranks`, value: `position ${r.their_position ?? "?"} with ${r.their_url ?? "?"}`, source: "dataforseo" as Source })),
          { name: "Our best position (Search Console, 28 days)", value: ourQ.get(kw)?.pos != null ? r1(ourQ.get(kw)!.pos!) : "not ranking in the top 30", source: "gsc" },
          { name: `Estimated monthly visits ${best.competitor} gets from it (DataForSEO)`, value: r1(etv), source: "dataforseo" },
          shareFact(kw),
          { name: "Gain basis (estimate)", value: "the lower of the competitor's visits and the searches in the service area × 5.5% CTR at position 5", source: "dataforseo" },
        ],
        queries: [enrich({ query: kw })], page_context: null, computed_gain: etv, gain_unit: "clicks/mo", effort_hint: "High", sources: ["dataforseo", "gsc"],
        draft: { title: `Create a page (or a new section) for "${kw}"`, where: "New page", steps: ["Check which existing page is closest; add a section there if it fits, else create a new page.", `Use "${kw}" in the title, H1 and first paragraph.`, "Link to it from the closest service page."] },
      });
    }
  }
  if (g && on("dataforseo") && on("gsc") && inp.settings.dfs.volume) {
    for (const [q, m] of ourQ) {
      const k = kwOf(q);
      if (!k || m.pos == null) continue;
      const imp30 = m.impressions * f30, page = topPageOf(q);
      if (!page) continue;
      const path = pathOf(page);
      // volume-weighted striking distance: low impressions in Search Console, but real searches per DataForSEO
      if (m.pos >= 8 && m.pos <= 20 && imp30 < 100 && (k.volume ?? 0) >= 100 && !g.isBrand(q)) {
        const gain = (k.volume ?? 0) * geoShare(q) * Math.max(0, benchmarkCtr(3) - benchmarkCtr(m.pos));
        push({
          candidate_id: `dfs_striking_volume:${path}|${q}`, rule: "dfs_striking_volume", page_url: path, scope_screens: ["gsc:queries", "gsc:opps", "dfs:keywords"],
          facts: [
            { name: "Average position (28 days)", value: r1(m.pos), source: "gsc" }, { name: "Impressions (28 days)", value: m.impressions, source: "gsc" },
            { name: "Monthly searches (DataForSEO)", value: k.volume ?? 0, source: "dataforseo" }, { name: "Keyword difficulty", value: k.difficulty ?? "unknown", source: "dataforseo" },
            shareFact(q),
            { name: "Gain basis (estimate)", value: "searches in the service area × (10% CTR at position 3 − CTR at the current position)", source: "dataforseo" },
          ],
          queries: [enrich({ query: q, impressions: m.impressions, clicks: m.clicks, position: r1(m.pos), ctr: m.ctr })], page_context: ctx(path),
          computed_gain: gain, gain_unit: "clicks/mo", effort_hint: "Medium", sources: ["gsc", "dataforseo", "crawl"],
          draft: { title: `Push ${path} into the top 3 for "${q}"`, where: "Title tag, H1, a new H2 section and internal links", steps: [`Add "${q}" to the title and H1.`, "Add a section that answers it fully.", "Link to the page from 2–3 related pages."] },
        });
      }
      const serp = inp.serp.get(norm(q));
      const features = serp?.features ?? k.serp;
      // SERP feature win: we're on page one and there's a featured snippet or People Also Ask box we don't hold
      if (m.pos <= 10 && (features.includes("featured_snippet") || features.includes("people_also_ask")) && imp30 >= 30) {
        const holds = serp?.ourUrl && features.includes("featured_snippet") && serp.ourPosition === 1;
        if (!holds) push({
          candidate_id: `dfs_serp_feature:${path}|${q}`, rule: "dfs_serp_feature", page_url: path, scope_screens: ["gsc:ai", "gsc:segments", "dfs:keywords"],
          facts: [
            { name: "Average position (28 days)", value: r1(m.pos), source: "gsc" }, { name: "Impressions (28 days)", value: m.impressions, source: "gsc" },
            { name: "SERP features on Google", value: features.join(", "), source: "dataforseo" },
            ...(serp?.paa.length ? [{ name: "People Also Ask questions", value: serp.paa.join(" | "), source: "dataforseo" as Source }] : []),
            { name: "Gain basis (estimate)", value: "monthly impressions × 4% extra CTR from holding the box", source: "dataforseo" },
          ],
          queries: [enrich({ query: q, impressions: m.impressions, clicks: m.clicks, position: r1(m.pos), ctr: m.ctr })], page_context: ctx(path),
          computed_gain: imp30 * 0.04, gain_unit: "clicks/mo", effort_hint: "Low", sources: ["gsc", "dataforseo", "crawl"],
          draft: { title: `Answer "${q}" in snippet format on ${path}`, where: "New H2 with a 40–60 word answer right below it", steps: ["Add an H2 phrased as the question.", "Answer it in 40–60 words directly under the H2.", "Add the related questions as a short FAQ."] },
        });
      }
      // AI Overview present and our CTR fell
      const prev = ourPrevQ.get(q);
      if ((serp?.aiOverview || features.includes("ai_overview")) && prev && prev.impressions >= 50 && m.impressions >= 50 && m.ctr < prev.ctr * 0.8) {
        push({
          candidate_id: `dfs_ai_overview:${path}|${q}`, rule: "dfs_ai_overview", page_url: path, scope_screens: ["gsc:ai", "gsc:alerts", "dfs:keywords"],
          facts: [
            { name: "CTR now (28 days)", value: `${(m.ctr * 100).toFixed(1)}%`, source: "gsc" }, { name: "CTR previous 28 days", value: `${(prev.ctr * 100).toFixed(1)}%`, source: "gsc" },
            { name: "Impressions (28 days)", value: m.impressions, source: "gsc" }, { name: "Google shows an AI Overview", value: "yes", source: "dataforseo" },
          ],
          queries: [enrich({ query: q, impressions: m.impressions, clicks: m.clicks, position: r1(m.pos), ctr: m.ctr })], page_context: ctx(path),
          computed_gain: imp30 * (prev.ctr - m.ctr), gain_unit: "clicks/mo", effort_hint: "Medium", sources: ["gsc", "dataforseo", "crawl"],
          draft: { title: `Make ${path} the source AI Overviews cite for "${q}"`, where: "First paragraph, a facts box and /llms.txt", steps: ["Open the page with a 2–3 sentence direct answer.", "Add a short list of concrete, checkable facts.", "List the page in /llms.txt."] },
        });
      }
    }
  }
  if (g && on("dataforseo") && inp.settings.dfs.local) {
    // local pack: local-intent searches about the business's services show a map pack
    const local = [...ourQ].filter(([q]) => (/near me/.test(q) || cities.some((c) => q.includes(c))) && aboutServices(q))
      .map(([q, m]) => ({ q, m, k: kwOf(q), s: inp.serp.get(norm(q)) }))
      .filter((x) => (x.s?.features ?? x.k?.serp ?? []).includes("local_pack") && !(x.s?.localPack ?? []).some((n) => inp.local.self?.title && n.toLowerCase().includes(inp.local.self.title.toLowerCase())))
      .sort((a, b) => (b.k?.volume ?? b.m.impressions) - (a.k?.volume ?? a.m.impressions)).slice(0, 10);
    if (local.length) {
      const vol = local.reduce((a, x) => a + (x.k?.volume != null ? x.k.volume * geoShare(x.q) : x.m.impressions * f30), 0);
      const p = inp.local.self;
      push({
        candidate_id: "dfs_local_pack:gbp", rule: "dfs_local_pack", page_url: GBP, scope_screens: ["gsc:local", "dfs:keywords"],
        facts: [
          { name: "Local searches showing a map pack", value: local.length, source: "dataforseo" },
          { name: "Their monthly searches in the service area combined (estimate)", value: Math.round(vol), source: "dataforseo" },
          ...(p ? [{ name: "Business Profile category", value: p.category ?? "unknown", source: "dataforseo" as Source }, { name: "Additional categories", value: p.additional.join(", ") || "none", source: "dataforseo" as Source }, { name: "Photos", value: p.photos ?? "unknown", source: "dataforseo" as Source }, { name: "Rating", value: p.rating ?? "unknown", source: "dataforseo" as Source }, { name: "Reviews", value: p.votes ?? "unknown", source: "dataforseo" as Source }, { name: "Services listed", value: p.services.length, source: "dataforseo" as Source }] : []),
          { name: "Gain basis (estimate)", value: "searches in the service area (a search naming the city in full, others at 2%) × 5% for a map-pack listing", source: "dataforseo" },
        ],
        queries: local.map((x) => enrich({ query: x.q, impressions: x.m.impressions, clicks: x.m.clicks, position: x.m.pos != null ? r1(x.m.pos) : undefined })), page_context: null,
        computed_gain: vol * 0.05, gain_unit: "clicks/mo", effort_hint: "Medium", sources: ["dataforseo", "gsc"],
        draft: { title: "Strengthen the Google Business Profile for map-pack searches", where: "Google Business Profile", steps: ["Check the primary and additional categories match the searches.", "Add recent photos.", "List every service.", "Ask recent customers for reviews."] },
      });
    }
    // reviews below the top local competitors
    const p = inp.local.self;
    const rivals = inp.local.rivals.filter((r) => r.votes != null).sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0)).slice(0, 3);
    if (p && p.votes != null && rivals.length) {
      const med = rivals.map((r) => r.votes!).sort((a, b) => a - b)[Math.floor(rivals.length / 2)];
      const bestRating = Math.max(...rivals.map((r) => r.rating ?? 0));
      if (p.votes < med || (p.rating ?? 5) < bestRating) {
        push({
          candidate_id: "dfs_reviews:gbp", rule: "dfs_reviews", page_url: GBP, scope_screens: ["gsc:local", "gsc:brand"],
          facts: [
            { name: "Our rating", value: p.rating ?? "unknown", source: "dataforseo" }, { name: "Our review count", value: p.votes, source: "dataforseo" },
            ...rivals.map((r) => ({ name: `${r.title ?? "Competitor"} rating / reviews`, value: `${r.rating ?? "?"} / ${r.votes}`, source: "dataforseo" as Source })),
            { name: "Median review count of the top 3 competitors", value: med, source: "dataforseo" },
            ...(p.topics.length ? [{ name: "What reviewers mention (topic: reviews)", value: p.topics.slice(0, 8).map((t) => `${t.topic}: ${t.count}`).join(", "), source: "dataforseo" as Source }] : []),
            { name: "Gain basis (estimate)", value: "0.1 click a month per review short of the competitor median", source: "dataforseo" },
          ],
          queries: [], page_context: null, computed_gain: Math.max(0.5, (med - p.votes) * 0.1), gain_unit: "clicks/mo", effort_hint: "Medium", sources: ["dataforseo"],
          draft: { title: "Close the review gap with the top local competitors", where: "Google Business Profile", steps: ["Ask every customer from the last 90 days for a review, with a direct link.", "Reply to every review.", "Address recurring complaints on the matching service page."] },
        });
      }
    }
  }
  if (on("dataforseo") && inp.settings.dfs.backlinks) {
    // backlink gap: sites linking to 2+ competitors but not us
    const list = inp.gaps.links.filter((l) => l.competitors.length >= 2 && (l.spam ?? 0) < 30).sort((a, b) => b.competitors.length - a.competitors.length || (b.rank ?? 0) - (a.rank ?? 0)).slice(0, 20);
    if (list.length) push({
      candidate_id: "dfs_backlink_gap:site", rule: "dfs_backlink_gap", page_url: OFFSITE, scope_screens: ["dfs:backlinks"],
      facts: [
        { name: "Referring domains that link to 2+ competitors but not to us", value: list.length, source: "dataforseo" },
        ...list.map((l) => ({ name: l.domain, value: `links to ${l.competitors.join(", ")} · domain rank ${l.rank ?? "?"}`, source: "dataforseo" as Source })),
        { name: "Gain basis (estimate)", value: "0.5 click a month per new relevant referring domain", source: "dataforseo" },
      ],
      queries: [], page_context: null, computed_gain: list.length * 0.5, gain_unit: "clicks/mo", effort_hint: "High", sources: ["dataforseo"],
      draft: { title: "Get listed on the sites that link to your competitors", where: "Other websites (outreach)", steps: ["Sort the list into directories, associations, suppliers and news.", "Claim the directory listings first.", "Email the rest with a specific reason to link."] },
    });
  }

  /* -------------------------------------------------- crawl rules (portal crawler) */
  if (on("crawl") && inv.length) {
    const pages30 = g ? new Map([...g.pages()].map(([p, m]) => [pathOf(p), m.impressions * f30])) : new Map<string, number>();
    const imp = (path: string) => pages30.get(path) ?? 0;
    const crawled = inv.filter((r) => r.crawl && (r.crawl.status ?? 200) < 300);
    const issue = (rule: string, rows: InventoryRow[], title: string, where: string, steps: string[], perPage: number, effort: "Low" | "Medium" | "High", screens: string[], detail: (r: InventoryRow) => string) => {
      if (!rows.length) return;
      const top = [...rows].sort((a, b) => imp(pathOf(b.url)) - imp(pathOf(a.url))).slice(0, 12);
      push({
        candidate_id: `${rule}:site`, rule, page_url: top.length === 1 ? pathOf(top[0].url) : SITE_WIDE, scope_screens: screens,
        facts: [{ name: "Pages affected", value: rows.length, source: "crawl" }, ...top.map((r) => ({ name: pathOf(r.url), value: `${detail(r)} · ${Math.round(imp(pathOf(r.url)))} impressions/mo`, source: "crawl" as Source })),
          { name: "Gain basis (estimate)", value: `monthly impressions of the affected pages × ${(perPage * 100).toFixed(1)}%`, source: "crawl" }],
        queries: [], page_context: top.length === 1 ? ctx(pathOf(top[0].url)) : null,
        computed_gain: Math.max(0.2, rows.reduce((a, r) => a + imp(pathOf(r.url)), 0) * perPage), gain_unit: "clicks/mo", effort_hint: effort, sources: g ? ["crawl", "gsc"] : ["crawl"],
        draft: { title, where, steps },
      });
    };
    const byTitle = new Map<string, InventoryRow[]>();
    for (const r of crawled) if (r.crawl?.title) byTitle.set(r.crawl.title.trim().toLowerCase(), [...(byTitle.get(r.crawl.title.trim().toLowerCase()) ?? []), r]);
    issue("crawl_duplicate_title", [...byTitle.values()].filter((v) => v.length > 1).flat(), "Give every page its own title", "Title tag", ["Write a unique 50–60 character title per page.", "Lead with what the page is about."], 0.004, "Low", ["gsc:pages", "gsc:indexing"], (r) => `title "${r.crawl!.title}"`);
    issue("crawl_missing_meta", crawled.filter((r) => !r.crawl?.desc), "Add meta descriptions to pages that have none", "Meta description", ["Write a 140–160 character description per page.", "Include the main query and a reason to click."], 0.003, "Low", ["gsc:pages"], () => "no meta description");
    issue("crawl_missing_h1", crawled.filter((r) => !r.crawl?.h1), "Add an H1 to pages that have none", "H1", ["Add one H1 that matches the title's topic."], 0.002, "Low", ["gsc:pages", "gsc:indexing"], () => "no H1");
    issue("crawl_slow", crawled.filter((r) => (r.crawl?.ms ?? 0) > 3000), "Speed up the slowest pages", "Page speed (server response, images, scripts)", ["Compress and lazy-load images.", "Remove unused scripts.", "Check server response time and caching."], 0.01, "Medium", ["gsc:pages", "ga4:tech"], (r) => `${r.crawl!.ms} ms to load`);
    const broken = new Set(inv.filter((r) => (r.crawl?.status ?? 0) >= 400).map((r) => r.url));
    issue("crawl_broken_links", crawled.filter((r) => r.crawl!.links.some((l) => broken.has(l))), "Fix internal links that point to broken pages", "Body links (internal)", ["Update each link to the live page or remove it.", "Redirect the broken URL if it had traffic."], 0.003, "Low", ["gsc:indexing", "gsc:pages"],
      (r) => `links to ${r.crawl!.links.filter((l) => broken.has(l)).map((l) => pathOf(l)).slice(0, 3).join(", ")}`);
  }

  for (const c of inp.extra ?? []) { if (c.page_url.startsWith("/")) inventory.add(c.page_url); push(c); }

  const perRule: Record<string, number> = {};
  for (const c of out) perRule[c.rule] = (perRule[c.rule] ?? 0) + 1;
  return { all: out, perRule, inventory };
}

/** The candidates one run sends to Claude: top 150 for the whole site, 40 for a screen, everything for one page. */
export function pickForScope(all: Candidate[], scope: Scope): Candidate[] {
  const ranked = [...all].sort((a, b) => weightedGain(b) - weightedGain(a));
  if (scope.kind === "screen") return ranked.filter((c) => c.scope_screens.includes(scope.screen)).slice(0, 40);
  if (scope.kind === "page") return ranked.filter((c) => c.page_url === scope.url);
  if (scope.kind === "item") return ranked.filter((c) => c.candidate_id === scope.key);
  return ranked.slice(0, 150);
}

/** Baseline metrics of a candidate's page and queries, kept to compare 28 days after "done". */
export function baselineFor(c: Candidate, gsc: GscG | null): { clicks?: number; impressions?: number; ctr?: number; position?: number; leads?: number; at: string } {
  const at = new Date().toISOString();
  if (c.gain_unit === "leads/mo") {
    const leads = c.facts.find((f) => /^leads/i.test(f.name));
    return { leads: leads ? toNum(leads.value) ?? undefined : undefined, at };
  }
  if (gsc && c.page_url.startsWith("/")) {
    const row = pageTable(gsc).find((p) => pathOf(p.page) === c.page_url);
    if (row) return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: r1(row.pos), at };
  }
  const q = c.queries[0];
  return q ? { clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: q.position, at } : { at };
}

