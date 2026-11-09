import type { AuditResult } from "@/lib/dataforseo/audit";
import type { CruxRun, LhRow, LhRun } from "@/lib/dataforseo/lighthouse";
import type { TechChecks, TechPage } from "./checks";

/**
 * Technical SEO score: transparent and deterministic (no AI). Every category starts at 100 and each failed
 * check deducts a fixed, documented number of points; the evidence for each deduction is kept with it.
 * A category with no data at all is "not measured" and the overall score is the weighted average of the
 * measured categories (weights re-balanced over those). Recommendations come from the same checks.
 *
 * Methodology adapted from claude-seo by agricidaniel (MIT License, https://github.com/AgricIDaniel/claude-seo):
 * the category split of its seo-technical skill (Crawlability, Indexability, Security, URL Structure, Mobile,
 * Core Web Vitals, Structured Data), its Critical / High / Medium / Low priority tiers, its thresholds (pages
 * within 3 clicks, max 1 redirect hop, URLs under 100 characters, LCP <= 2.5 s, CLS <= 0.1, security headers)
 * and the Images category from its seo-audit skill. On-page and Links are our own additions; weights are ours,
 * loosely following seo-audit's weighting. JS rendering, IndexNow and AI-crawler checks are not implemented.
 */
export type CatKey = "crawl" | "index" | "speed" | "onpage" | "schema" | "security" | "url" | "mobile" | "images" | "links";
export const CATEGORIES: { key: CatKey; label: string; weight: number }[] = [
  { key: "crawl", label: "Crawlability", weight: 12 },
  { key: "index", label: "Indexability", weight: 12 },
  { key: "speed", label: "Core Web Vitals & speed", weight: 14 },
  { key: "onpage", label: "On-page", weight: 15 },
  { key: "schema", label: "Structured data", weight: 10 },
  { key: "links", label: "Links", weight: 10 },
  { key: "security", label: "Security & HTTPS", weight: 8 },
  { key: "mobile", label: "Mobile & accessibility", weight: 8 },
  { key: "url", label: "URL structure", weight: 6 },
  { key: "images", label: "Images", weight: 5 },
];
export type Level = "High" | "Medium" | "Low";
export type Priority = "Critical" | Level;
export interface Check { id: string; cat: CatKey; label: string; status: "pass" | "warn" | "fail" | "na"; deduct: number; evidence: string; source: string }
export interface Rec {
  id: string; priority: Priority; cat: CatKey; category: string; impact: Level; effort: Level; problem: string; change: string;
  expected: string; pages: string[]; pageCount: number; source: string; points: number;
}
export interface CatScore { key: CatKey; label: string; weight: number; score: number | null; checks: Check[] }
export interface SpeedRow { url: string; device: "mobile" | "desktop"; performance: number | null; seo: number | null; accessibility: number | null; best_practices: number | null; lcp: number | null; tbt: number | null; cls: number | null; ttfb: number | null; at: string }
export interface TechScore { overall: number | null; categories: CatScore[]; recs: Rec[]; speed: SpeedRow[]; measuredWeight: number; summary: string[]; sources: { audit: string | null; lighthouse: string | null; checks: string | null; crux: string } }

export interface TechInput {
  audit: AuditResult | null; lighthouse: LhRun[]; crux: CruxRun | null; checks: TechChecks | null;
  bingCrawl: { crawled: number; errors: number; inIndex: number | null } | null; blogUrls: string[];
}

