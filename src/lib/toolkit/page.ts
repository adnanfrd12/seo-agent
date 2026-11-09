import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analysePage } from "@/lib/technical/checks";
import type { LhRow, LhRun } from "@/lib/dataforseo/lighthouse";
import { BOT_UA } from "@/lib/blog/wordpress";
import { bare, fetchHtml, htmlAttr as attr, outline, readability, type Readability } from "./store";

/**
 * Single-page analyzer (free: reads the page from the client's own website plus stored Lighthouse and Search Console data).
 * Checks and thresholds follow the seo-page skill of the MIT-licensed claude-seo project (https://github.com/AgricIDaniel/claude-seo):
 * title 30-60 chars, description 120-160, one H1, no skipped heading levels, canonical, robots, Open Graph,
 * image alt / size (>200 KB warn, >500 KB critical) / dimensions, word count and readability.
 */
export type Prio = "Critical" | "High" | "Medium" | "Low";
export interface Fix { prio: Prio; area: string; issue: string; fix: string; points: number }
export interface PageImage { src: string; alt: string | null; kb: number | null; width: boolean; lazy: boolean; format: string }
export interface PageReport {
  url: string; finalUrl: string; status: number | null; ms: number;
  title: string | null; titleLen: number; desc: string | null; descLen: number;
  headings: { level: number; text: string }[]; words: number; read: Readability;
  canonical: string | null; robots: string | null; noindex: boolean; og: Record<string, boolean>; lang: boolean; viewport: boolean;
  schema: string[]; links: { internal: number; external: number; nofollow: number; emptyAnchor: number };
  images: PageImage[]; lighthouse: LhRow[]; lighthouseAt: string | null;
  queries: { query: string; clicks: number; impressions: number; position: number | null }[];
  score: number; areas: { area: string; score: number }[]; fixes: Fix[];
}

