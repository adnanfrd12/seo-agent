import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiErrorMessage } from "@/lib/ai/claude";
import { loadAudit } from "@/lib/dataforseo/audit";
import { localIdentity } from "@/lib/dataforseo/local";
import { resolveTarget } from "@/lib/dataforseo/research";
import { GEO_MODEL, readGeo, type GeoRead } from "./geo";
import {
  contentHash, extractLinks, htmlToText, neighbourhoodOf, parseMap, pathOf, servicePages, suggestService, wordCount,
  type MapInfo, type SiteIndex,
} from "./parse";
import { readHtmlPost, sitemapPosts } from "./sitemap";
import { findWpApi, wpListPosts, wpMedia, wpPages, wpPosts, wpTerms, type WpMedia } from "./wordpress";

/**
 * Keeps blog_posts in step with the client's website. Each run lists every post (cheap), fetches full
 * content only for posts that are new, changed or not yet read, reads their places and keywords with
 * Claude (inline, five at a time, inside a per-run cost cap and deadline) and removes posts that are
 * no longer published. Unfinished work simply continues on the next run.
 */
export interface BlogRun {
  source: "wordpress" | "sitemap" | "crawler" | null; listed: number; fetched: number; removed: number;
  geoRead: number; geoPending: number; cost: number; errors: string[]; stopped: string | null;
}

const RUN_COST_LIMIT = 0.5; // $ of Claude reading per run; the whole 202-post backfill costs about $0.07
const BATCH = 25;

interface RawPost {
  externalId: string | null; url: string; slug: string | null; title: string; excerpt: string; html: string;
  publishedAt: string | null; publishedDate: string | null; modifiedAt: string | null;
  categories: string[]; tags: string[]; image: { url: string; alt: string; width: number | null; height: number | null; unreadable?: boolean } | null;
}
interface Existing { id: string; url: string; modified_at: string | null; content_hash: string | null; geo_hash: string | null; keywords: Record<string, unknown> & { target?: string } | null; geo: { model?: string | null } | null }