const path = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/" : x.pathname; } catch { return u; } };
const avg = (v: (number | null | undefined)[]) => { const n = v.filter((x): x is number => typeof x === "number"); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; };
const cap = (n: number, max: number) => Math.min(max, Math.round(n));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const norm = (u: string) => { try { const x = new URL(u); return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`.toLowerCase(); } catch { return u; } };
const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** priority from impact x effort: high impact that isn't hard = High; anything high or medium-impact easy = Medium; else Low */
const prio = (impact: Level, effort: Level): Priority => (impact === "High" && effort !== "High" ? "High" : impact === "High" || (impact === "Medium" && effort === "Low") ? "Medium" : "Low");

export function computeTechnical(inp: TechInput): TechScore {
  const { audit: a, checks: t } = inp;
  const checks: Check[] = [];
  const recs: Rec[] = [];
  const pagesOk = (t?.pages ?? []).filter((p) => p.status === 200);
  const add = (c: Check, rec?: Omit<Rec, "id" | "priority" | "cat" | "category" | "source" | "points" | "pageCount"> & { pageCount?: number; critical?: boolean }) => {
    checks.push({ ...c, deduct: c.status === "pass" || c.status === "na" ? 0 : Math.max(0, Math.round(c.deduct)) });
    if (rec && (c.status === "fail" || c.status === "warn")) recs.push({ ...rec, id: c.id, cat: c.cat, category: CATEGORIES.find((x) => x.key === c.cat)!.label, priority: rec.critical && c.status === "fail" ? "Critical" : prio(rec.impact, rec.effort), source: c.source, points: Math.round(c.deduct), pageCount: rec.pageCount ?? rec.pages.length });
  };
  const pageCheck = (id: string, cat: CatKey, label: string, bad: TechPage[], perPage: number, max: number, source: string, why: string, rec: Omit<Rec, "id" | "priority" | "cat" | "category" | "source" | "points" | "pageCount" | "pages"> & { critical?: boolean }) => {
    if (!pagesOk.length) return add({ id, cat, label, status: "na", deduct: 0, evidence: "Site checks not run yet", source });
    add({ id, cat, label, status: bad.length ? (bad.length * perPage >= max / 2 ? "fail" : "warn") : "pass", deduct: cap(bad.length * perPage, max), evidence: bad.length ? `${bad.length} of ${pagesOk.length} sampled pages ${why}` : `All ${pagesOk.length} sampled pages pass`, source }, { ...rec, pages: bad.map((p) => p.url) });
  };

  /* ------------------------------------------------------------ crawlability & indexing */
  if (t) {
    const robotsOk = t.robots.status === 200;
    add({ id: "robots", cat: "crawl", label: "robots.txt reachable", status: robotsOk ? "pass" : "warn", deduct: 5, evidence: `robots.txt returned ${t.robots.status ?? "no response"}`, source: "robots.txt" },
      { impact: "Low", effort: "Low", problem: "robots.txt is missing or unreachable.", change: "Publish a robots.txt at the site root that allows crawling and lists the XML sitemap.", expected: "Search engines find the sitemap and crawl rules reliably.", pages: [`${t.origin}/robots.txt`] });
    add({ id: "robots-block", cat: "crawl", label: "robots.txt doesn't block the whole site", status: t.robots.disallowAll ? "fail" : "pass", deduct: 40, evidence: t.robots.disallowAll ? "\"Disallow: /\" for all user agents" : `${plural(t.robots.disallows.length, "disallow rule")} for all agents${t.robots.disallows.length ? `: ${t.robots.disallows.slice(0, 4).join(", ")}` : ""}`, source: "robots.txt" },
      { critical: true, impact: "High", effort: "Low", problem: "robots.txt blocks every crawler from the whole site.", change: "Remove \"Disallow: /\" from the User-agent: * group.", expected: "Pages can be crawled and indexed again.", pages: [`${t.origin}/robots.txt`] });
    const validMaps = t.sitemaps.filter((m) => m.valid);
    add({ id: "sitemap", cat: "crawl", label: "Valid XML sitemap", status: validMaps.length && t.sitemapUrls > 0 ? "pass" : "fail", deduct: 15, evidence: validMaps.length ? `${plural(validMaps.length, "valid sitemap file")}, ${t.sitemapUrls.toLocaleString("en-US")} URLs listed` : `No valid sitemap (${t.sitemaps.map((m) => `${path(m.url)} → ${m.status ?? "no response"}`).join(", ") || "none found"})`, source: "Sitemap" },
      { impact: "High", effort: "Low", problem: "No valid XML sitemap was found.", change: "Enable the sitemap in the SEO plugin (Yoast / Rank Math: sitemap_index.xml), check it opens, and submit it in Search Console and Bing.", expected: "Faster discovery and indexing of new and updated pages.", pages: t.sitemaps.map((m) => m.url) });
    const broken = t.sitemaps.filter((m) => !m.valid);
    if (validMaps.length) add({ id: "sitemap-files", cat: "crawl", label: "All sitemap files load", status: broken.length ? "warn" : "pass", deduct: cap(broken.length * 3, 9), evidence: broken.length ? `${broken.length} sitemap file(s) failed: ${broken.map((m) => `${path(m.url)} (${m.status ?? "no response"})`).join(", ")}` : `${validMaps.length} file(s) load as valid XML`, source: "Sitemap" },
      { impact: "Medium", effort: "Low", problem: "Some sitemap files listed in the sitemap index don't load.", change: "Fix or remove the broken child sitemaps in the SEO plugin settings.", expected: "All listed URLs reach search engines.", pages: broken.map((m) => m.url) });
    add({ id: "sitemap-robots", cat: "crawl", label: "Sitemap listed in robots.txt", status: t.robots.sitemaps.length ? "pass" : "warn", deduct: 3, evidence: t.robots.sitemaps.length ? t.robots.sitemaps.join(", ") : "No Sitemap: line in robots.txt", source: "robots.txt" },
      { impact: "Low", effort: "Low", problem: "robots.txt doesn't point to the sitemap.", change: `Add "Sitemap: ${validMaps[0]?.url ?? `${t.origin}/sitemap_index.xml`}" to robots.txt.`, expected: "Every crawler (not only Google) finds the sitemap.", pages: [`${t.origin}/robots.txt`] });
    const noindexInMap = pagesOk.filter((p) => p.noindex && p.inSitemap);
    pageCheck("noindex", "crawl", "Sitemap pages are indexable (no noindex)", noindexInMap, 10, 30, "Page HTML", "are in the sitemap but carry a noindex tag", { critical: true, impact: "High", effort: "Low", problem: "Pages listed in the sitemap tell Google not to index them.", change: "Remove the noindex meta robots tag (SEO plugin → page → Advanced) or drop the page from the sitemap if it should stay hidden.", expected: "These pages can rank; the sitemap stops sending mixed signals." });
    const noCanon = pagesOk.filter((p) => !p.canonical);
    pageCheck("canonical", "index", "Canonical tag present", noCanon, 2, 10, "Page HTML", "have no canonical tag", { impact: "Medium", effort: "Low", problem: "Pages have no rel=canonical, so duplicate URL variants (parameters, trailing slash) compete.", change: "Add a self-referencing canonical to every indexable page (the SEO plugin does this when enabled).", expected: "Ranking signals consolidate on one URL per page." });
    const canonElse = pagesOk.filter((p) => p.canonical && norm(p.canonical) !== norm(p.finalUrl ?? p.url) && !p.noindex);
    pageCheck("canonical-other", "index", "Canonical points to itself", canonElse, 3, 12, "Page HTML", "point their canonical to a different URL", { impact: "Medium", effort: "Low", problem: "Pages declare a different URL as canonical, so Google may drop them from the index.", change: "Make each page's canonical point to its own final URL unless it really is a duplicate.", expected: "The intended pages stay indexed." });
    const notInMap = t.sitemapUrls > 0 ? pagesOk.filter((p) => !p.inSitemap && !p.noindex) : [];
    pageCheck("in-sitemap", "crawl", "Important pages are in the sitemap", notInMap, 1, 6, "Sitemap", "are indexable but missing from the sitemap", { impact: "Low", effort: "Low", problem: "Indexable pages are missing from the XML sitemap.", change: "Make sure these page types are included in the SEO plugin's sitemap settings.", expected: "Search engines revisit these pages when they change." });
  }
  if (a) {
    const ni = a.metrics.nonIndexable ?? 0, share = a.pages ? ni / a.pages : 0;
    add({ id: "non-indexable", cat: "index", label: "Share of crawled pages that can be indexed", status: share > 0.2 ? "fail" : share > 0.05 ? "warn" : "pass", deduct: cap(share * 50, 15), evidence: `${ni} of ${a.pages} crawled pages are non-indexable (${(share * 100).toFixed(0)}%)`, source: "Crawl" },
      { impact: "Medium", effort: "Medium", problem: `${ni} crawled pages can't be indexed (noindex, canonicalised elsewhere or blocked).`, change: "Review the non-indexable pages in the Site Audit table; keep noindex only on pages that should stay out of search (tags, thank-you pages), and stop linking to the rest.", expected: "Crawl budget goes to pages that can rank.", pages: [] });
    if (a.site.wwwRedirect !== null) add({ id: "www", cat: "index", label: "www / non-www redirect", status: a.site.wwwRedirect ? "pass" : "warn", deduct: 5, evidence: a.site.wwwRedirect ? "Both versions resolve to one host" : "The other host version doesn't redirect", source: "Crawl" },
      { impact: "Medium", effort: "Low", problem: "www and non-www versions don't redirect to one host.", change: "Add a 301 redirect from the non-preferred host to the preferred one (hosting panel or .htaccess).", expected: "No duplicate host versions in the index.", pages: [] });
  }
  if (inp.bingCrawl && inp.bingCrawl.crawled > 0) {
    const pct = (inp.bingCrawl.errors / inp.bingCrawl.crawled) * 100;
    add({ id: "bing-crawl", cat: "crawl", label: "Bing crawl errors", status: pct === 0 ? "pass" : pct < 5 ? "warn" : "fail", deduct: cap(pct * 2, 15), evidence: `${inp.bingCrawl.errors} errors in ${inp.bingCrawl.crawled.toLocaleString("en-US")} pages Bing crawled (${pct.toFixed(1)}%)`, source: "Bing" },
      { impact: "Medium", effort: "Medium", problem: "Bing hits errors when crawling the site.", change: "Open Bing Webmaster Tools → Crawl information, fix or redirect the failing URLs.", expected: "Fewer wasted crawls and more pages indexed in Bing.", pages: [] });
  }

  /* ------------------------------------------------------------ speed & Core Web Vitals (newest Lighthouse result per page/device) */
  const latest = new Map<string, LhRow & { at: string }>();
  for (const run of inp.lighthouse) for (const r of run.rows) if (!r.error && !latest.has(`${r.url}|${r.device}`)) latest.set(`${r.url}|${r.device}`, { ...r, at: run.checkedAt });
  const lh = [...latest.values()];
  const mob = lh.filter((r) => r.device === "mobile");
  const speed: SpeedRow[] = lh.map((r) => ({ url: r.url, device: r.device, performance: r.performance, seo: r.seo, accessibility: r.accessibility, best_practices: r.best_practices, lcp: r.lcp_ms, tbt: r.tbt_ms, cls: r.cls, ttfb: r.ttfb_ms, at: r.at.slice(0, 10) }));
  if (mob.length) {
    const perf = avg(mob.map((r) => r.performance));
    if (perf != null) {
      const worst = [...mob].filter((r) => r.performance != null && r.performance < 90).sort((x, y) => x.performance! - y.performance!);
      add({ id: "perf", cat: "speed", label: "Lighthouse mobile performance", status: perf >= 90 ? "pass" : perf >= 50 ? "warn" : "fail", deduct: (100 - perf) * 0.4, evidence: `Average ${Math.round(perf)}/100 across ${plural(mob.length, "page")} (${mob.map((r) => `${path(r.url)} ${r.performance ?? "—"}`).join(", ")})`, source: "Lighthouse" },
        { impact: perf < 50 ? "High" : "Medium", effort: "Medium", problem: `Mobile performance averages ${Math.round(perf)}/100.`, change: "Work through the LCP, blocking-time and server-response items below; on WordPress a caching + optimisation plugin (e.g. WP Rocket, LiteSpeed Cache) with delayed JavaScript and compressed WebP images covers most of it.", expected: "Faster pages for mobile visitors and a better page-experience signal.", pages: worst.map((r) => r.url) });
    }
    const metric = (id: string, label: string, pick: (r: LhRow) => number | null, good: number, poor: number, fmt: (v: number) => string, per: [number, number], max: number, rec: { problem: string; change: string; expected: string; effort: Level }) => {
      const vals = mob.filter((r) => pick(r) != null);
      if (!vals.length) return;
      const poorP = vals.filter((r) => pick(r)! > poor), niP = vals.filter((r) => pick(r)! > good && pick(r)! <= poor);
      const bad = [...poorP, ...niP];
      add({ id, cat: "speed", label, status: poorP.length ? "fail" : niP.length ? "warn" : "pass", deduct: cap((poorP.length * per[0] + niP.length * per[1]) / vals.length * Math.min(vals.length, 3), max), evidence: `Mobile: ${vals.map((r) => `${path(r.url)} ${fmt(pick(r)!)}`).join(", ")} (good ≤ ${fmt(good)}, poor > ${fmt(poor)})`, source: "Lighthouse" },
        { ...rec, impact: poorP.length ? "High" : "Medium", pages: bad.map((r) => r.url) });
    };
    metric("lcp", "Largest Contentful Paint (mobile)", (r) => r.lcp_ms, 2500, 4000, secs, [8, 4], 20, { effort: "Medium", problem: "The main content takes too long to appear on mobile (LCP).", change: "Serve the hero image as compressed WebP/AVIF at the displayed size, preload it (fetchpriority=\"high\"), don't lazy-load it, and remove render-blocking CSS/JS above the fold.", expected: "LCP under 2.5 s: a Core Web Vitals pass and fewer visitors bouncing while the page loads." });
    metric("tbt", "Total Blocking Time (mobile)", (r) => r.tbt_ms, 200, 600, secs, [6, 3], 15, { effort: "Medium", problem: "JavaScript blocks the page from responding (TBT, the lab stand-in for INP).", change: "Delay or remove non-essential scripts (chat widgets, sliders, unused plugin JS), defer the rest, and drop unused page-builder modules.", expected: "Pages respond to taps sooner (better INP)." });
    metric("ttfb", "Server response time (TTFB)", (r) => r.ttfb_ms, 800, 1800, secs, [6, 3], 12, { effort: "Medium", problem: "The server is slow to send the first byte.", change: "Turn on full-page caching, use a CDN (e.g. Cloudflare), and check hosting/PHP version; uncached WordPress pages are the usual cause.", expected: "Every other timing improves with it." });
    metric("cls", "Layout shift (CLS)", (r) => r.cls, 0.1, 0.25, (v) => v.toFixed(2), [6, 3], 10, { effort: "Low", problem: "Content jumps while the page loads (CLS).", change: "Give images, embeds and ad/banner slots explicit width and height, and load web fonts with font-display: swap.", expected: "A stable layout and a Core Web Vitals pass." });
  } else add({ id: "perf", cat: "speed", label: "Lighthouse mobile performance", status: "na", deduct: 0, evidence: "No Lighthouse test stored yet (Site Audit → Run Lighthouse)", source: "Lighthouse" });
  if (a) {
    const slow = a.rows.filter((p) => (p.ms ?? 0) >= 3000);
    if (a.rows.length) add({ id: "crawl-load", cat: "speed", label: "Crawl load time under 3 s", status: slow.length ? "warn" : "pass", deduct: cap((slow.length / a.rows.length) * 20, 8), evidence: slow.length ? `${slow.length} of ${a.rows.length} crawled pages took 3 s or more` : `All ${a.rows.length} crawled pages loaded in under 3 s`, source: "Crawl" },
      { impact: "Medium", effort: "Medium", problem: "Some pages load slowly in the crawl.", change: "Check these pages for very large images, sliders or embedded videos and apply the same caching/optimisation as above.", expected: "Consistent speed across the site, not only the home page.", pages: slow.map((p) => p.url) });
  }
  const cruxNote = inp.crux?.source ? `Real-user data from ${inp.crux.source === "crux_api" ? "Chrome UX Report" : "PageSpeed"} (${inp.crux.checkedAt.slice(0, 10)})` : inp.crux?.error ? `Not available: ${inp.crux.error}` : "Not fetched yet";
  add({ id: "crux", cat: "speed", label: "Real-user Core Web Vitals (Chrome UX Report)", status: "na", deduct: 0, evidence: `${cruxNote}. Shown for information; not scored because Google only publishes it for sites with enough Chrome traffic.`, source: "CrUX" });

  /* ------------------------------------------------------------ on-page */
  if (t) {
    pageCheck("title", "onpage", "Title present, 30-60 characters", pagesOk.filter((p) => !p.title || p.titleLen < 30 || p.titleLen > 60), 2, 12, "Page HTML", "have a missing, too short (< 30) or too long (> 60 chars) title", { impact: "Medium", effort: "Low", problem: "Titles are missing, too short or get cut off in results.", change: "Write a unique 30-60 character title per page: main service + location + brand (e.g. \"LED Signs in <City> | Brand\").", expected: "Higher click-through from search results." });
    pageCheck("desc", "onpage", "Meta description 70-160 characters", pagesOk.filter((p) => !p.desc || p.descLen < 70 || p.descLen > 160), 1.5, 10, "Page HTML", "have a missing or badly sized (70-160 chars) meta description", { impact: "Low", effort: "Low", problem: "Meta descriptions are missing or the wrong length, so Google writes its own snippet.", change: "Add a 120-155 character description per page with the service, location and a call to action.", expected: "Better, controlled snippets and more clicks." });
    pageCheck("h1", "onpage", "Exactly one H1", pagesOk.filter((p) => p.h1 !== 1), 1.5, 10, "Page HTML", "have no H1 or more than one", { impact: "Low", effort: "Low", problem: "Pages have no H1 or several H1 headings.", change: "Use one H1 per page that states the page topic; turn the other H1s into H2s in the page builder.", expected: "Clearer topic signals for search engines and screen readers." });
  }
  if (a) {
    const thin = a.rows.filter((p) => p.status === 200 && p.words != null && p.words < 200);
    if (a.rows.length) add({ id: "thin", cat: "index", label: "Pages with 200+ words", status: thin.length / a.rows.length > 0.2 ? "fail" : thin.length ? "warn" : "pass", deduct: cap((thin.length / a.rows.length) * 30, 15), evidence: `${thin.length} of ${a.rows.length} crawled pages have under 200 words`, source: "Crawl" },
      { impact: "Medium", effort: "High", problem: "Thin pages give Google little to rank.", change: "Expand the key service/location pages to 400+ useful words (what, where, pricing cues, FAQs, photos); noindex or merge tag/archive pages that can't be expanded.", expected: "More long-tail rankings for the expanded pages.", pages: thin.map((p) => p.url) });
    const dupT = a.metrics.duplicateTitle ?? 0, dupD = a.metrics.duplicateDescription ?? 0, dupC = a.metrics.duplicateContent ?? 0;
    add({ id: "dup-title", cat: "onpage", label: "No duplicate titles", status: dupT ? "warn" : "pass", deduct: cap(dupT * 1, 8), evidence: `${dupT} pages share a title with another page`, source: "Crawl" },
      { impact: "Medium", effort: "Low", problem: `${dupT} pages share their title with another page.`, change: "Give each page a unique title (see the Site Audit issue list for the pages).", expected: "Google can tell the pages apart and show the right one.", pages: a.issues.find((i) => i.key.includes("duplicate_title"))?.urls ?? [] });
    add({ id: "dup-desc", cat: "onpage", label: "No duplicate meta descriptions", status: dupD ? "warn" : "pass", deduct: cap(dupD * 0.5, 5), evidence: `${dupD} pages share a description`, source: "Crawl" },
      { impact: "Low", effort: "Low", problem: `${dupD} pages share their meta description.`, change: "Write unique descriptions for these pages.", expected: "Distinct snippets for each page.", pages: a.issues.find((i) => i.key.includes("duplicate_description"))?.urls ?? [] });
    add({ id: "dup-content", cat: "index", label: "No duplicate content", status: dupC ? "warn" : "pass", deduct: cap(dupC * 2, 10), evidence: `${dupC} pages have near-duplicate content`, source: "Crawl" },
      { impact: "Medium", effort: "Medium", problem: `${dupC} pages are near-duplicates of each other.`, change: "Merge the duplicates (301 to the best one) or rewrite them with unique, location- or product-specific content; add canonicals where variants must stay.", expected: "Ranking signals stop being split across copies.", pages: a.issues.find((i) => i.key.includes("duplicate_content"))?.urls ?? [] });
  }
  const seoAvg = avg(mob.map((r) => r.seo));
  if (seoAvg != null) add({ id: "lh-seo", cat: "onpage", label: "Lighthouse SEO score", status: seoAvg >= 90 ? "pass" : "warn", deduct: (100 - seoAvg) * 0.3, evidence: `Average ${Math.round(seoAvg)}/100 on mobile`, source: "Lighthouse" },
    { impact: "Low", effort: "Low", problem: `Lighthouse SEO averages ${Math.round(seoAvg)}/100.`, change: "Open the Lighthouse report for these pages and fix the listed SEO audits (link text, crawlable links, tap targets).", expected: "Basic on-page hygiene at 100.", pages: mob.filter((r) => (r.seo ?? 100) < 90).map((r) => r.url) });

  /* ------------------------------------------------------------ structured data */
  if (t && pagesOk.length) {
    const homeP = pagesOk.find((p) => path(p.finalUrl ?? p.url) === "/") ?? pagesOk[0];
    const org = homeP.schema.some((s) => /LocalBusiness|Organization|Store|ProfessionalService|HomeAndConstructionBusiness|Electrician|Corporation/i.test(s));
    const local = homeP.schema.some((s) => /LocalBusiness|Store|ProfessionalService|HomeAndConstructionBusiness|Electrician/i.test(s));
    add({ id: "schema-org", cat: "schema", label: "Organization / LocalBusiness on the home page", status: local ? "pass" : org ? "warn" : "fail", deduct: local ? 0 : org ? 15 : 35, evidence: `Home page types: ${homeP.schema.join(", ") || "none"}`, source: "Schema" },
      { impact: "High", effort: "Low", problem: local ? "" : org ? "The home page has Organization schema but not LocalBusiness, so address, hours and service area aren't marked up." : "The home page has no Organization or LocalBusiness structured data.", change: "Add LocalBusiness JSON-LD (most specific subtype) with name, address, phone, geo, opening hours, sameAs (Google Business Profile, social) and areaServed; Rank Math / Yoast Local SEO can output it.", expected: "Eligibility for rich business details and a stronger link between the site and the Business Profile.", pages: [homeP.url] });
    const none = pagesOk.filter((p) => p.schema.length === 0);
    pageCheck("schema-any", "schema", "Pages carry structured data", none, 3, 20, "Schema", "have no structured data", { impact: "Medium", effort: "Low", problem: "Pages carry no structured data at all.", change: "Enable the SEO plugin's schema output (WebPage, BreadcrumbList) site-wide and add Service schema to service pages.", expected: "Search engines understand page types and entities." });
    const inner = pagesOk.filter((p) => path(p.finalUrl ?? p.url) !== "/");
    pageCheck("schema-crumb", "schema", "BreadcrumbList on inner pages", inner.filter((p) => !p.schema.includes("BreadcrumbList")), 1, 12, "Schema", "lack BreadcrumbList schema", { impact: "Low", effort: "Low", problem: "Inner pages have no BreadcrumbList schema.", change: "Turn on breadcrumbs in the SEO plugin (it outputs BreadcrumbList JSON-LD) and show them on the page.", expected: "Breadcrumb paths in search results instead of raw URLs." });
    const blog = new Set(inp.blogUrls.map(norm));
    const posts = pagesOk.filter((p) => blog.has(norm(p.url)) || blog.has(norm(p.finalUrl ?? p.url)));
    if (posts.length) pageCheck("schema-article", "schema", "Blog posts marked up as BlogPosting / Article", posts.filter((p) => !p.schema.some((s) => /Article|BlogPosting|NewsArticle/i.test(s))), 4, 15, "Schema", "are blog posts without Article/BlogPosting schema", { impact: "Low", effort: "Low", problem: "Blog posts lack Article / BlogPosting schema.", change: "Set the post schema type to BlogPosting in the SEO plugin, with author, datePublished and image.", expected: "Clearer authorship and date signals (E-E-A-T) and article rich results." });
    const faq = pagesOk.some((p) => p.schema.includes("FAQPage"));
    add({ id: "schema-faq", cat: "schema", label: "FAQ markup on pages with questions", status: faq ? "pass" : "warn", deduct: faq ? 0 : 3, evidence: faq ? "FAQPage found on at least one sampled page" : "No FAQPage schema on the sampled pages", source: "Schema" },
      { impact: "Low", effort: "Low", problem: "No FAQ structured data on the sampled pages.", change: "Add a short FAQ block (3-5 real customer questions) to the main service pages with FAQPage schema.", expected: "Better coverage of question searches and AI answers.", pages: [] });
  }

  /* ------------------------------------------------------------ security & HTTPS */
  if (a?.site.ssl != null) add({ id: "ssl", cat: "security", label: "Valid SSL certificate", status: a.site.ssl ? "pass" : "fail", deduct: 40, evidence: a.site.ssl ? "Certificate valid" : "SSL problem reported by the crawler", source: "Crawl" },
    { critical: true, impact: "High", effort: "Low", problem: "The SSL certificate has a problem.", change: "Renew or reinstall the certificate (free Let's Encrypt via the host) and make sure it covers both www and non-www.", expected: "No browser security warnings.", pages: [] });
  if (t) {
    if (t.https.httpToHttps !== null) add({ id: "https-redirect", cat: "security", label: "HTTP redirects to HTTPS", status: t.https.httpToHttps ? "pass" : "fail", deduct: 25, evidence: t.https.httpToHttps ? `http://${t.domain}/ → https` : `http://${t.domain}/ stays on http`, source: "Site check" },
      { critical: true, impact: "High", effort: "Low", problem: "The http:// version doesn't redirect to https://.", change: "Add a site-wide 301 redirect from http to https (host panel, .htaccess or Really Simple SSL).", expected: "One secure version indexed; no duplicate http pages.", pages: [`http://${t.domain}/`] });
    add({ id: "hsts", cat: "security", label: "HSTS header", status: t.https.hsts ? "pass" : "warn", deduct: 8, evidence: t.https.hsts ? `Strict-Transport-Security: ${t.https.hsts}` : "No Strict-Transport-Security header on the home page", source: "Site check" },
      { impact: "Low", effort: "Low", problem: "No HSTS header, so browsers may still try http first.", change: "Send \"Strict-Transport-Security: max-age=31536000; includeSubDomains\" (host panel, Cloudflare or a security plugin) once HTTPS works everywhere.", expected: "Every visit goes straight to HTTPS.", pages: [t.origin] });
    pageCheck("mixed", "security", "No mixed content", pagesOk.filter((p) => p.mixed > 0), 4, 15, "Page HTML", "load images/scripts over http://", { impact: "Medium", effort: "Low", problem: "Secure pages load some files over insecure http://.", change: "Run a search-and-replace of http://<domain> → https://<domain> in the database (Better Search Replace) and update hard-coded embeds.", expected: "No browser \"not fully secure\" warnings." });
  }
  const bp = avg(mob.map((r) => r.best_practices));
  if (bp != null) add({ id: "lh-bp", cat: "security", label: "Lighthouse best practices", status: bp >= 90 ? "pass" : "warn", deduct: Math.max(0, 90 - bp) * 0.5, evidence: `Average ${Math.round(bp)}/100 on mobile`, source: "Lighthouse" },
    { impact: "Low", effort: "Medium", problem: `Lighthouse best practices averages ${Math.round(bp)}/100.`, change: "Fix the listed items in the Lighthouse report (console errors, outdated libraries, image aspect ratios, third-party cookies).", expected: "Fewer browser warnings and errors.", pages: mob.filter((r) => (r.best_practices ?? 100) < 90).map((r) => r.url) });

  /* ------------------------------------------------------------ mobile & accessibility */
  if (t) {
    pageCheck("viewport", "mobile", "Mobile viewport tag", pagesOk.filter((p) => !p.viewport), 10, 30, "Page HTML", "have no viewport meta tag", { impact: "High", effort: "Low", problem: "Pages have no mobile viewport tag, so they render as a zoomed-out desktop page on phones.", change: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> in the theme header.", expected: "A usable mobile layout (Google indexes the mobile version)." });
    const totalImg = pagesOk.reduce((s, p) => s + p.imgs, 0), noAlt = pagesOk.reduce((s, p) => s + p.imgNoAlt, 0);
    if (totalImg) add({ id: "alt", cat: "images", label: "Images have alt text", status: noAlt / totalImg > 0.2 ? "fail" : noAlt ? "warn" : "pass", deduct: cap((noAlt / totalImg) * 20, 15), evidence: `${noAlt} of ${totalImg} images on the sampled pages have no alt attribute`, source: "Page HTML" },
      { impact: "Medium", effort: "Low", problem: `${noAlt} images have no alt text.`, change: "Add short descriptive alt text in the WordPress media library (e.g. \"Custom LED storefront sign for a cafe\"); use alt=\"\" only for decorative images.", expected: "Image-search traffic and accessibility.", pages: pagesOk.filter((p) => p.imgNoAlt > 0).sort((x, y) => y.imgNoAlt - x.imgNoAlt).map((p) => p.url) });
    pageCheck("lang", "mobile", "html lang attribute", pagesOk.filter((p) => !p.lang), 2, 5, "Page HTML", "have no lang attribute on <html>", { impact: "Low", effort: "Low", problem: "The page language isn't declared.", change: "Set the site language in WordPress → Settings → General (the theme outputs <html lang>).", expected: "Correct language targeting and screen-reader pronunciation." });
  }
  const a11y = avg(mob.map((r) => r.accessibility));
  if (a11y != null) add({ id: "lh-a11y", cat: "mobile", label: "Lighthouse accessibility", status: a11y >= 90 ? "pass" : a11y >= 70 ? "warn" : "fail", deduct: (100 - a11y) * 0.5, evidence: `Average ${Math.round(a11y)}/100 on mobile`, source: "Lighthouse" },
    { impact: "Medium", effort: "Medium", problem: `Lighthouse accessibility averages ${Math.round(a11y)}/100.`, change: "Fix colour contrast, form labels, button names and tap-target sizes listed in the Lighthouse report.", expected: "Usable on phones and for every visitor; fewer mis-taps.", pages: mob.filter((r) => (r.accessibility ?? 100) < 90).map((r) => r.url) });

  /* ------------------------------------------------------------ links */
  if (a) {
    const bl = a.metrics.brokenLinks ?? 0;
    add({ id: "broken-links", cat: "links", label: "No broken links", status: bl ? (bl >= 10 ? "fail" : "warn") : "pass", deduct: cap(bl * 3, 30), evidence: `${bl} broken links found in the crawl`, source: "Crawl" },
      { impact: "High", effort: "Low", problem: `${bl} links point to pages that don't exist.`, change: "Update or remove each broken link (Site Audit → issue \"broken links\" lists the pages); 301-redirect removed pages to the closest live page.", expected: "No dead ends for visitors or crawlers; link value reaches live pages.", pages: a.issues.find((i) => /broken/i.test(i.key))?.urls ?? [] });
    const errPages = a.rows.filter((p) => p.status != null && p.status >= 400);
    add({ id: "4xx", cat: "links", label: "No 4xx / 5xx pages in the crawl", status: errPages.length ? "fail" : "pass", deduct: cap(errPages.length * 5, 30), evidence: errPages.length ? `${errPages.length} crawled pages return an error: ${errPages.slice(0, 3).map((p) => `${path(p.url)} (${p.status})`).join(", ")}` : "No error pages found", source: "Crawl" },
      { impact: "High", effort: "Low", problem: "Internal links lead to error pages.", change: "301-redirect each error URL to its replacement and fix the internal links pointing at it.", expected: "Recovered link value and a cleaner crawl.", pages: errPages.map((p) => p.url) });
    const redir = a.rows.filter((p) => p.status != null && p.status >= 300 && p.status < 400);
    add({ id: "3xx", cat: "url", label: "Internal links go straight to the final URL", status: redir.length ? "warn" : "pass", deduct: cap(redir.length * 1, 10), evidence: `${redir.length} crawled URLs are redirects`, source: "Crawl" },
      { impact: "Low", effort: "Low", problem: "Internal links point at URLs that redirect.", change: "Update menus and in-content links to the final URL (Better Search Replace on the old URLs).", expected: "Faster navigation and no wasted crawl hops.", pages: redir.map((p) => p.url) });
    const deep = a.rows.filter((p) => (p.depth ?? 0) > 3);
    add({ id: "depth", cat: "crawl", label: "Pages within 3 clicks of home", status: deep.length ? "warn" : "pass", deduct: cap(deep.length * 1, 8), evidence: `${deep.length} crawled pages are more than 3 clicks deep`, source: "Crawl" },
      { impact: "Low", effort: "Medium", problem: "Some pages are more than 3 clicks from the home page.", change: "Link them from a hub page, the menu or related posts.", expected: "Deep pages get crawled and ranked more often.", pages: deep.map((p) => p.url) });
    // orphans: sitemap URLs the crawler never reached by following links (only judged when the crawl finished under its page limit)
    if (t && t.sitemapUrls > 0 && a.pages < a.maxPages) {
      const crawled = new Set(a.rows.map((p) => norm(p.url)));
      const orphans = t.sitemapSample.filter((u) => !crawled.has(norm(u)));
      add({ id: "orphans", cat: "links", label: "Sitemap pages reachable by links", status: orphans.length ? "warn" : "pass", deduct: cap(orphans.length * 1.5, 15), evidence: `${orphans.length} of ${t.sitemapSample.length} sitemap URLs were not reached by following internal links (crawl covered ${a.pages} pages)`, source: "Sitemap + crawl" },
        { impact: "Medium", effort: "Medium", problem: "Pages in the sitemap have no internal links pointing to them (orphans).", change: "Link each orphan from a related service page, category or blog post, or remove it from the sitemap if it's obsolete.", expected: "Orphans get crawled, indexed and receive internal link value.", pages: orphans });
    }
  }
  if (t) {
    const chains = (t.pages ?? []).filter((p) => p.hops >= 2);
    pageCheck("chains", "url", "No redirect chains (max 1 hop)", chains, 4, 12, "Site check", "go through 2+ redirects", { impact: "Low", effort: "Low", problem: "Some URLs go through a chain of redirects.", change: "Point each redirect straight at the final URL.", expected: "Faster loads and full link value passed." });
    const broken = (t.pages ?? []).filter((p) => p.status == null || p.status >= 400);
    if (broken.length) add({ id: "sample-errors", cat: "links", label: "Important pages load", status: "fail", deduct: cap(broken.length * 6, 24), evidence: `${broken.length} sampled pages failed: ${broken.slice(0, 3).map((p) => `${path(p.url)} (${p.status ?? p.error ?? "no response"})`).join(", ")}`, source: "Site check" },
      { critical: true, impact: "High", effort: "Low", problem: "Pages from the sitemap or with traffic return an error.", change: "Restore or 301-redirect these URLs and update the sitemap.", expected: "Traffic and rankings for these URLs are kept.", pages: broken.map((p) => p.url) });
  }

  /* ------------------------------------------------------------ URL structure + security headers (claude-seo seo-technical) */
  if (t && pagesOk.length) {
    pageCheck("url-length", "url", "URLs under 100 characters", pagesOk.filter((p) => (p.finalUrl ?? p.url).length > 100), 2, 10, "Page HTML", "have URLs longer than 100 characters", { impact: "Low", effort: "Medium", problem: "Some URLs are longer than 100 characters.", change: "Shorten the slugs to the main keyword (e.g. /led-signs-<city>/) and 301-redirect the old URLs.", expected: "Cleaner, more clickable URLs in results." });
    pageCheck("url-params", "url", "Clean URLs (no query parameters)", pagesOk.filter((p) => (p.finalUrl ?? p.url).includes("?")), 3, 12, "Page HTML", "use query parameters for content", { impact: "Low", effort: "Medium", problem: "Content pages are served on URLs with query parameters.", change: "Use descriptive, hyphenated permalinks (WordPress → Settings → Permalinks → Post name).", expected: "Stable, descriptive URLs that don't create duplicates." });
    const inner = pagesOk.map((p) => path(p.finalUrl ?? p.url)).filter((x) => x !== "/" && !/\.[a-z0-9]+$/i.test(x));
    const withSlash = inner.filter((x) => x.endsWith("/")).length, minority = Math.min(withSlash, inner.length - withSlash);
    if (inner.length >= 3) add({ id: "trailing-slash", cat: "url", label: "Consistent trailing slashes", status: minority ? "warn" : "pass", deduct: cap(minority * 2, 8), evidence: `${withSlash} of ${inner.length} inner URLs end with "/"`, source: "Site check" },
      { impact: "Low", effort: "Low", problem: "Some URLs end with a slash and others don't.", change: "Pick one form (WordPress default: with slash), 301 the other and use it in internal links.", expected: "No slash / no-slash duplicates.", pages: [] });
  }
  if (t?.https.headers) {
    const h = t.https.headers;
    const missing = [!h.xcto && "X-Content-Type-Options", !h.xfo && "X-Frame-Options", !h.referrer && "Referrer-Policy", !h.csp && "Content-Security-Policy"].filter((x): x is string => Boolean(x));
    add({ id: "sec-headers", cat: "security", label: "Security headers", status: missing.length ? "warn" : "pass", deduct: missing.length * 2, evidence: missing.length ? `Missing on the home page: ${missing.join(", ")}` : "X-Content-Type-Options, X-Frame-Options, Referrer-Policy and CSP all present", source: "Site check" },
      { impact: "Low", effort: "Low", problem: `Security headers missing: ${missing.join(", ")}.`, change: "Add them in the host panel, Cloudflare (Transform Rules) or a headers plugin: X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN, Referrer-Policy: strict-origin-when-cross-origin, and a basic Content-Security-Policy.", expected: "Protection against clickjacking and content sniffing (a light trust signal, not a ranking factor).", pages: [t.origin] });
  }

  /* ------------------------------------------------------------ totals */
  const categories: CatScore[] = CATEGORIES.map((c) => {
    const cs = checks.filter((x) => x.cat === c.key);
    const measured = cs.some((x) => x.status !== "na");
    return { ...c, checks: cs, score: measured ? Math.max(0, 100 - cs.reduce((s, x) => s + x.deduct, 0)) : null };
  });
  const scored = categories.filter((c) => c.score != null);
  const measuredWeight = scored.reduce((s, c) => s + c.weight, 0);
  const overall = measuredWeight ? Math.round(scored.reduce((s, c) => s + c.score! * c.weight, 0) / measuredWeight) : null;
  const order: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  recs.sort((x, y) => order[x.priority] - order[y.priority] || y.points - x.points);

  const summary: string[] = [];
  if (overall != null) {
    const worst = [...scored].sort((x, y) => x.score! - y.score!);
    summary.push(`Technical SEO scores ${overall}/100 across ${scored.length} of ${CATEGORIES.length} categories.`);
    if (worst[0] && worst[0].score! < 90) summary.push(`Weakest area: ${worst[0].label} (${worst[0].score}/100)${worst[1] && worst[1].score! < 90 ? `, then ${worst[1].label} (${worst[1].score}/100)` : ""}.`);
    const high = recs.filter((r) => r.priority === "Critical" || r.priority === "High");
    if (high.length) summary.push(`${`${high.length} critical / high-priority fix${high.length === 1 ? "" : "es"}`}: ${high.slice(0, 3).map((r) => r.problem.replace(/\.$/, "").toLowerCase()).join("; ")}.`);
  }
  return {
    overall, categories, recs, speed, measuredWeight, summary,
    sources: { audit: a?.finishedAt ?? null, lighthouse: inp.lighthouse[0]?.checkedAt ?? null, checks: t?.checkedAt ?? null, crux: cruxNote },
  };
}

export const scoreBand = (n: number | null) => (n == null ? "Not measured" : n >= 90 ? "Good" : n >= 50 ? "Needs work" : "Poor");