export async function analyzePage(admin: SupabaseClient, clientId: string, url: string, domain: string): Promise<PageReport> {
  const r = await fetchHtml(url);
  if (!r.html) throw new Error(r.status ? `The page answered ${r.status} without HTML.` : "The page didn't answer.");
  const html = r.html;
  const origin = new URL(r.finalUrl).origin;
  const base = analysePage(r.finalUrl, html, origin);
  const o = outline(html);
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? "";
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (n: string) => { const t = metas.find((x) => (attr(x, "name") ?? attr(x, "property") ?? "").toLowerCase() === n); return t ? attr(t, "content") : null; };
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;

  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const links = { internal: 0, external: 0, nofollow: 0, emptyAnchor: 0 };
  for (const a of anchors) {
    const href = attr(`<a ${a[1]}>`, "href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let host = "";
    try { host = bare(new URL(href, r.finalUrl).host); } catch { continue; }
    if (host === bare(domain)) links.internal++; else links.external++;
    if (/nofollow/i.test(attr(`<a ${a[1]}>`, "rel") ?? "")) links.nofollow++;
    if (!a[2].replace(/<[^>]+>/g, "").trim() && !/alt=["'][^"']+/i.test(a[2]) && !attr(`<a ${a[1]}>`, "aria-label")) links.emptyAnchor++;
  }

  const imgTags = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).slice(0, 40);
  const images: PageImage[] = imgTags.map((t) => {
    const src = attr(t, "src") ?? attr(t, "data-src") ?? attr(t, "data-lazy-src") ?? "";
    let abs = src; try { abs = new URL(src, r.finalUrl).toString(); } catch { /* keep as written */ }
    return { src: abs, alt: attr(t, "alt"), kb: null, width: Boolean(attr(t, "width") && attr(t, "height")), lazy: /loading=["']lazy|data-src|data-lazy|lazyload/i.test(t), format: (abs.split("?")[0].match(/\.(\w{3,4})$/)?.[1] ?? "?").toLowerCase() };
  }).filter((i) => i.src && !i.src.startsWith("data:"));
  // file sizes of the first images (HEAD requests, a few at a time)
  await Promise.all(images.slice(0, 15).map(async (i) => {
    try {
      const h = await fetch(i.src, { method: "HEAD", headers: { "user-agent": BOT_UA }, signal: AbortSignal.timeout(8000), cache: "no-store" });
      const len = Number(h.headers.get("content-length"));
      if (len > 0) i.kb = Math.round(len / 1024);
    } catch { /* size unknown */ }
  }));

  // stored Lighthouse rows for this URL and Search Console queries (last 90 days)
  const norm = (u: string) => { try { const x = new URL(u); return `${bare(x.host)}${x.pathname.replace(/\/$/, "")}`; } catch { return u; } };
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const pathVariants = [r.finalUrl, url, r.finalUrl.replace(/\/$/, ""), `${r.finalUrl.replace(/\/$/, "")}/`];
  const [lh, gsc] = await Promise.all([
    admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", "lighthouse").order("fetched_at", { ascending: false }).limit(10),
    admin.from("gsc_query_page_metrics").select("query, clicks, impressions, position_x_impressions").eq("client_id", clientId).in("page", [...new Set(pathVariants)]).gte("metric_date", since).limit(20000),
  ]);
  let lighthouse: LhRow[] = [], lighthouseAt: string | null = null;
  for (const run of lh.data ?? []) {
    const rows = ((run.data as LhRun).rows ?? []).filter((x) => norm(x.url) === norm(r.finalUrl) && !x.error);
    if (rows.length) { lighthouse = rows; lighthouseAt = run.fetched_at as string; break; }
  }
  const qm = new Map<string, { clicks: number; impressions: number; pxi: number }>();
  for (const g of gsc.data ?? []) {
    const a = qm.get(g.query) ?? { clicks: 0, impressions: 0, pxi: 0 };
    a.clicks += Number(g.clicks ?? 0); a.impressions += Number(g.impressions ?? 0); a.pxi += Number(g.position_x_impressions ?? 0);
    qm.set(g.query, a);
  }
  const queries = [...qm].map(([query, v]) => ({ query, clicks: v.clicks, impressions: v.impressions, position: v.impressions ? Number((v.pxi / v.impressions).toFixed(1)) : null }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 25);

  const robots = meta("robots");
  const og = { "og:title": Boolean(meta("og:title")), "og:description": Boolean(meta("og:description")), "og:image": Boolean(meta("og:image")), "twitter:card": Boolean(meta("twitter:card")) };
  const read = readability(o.text);

  /* ---------------------------------------------------------------- scoring: each area starts at 100 */
  const fixes: Fix[] = [];
  const add = (prio: Prio, area: string, issue: string, fix: string, points: number) => fixes.push({ prio, area, issue, fix, points });
  const topQ = queries[0]?.query;
  if (r.status !== 200) add("Critical", "Technical", `The page answered HTTP ${r.status}.`, "Make the page return 200 or redirect it permanently (301) to the right page.", 60);
  if (base.noindex) add("Critical", "Technical", "The page tells search engines not to index it (noindex).", "Remove noindex from the meta robots tag if this page should be found in Google.", 60);
  if (!base.title) add("Critical", "On-page", "No title tag.", `Add a 50-60 character title that starts with the main search phrase${topQ ? ` (e.g. "${topQ}")` : ""}.`, 30);
  else if (base.titleLen > 60) add(base.titleLen > 100 ? "High" : "Medium", "On-page", `Title is ${base.titleLen} characters, so Google will cut it off${base.titleLen > 100 ? " and may rewrite it" : ""}.`, "Shorten the title to 50-60 characters, keeping the main phrase first.", 10);
  else if (base.titleLen < 30) add("Medium", "On-page", `Title is only ${base.titleLen} characters.`, "Lengthen the title to 50-60 characters with the service and city.", 10);
  if (topQ && base.title && !base.title.toLowerCase().includes(topQ.split(" ")[0])) add("Medium", "On-page", `The title doesn't mention the page's top search query "${topQ}".`, "Work the top query (or its main words) into the title and H1.", 8);
  if (!base.desc) add("High", "On-page", "No meta description.", "Write a 140-160 character description that sells the click and names the service and area.", 15);
  else if (base.descLen > 160 || base.descLen < 110) add("Low", "On-page", `Meta description is ${base.descLen} characters.`, "Aim for 140-160 characters.", 5);
  if (base.h1 === 0) add("High", "On-page", "No H1 heading.", "Add exactly one H1 that states what the page is about.", 15);
  else if (base.h1 > 1) add("Medium", "On-page", `${base.h1} H1 headings.`, "Keep one H1; turn the others into H2s.", 8);
  const levels = o.headings.map((h) => h.level);
  if (levels.some((l, i) => i > 0 && l - levels[i - 1] > 1)) add("Low", "On-page", "Heading levels are skipped (e.g. H2 straight to H4).", "Use headings in order so the outline reads as a table of contents.", 4);
  if (o.words < 300) add("High", "Content", `Only ${o.words} words of main content (thin).`, "Expand to at least 500-800 useful words: what you offer, process, pricing factors, areas served, FAQs.", 20);
  else if (o.words < 600) add("Medium", "Content", `${o.words} words of main content.`, "Service pages that rank usually have 800+ words; add specifics, photos and FAQs.", 8);
  if (read.flesch < 50) add("Low", "Content", `Readability is hard (Flesch ${read.flesch}, grade ${read.grade}).`, "Use shorter sentences and plainer words; aim for Flesch 60+.", 5);
  if (!base.canonical) add("Medium", "Technical", "No canonical tag.", "Add a self-referencing canonical link.", 10);
  else if (norm(base.canonical) !== norm(r.finalUrl)) add("High", "Technical", `Canonical points elsewhere (${base.canonical}).`, "Point the canonical at this URL unless the page is a deliberate duplicate.", 15);
  if (!base.viewport) add("High", "Technical", "No viewport meta tag (not mobile friendly).", "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.", 15);
  if (!base.lang) add("Low", "Technical", "The html tag has no lang attribute.", "Add lang=\"en\" to the html tag.", 3);
  if (base.mixed > 0) add("Medium", "Technical", `${base.mixed} resources load over insecure http://.`, "Serve every image and script over https.", 8);
  if (!base.schema.length) add("High", "Schema", "No structured data.", "Add JSON-LD: LocalBusiness (with address, phone, hours) on the home page, Service on service pages, BlogPosting on posts.", 40);
  else if (!base.schema.some((s) => /LocalBusiness|Organization|Store|ProfessionalService|HomeAndConstructionBusiness/i.test(s))) add("Medium", "Schema", `Schema found (${base.schema.join(", ")}) but no LocalBusiness/Organization.`, "Add LocalBusiness or Organization schema with name, address, phone and logo.", 20);
  if (!base.schema.some((s) => /Breadcrumb/i.test(s)) && new URL(r.finalUrl).pathname !== "/") add("Low", "Schema", "No BreadcrumbList schema.", "Add BreadcrumbList JSON-LD (most SEO plugins can do this).", 10);
  const noAlt = images.filter((i) => i.alt === null || !i.alt.trim());
  if (noAlt.length) add(noAlt.length > 3 ? "Medium" : "Low", "Images", `${noAlt.length} of ${images.length} images have no alt text.`, "Describe each image's subject in its alt text (e.g. \"lit channel letter sign on a storefront\").", Math.min(30, noAlt.length * 5));
  const huge = images.filter((i) => (i.kb ?? 0) > 500), big = images.filter((i) => (i.kb ?? 0) > 200 && (i.kb ?? 0) <= 500);
  if (huge.length) add("High", "Images", `${huge.length} images are over 500 KB.`, "Compress and convert them to WebP/AVIF; they slow the page down.", 20);
  if (big.length) add("Medium", "Images", `${big.length} images are 200-500 KB.`, "Compress them to under 200 KB.", 10);
  const noDim = images.filter((i) => !i.width).length;
  if (noDim > 2) add("Low", "Images", `${noDim} images have no width/height.`, "Set width and height to prevent layout shift (CLS).", 8);
  if (!og["og:title"] || !og["og:image"]) add("Low", "Social", "Open Graph title or image missing.", "Add og:title, og:description and og:image so shares look right.", 30);
  if (links.internal < 5) add("Medium", "Links", `Only ${links.internal} internal links.`, "Link to related services, the contact page and supporting blog posts.", 15);
  if (links.emptyAnchor > 0) add("Low", "Links", `${links.emptyAnchor} links have no anchor text.`, "Give every link descriptive text or an aria-label.", 5);
  const mob = lighthouse.find((x) => x.device === "mobile") ?? lighthouse[0];
  if (mob?.performance != null && mob.performance < 50) add("High", "Speed", `Mobile Lighthouse performance is ${mob.performance}.`, "Compress images, defer scripts and use caching; see Site Audit for details.", 30);
  else if (mob?.performance != null && mob.performance < 90) add("Medium", "Speed", `Mobile Lighthouse performance is ${mob.performance}.`, "Trim heavy scripts and images to reach 90+.", 15);

  const AREAS = ["On-page", "Content", "Technical", "Schema", "Images", "Links", "Social", "Speed"];
  const WEIGHT: Record<string, number> = { "On-page": 20, Content: 20, Technical: 20, Schema: 10, Images: 10, Links: 10, Social: 5, Speed: 5 };
  const areas = AREAS.map((a) => ({ area: a, score: Math.max(0, 100 - fixes.filter((f) => f.area === a).reduce((s, f) => s + f.points, 0)) }));
  if (mob?.performance != null) areas[7].score = Math.min(areas[7].score, mob.performance);
  const counted = areas.filter((a) => a.area !== "Speed" || mob?.performance != null);
  const tw = counted.reduce((s, a) => s + WEIGHT[a.area], 0);
  const score = Math.round(counted.reduce((s, a) => s + a.score * WEIGHT[a.area], 0) / tw);
  const order: Prio[] = ["Critical", "High", "Medium", "Low"];
  fixes.sort((a, b) => order.indexOf(a.prio) - order.indexOf(b.prio) || b.points - a.points);

  return {
    url, finalUrl: r.finalUrl, status: r.status, ms: r.ms, title: base.title, titleLen: base.titleLen, desc: base.desc, descLen: base.descLen,
    headings: o.headings, words: o.words, read, canonical: base.canonical, robots, noindex: base.noindex, og, lang: base.lang, viewport: base.viewport,
    schema: base.schema, links, images, lighthouse, lighthouseAt, queries, score, areas, fixes,
  };
}