const isoOrNull = (s: string | null | undefined, utc = false) => {
  if (!s) return null;
  const t = Date.parse(utc && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const sameTime = (a: string | null, b: string | null) => Boolean(a && b && Date.parse(a) === Date.parse(b));
const tableMissing = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /blog_posts/.test(e.message ?? "");
const geoDone = (r: Existing | undefined) => Boolean(r && r.content_hash && r.geo_hash === r.content_hash && r.geo?.model);

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function syncBlog(
  admin: SupabaseClient, clientId: string,
  opts: { deadline?: number; force?: boolean; geo?: boolean; maxCost?: number; via?: "auto" | "crawler" } = {},
): Promise<BlogRun> {
  const run: BlogRun = { source: null, listed: 0, fetched: 0, removed: 0, geoRead: 0, geoPending: 0, cost: 0, errors: [], stopped: null };
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const maxCost = opts.maxCost ?? RUN_COST_LIMIT;
  const target = await resolveTarget(admin, clientId);
  if (!target) { run.errors.push("No website is known for this client yet (connect Search Console, Bing or Business Profile)."); run.stopped = "setup"; return run; }
  const origin = `https://${target.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const [me, ex] = await Promise.all([
    localIdentity(admin, clientId).catch(() => null),
    admin.from("blog_posts").select("id, url, modified_at, content_hash, geo_hash, keywords, geo").eq("client_id", clientId),
  ]);
  if (ex.error) {
    run.errors.push(tableMissing(ex.error) ? "Blog content needs database migration 20261106000023 (supabase/migrations)." : ex.error.message);
    run.stopped = "setup";
    return run;
  }
  const existing = new Map(((ex.data ?? []) as Existing[]).map((r) => [r.url, r]));
  const readGeoOn = opts.geo !== false && Boolean(process.env.ANTHROPIC_API_KEY);

  // ------------------------------------------------------------ list every post
  let site: SiteIndex = { host, posts: new Set(), services: new Map(), pages: new Set() };
  let listed: { url: string; modified: string | null; id?: number }[] = [];
  const crawlerOnly = opts.via === "crawler";
  const wp = crawlerOnly ? null : await findWpApi(origin);
  if (wp) {
    run.source = "wordpress";
    try {
      const [posts, pages] = await Promise.all([wpListPosts(wp), wpPages(wp).catch(() => [])]);
      listed = posts.map((p) => ({ url: p.link, modified: isoOrNull(p.modified_gmt, true), id: p.id }));
      const sp = servicePages(pages, host);
      site = { host, posts: new Set(listed.map((p) => pathOf(p.url))), services: sp.services, pages: sp.pages };
    } catch (e) {
      run.errors.push(`WordPress: ${e instanceof Error ? e.message : "listing failed"}`);
      run.stopped = "source";
      return run;
    }
  } else {
    const sm = crawlerOnly ? null : await sitemapPosts(origin);
    if (sm) {
      run.source = "sitemap";
      listed = sm.map((p) => ({ url: p.url, modified: isoOrNull(p.lastmod) }));
      site = { host, posts: new Set(listed.map((p) => pathOf(p.url))), services: new Map(), pages: new Set() };
    } else {
      // third: the pages DataForSEO's site crawler found in the latest site audit. A crawl isn't a full
      // list of posts, so this only adds posts not stored yet (pages that aren't articles are skipped)
      // and never removes any; each finished crawl is checked once unless asked again.
      const crawl = await crawledPages(admin, clientId, host);
      if (!crawl) {
        run.errors.push(crawlerOnly ? "No site-crawler results yet: start a crawl first." : `Couldn't find the blog on ${host}: no WordPress API, no sitemap listing posts and no site-crawler results.`);
        run.stopped = "source";
        return run;
      }
      run.source = "crawler";
      const seen = crawl.checkedAt === crawl.at && !crawlerOnly && !opts.force;
      listed = seen ? [] : crawl.urls.filter((u) => !existing.has(u)).slice(0, 150).map((url) => ({ url, modified: null }));
      site = { host, posts: new Set([...existing.keys(), ...crawl.urls].map(pathOf)), services: new Map(), pages: new Set() };
      if (!seen) await markCrawlChecked(admin, clientId, crawl.at);
    }
  }
  run.listed = listed.length;

  // new, changed, or not read with Claude yet (so an interrupted backfill continues)
  const todo = listed.filter((p) => {
    const r = existing.get(p.url);
    return opts.force || !r || !r.content_hash || (p.modified && !sameTime(r.modified_at, p.modified)) || (readGeoOn && !geoDone(r));
  });
  run.geoPending = readGeoOn ? listed.filter((p) => !geoDone(existing.get(p.url))).length : 0;

  // ------------------------------------------------------------ fetch, read, store
  const now = new Date().toISOString();
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() > deadline - 25_000) { run.stopped = "time"; break; }
    const chunk = todo.slice(i, i + BATCH);
    let raws: RawPost[] = [];
    try {
      raws = wp ? await fromWordPress(wp, chunk.map((p) => p.id!).filter(Boolean)) : await fromHtml(chunk.map((p) => ({ url: p.url, modified: p.modified })), run.source === "crawler");
    } catch (e) {
      run.errors.push(e instanceof Error ? e.message : "fetch failed");
      continue;
    }
    const rows: Record<string, unknown>[] = [];
    const reads = new Map<string, { geo: GeoRead; cost: number }>();
    const needGeo = raws.filter((r) => {
      const old = existing.get(r.url);
      return readGeoOn && !(old && old.geo_hash === contentHash(r.html) && old.geo?.model);
    });
    await pool(needGeo, 5, async (r) => {
      if (run.cost >= maxCost || Date.now() > deadline - 15_000) return;
      const text = htmlToText(r.html);
      const map = parseMap(r.html, [], null);
      try {
        const g = await readGeo({ title: r.title, text, place: map?.place_name ?? null, city: me?.city ?? null });
        reads.set(r.url, g);
        run.cost += g.cost;
        run.geoRead++;
      } catch (e) {
        if (run.errors.length < 5) run.errors.push(`Reading "${r.title.slice(0, 50)}": ${aiErrorMessage(e)}`);
      }
    });
    if (needGeo.length > reads.size && run.cost >= maxCost) run.stopped = "cost limit";

    for (const r of raws) {
      const hash = contentHash(r.html);
      const links = extractLinks(r.html, r.url, site);
      const map: MapInfo | null = parseMap(r.html, links, me?.cid ?? null);
      const text = htmlToText(r.html);
      const read = reads.get(r.url);
      const old = existing.get(r.url);
      const keyword = read?.geo.target_keyword ?? old?.keywords?.target ?? null;
      const service = links.find((l) => l.kind === "service");
      const places = [map?.place_name, ...(read?.geo.neighborhoods ?? [])].filter((x): x is string => Boolean(x));
      const row: Record<string, unknown> = {
        // posts read from their HTML (sitemap or crawler) are stored as "sitemap"
        client_id: clientId, source: run.source === "wordpress" ? "wordpress" : "sitemap", external_id: r.externalId, url: r.url, slug: r.slug, title: r.title, excerpt: r.excerpt.slice(0, 400),
        published_at: r.publishedAt, published_date: r.publishedDate, modified_at: r.modifiedAt,
        categories: r.categories, tags: r.tags, featured_image: r.image, word_count: wordCount(text),
        links: links.slice(0, 200), internal_links: links.filter((l) => l.internal).length, external_links: links.filter((l) => !l.internal).length,
        target_service: service ? { url: service.url, title: site.services.get(service.path ?? "")?.title ?? service.anchor, anchor: service.anchor } : null,
        suggested_service: suggestService({ keyword, title: r.title, anchors: links.filter((l) => l.kind === "home" || l.kind === "service").map((l) => l.anchor), places }, site.services),
        map, content_hash: hash, fetched_at: now,
      };
      const base = { neighborhood: neighbourhoodOf(map?.place_name ?? null), zip: map?.zip ?? null, lat: map?.lat ?? null, lng: map?.lng ?? null };
      if (read) {
        const g = read.geo;
        row.geo = {
          ...base, neighborhood: base.neighborhood ?? g.neighborhoods[0] ?? null, zip: base.zip ?? g.zip_codes[0] ?? null,
          city: g.city ?? me?.city ?? null, road_crossings: g.road_crossings, landmarks: g.landmarks, neighborhoods: g.neighborhoods, zip_codes: g.zip_codes, model: GEO_MODEL,
        };
        // DataForSEO keyword data stored on the post (keywords.ts) is kept
        row.keywords = { ...(old?.keywords ?? {}), target: g.target_keyword, secondary: g.secondary_keywords };
        row.geo_hash = hash;
        row.geo_cost = read.cost;
      } else if (!old?.geo) {
        // nothing read yet: keep what the map link says, and read the rest on a later run
        row.geo = { ...base, city: me?.city ?? null, road_crossings: [], landmarks: [], neighborhoods: base.neighborhood ? [base.neighborhood] : [], zip_codes: base.zip ? [base.zip] : [], model: null };
      }
      rows.push(row);
    }
    // rows of one upsert must carry the same columns
    for (const group of [rows.filter((r) => "geo_hash" in r), rows.filter((r) => !("geo_hash" in r) && "geo" in r), rows.filter((r) => !("geo" in r))]) {
      if (!group.length) continue;
      const { error } = await admin.from("blog_posts").upsert(group, { onConflict: "client_id,url" });
      if (error) { run.errors.push(`Saving posts: ${error.message}`); run.stopped = "storage"; return run; }
    }
    run.fetched += rows.length;
  }
  run.cost = Number(run.cost.toFixed(4));
  run.geoPending = Math.max(0, run.geoPending - run.geoRead);

  // ------------------------------------------------------------ posts no longer published
  if (listed.length && run.source !== "crawler") {
    const live = new Set(listed.map((p) => p.url));
    const gone = [...existing.values()].filter((r) => !live.has(r.url)).map((r) => r.id);
    for (let i = 0; i < gone.length; i += 50) {
      const { error } = await admin.from("blog_posts").delete().in("id", gone.slice(i, i + 50));
      if (!error) run.removed += Math.min(50, gone.length - i);
    }
  }
  return run;
}

async function fromWordPress(base: string, ids: number[]): Promise<RawPost[]> {
  const posts = await wpPosts(base, ids);
  const [media, cats, tags] = await Promise.all([
    // only for images the embed didn't carry; many sites lock /wp/v2/media, which is fine
    wpMedia(base, posts.filter((p) => !p.media).map((p) => p.featured_media)).catch(() => new Map<number, WpMedia>()),
    wpTerms(base, "categories", posts.flatMap((p) => p.categories)).catch(() => new Map<number, string>()),
    wpTerms(base, "tags", posts.flatMap((p) => p.tags)).catch(() => new Map<number, string>()),
  ]);
  return posts.map((p) => {
    const m = p.media ?? media.get(p.featured_media);
    return {
      externalId: String(p.id), url: p.link, slug: p.slug || null, title: htmlToText(p.title), excerpt: htmlToText(p.excerpt), html: p.content,
      publishedAt: isoOrNull(p.date_gmt, true), publishedDate: /^\d{4}-\d{2}-\d{2}/.test(p.date) ? p.date.slice(0, 10) : null, modifiedAt: isoOrNull(p.modified_gmt, true),
      categories: p.categories.map((id) => cats.get(id)).filter((x): x is string => Boolean(x)), tags: p.tags.map((id) => tags.get(id)).filter((x): x is string => Boolean(x)),
      // a featured image that couldn't be read is still a featured image (its alt text is unknown)
      image: m ? { url: m.url, alt: m.alt, width: m.width, height: m.height } : p.featured_media ? { url: "", alt: "", width: null, height: null, unreadable: true } : null,
    };
  });
}

async function fromHtml(list: { url: string; modified: string | null }[], articlesOnly = false): Promise<RawPost[]> {
  const out: RawPost[] = [];
  await pool(list, 4, async (p) => {
    const h = await readHtmlPost(p.url).catch(() => null);
    if (!h || (articlesOnly && !h.isArticle)) return;
    let slug: string | null = null;
    try { slug = new URL(p.url).pathname.split("/").filter(Boolean).at(-1) ?? null; } catch { /* keep null */ }
    out.push({
      externalId: null, url: p.url, slug, title: h.title, excerpt: "", html: h.content,
      publishedAt: isoOrNull(h.published), publishedDate: h.published && /^\d{4}-\d{2}-\d{2}/.test(h.published) ? h.published.slice(0, 10) : null,
      modifiedAt: isoOrNull(h.modified) ?? p.modified, categories: h.categories, tags: [],
      image: h.image ? { url: h.image.url, alt: h.image.alt, width: null, height: null } : null,
    });
  });
  return out;
}

/** Live pages from the latest DataForSEO site audit, and which crawl the blog last checked. */
async function crawledPages(admin: SupabaseClient, clientId: string, host: string) {
  const [{ result }, { data: c }] = await Promise.all([loadAudit(admin, clientId), admin.from("clients").select("settings").eq("id", clientId).maybeSingle()]);
  if (!result?.data.rows.length) return null;
  const urls = [...new Set(result.data.rows.filter((r) => r.status == null || r.status === 200).map((r) => r.url).filter((u) => {
    try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === host && x.pathname.replace(/\/+$/, "") !== ""; } catch { return false; }
  }))];
  const checkedAt = ((c?.settings ?? {}) as { blog_crawl_checked?: string }).blog_crawl_checked ?? null;
  return { urls, at: result.data.finishedAt, checkedAt };
}

async function markCrawlChecked(admin: SupabaseClient, clientId: string, at: string) {
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  await admin.from("clients").update({ settings: { ...((data?.settings as Record<string, unknown>) ?? {}), blog_crawl_checked: at } }).eq("id", clientId);
}
