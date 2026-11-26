/**
 * Orphaned pages, two different kinds (pure functions, no API calls):
 *  - internal orphans: no other page on the site links to them (crawl link graph + blog post links)
 *  - pages without backlinks: no other website links to them (site pages vs DataForSEO's linked-pages list)
 */

export interface OrphanSitePage { url: string; status: number | null; title: string | null; orphan?: boolean; sitemap?: boolean; words?: number | null }
export interface OrphanBlogPost { url: string; title: string | null; links: { url?: string | null; internal?: boolean | null }[] | null }

/** Same page whatever the scheme, www, trailing slash, query or fragment. */
export function pageKey(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const x = new URL(u.startsWith("http") ? u : `https://${u.replace(/^\/+/, "")}`);
    const path = x.pathname.replace(/\/+$/, "") || "/";
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${path.toLowerCase()}`;
  } catch { return u.toLowerCase(); }
}
const isHome = (k: string) => /^[^/]+\/$/.test(k);

export interface InternalOrphan { url: string; title: string | null; source: "crawl" | "blog"; evidence: string; sitemap: boolean | null; words: number | null }

/**
 * Pages nothing else on the site links to.
 * Crawled pages use DataForSEO's flag (self-links and the canonical don't count), minus pages a blog post links to.
 * Blog posts the crawl never reached count only when no other post links to them either (weaker evidence, said so).
 */
export function internalOrphans(pages: OrphanSitePage[], posts: OrphanBlogPost[], fallbackUrls: string[] = []): InternalOrphan[] {
  const linkedFrom = new Map<string, Set<string>>();
  for (const p of posts) {
    const from = pageKey(p.url);
    for (const l of p.links ?? []) {
      if (!l?.url || l.internal === false) continue;
      const to = pageKey(l.url);
      if (!to || to === from) continue;
      const s = linkedFrom.get(to) ?? new Set<string>();
      s.add(from);
      linkedFrom.set(to, s);
    }
  }
  const crawled = new Set(pages.map((p) => pageKey(p.url)));
  const flaggedKnown = pages.some((p) => typeof p.orphan === "boolean");
  const out: InternalOrphan[] = [];
  const seen = new Set<string>();
  const crawlOrphans = flaggedKnown ? pages.filter((p) => p.orphan && (p.status ?? 200) < 300) : pages.filter((p) => fallbackUrls.some((u) => pageKey(u) === pageKey(p.url)));
  for (const p of crawlOrphans) {
    const k = pageKey(p.url);
    if (isHome(k) || linkedFrom.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ url: p.url, title: p.title, source: "crawl", evidence: "No other crawled page links here", sitemap: p.sitemap ?? null, words: p.words ?? null });
  }
  if (!flaggedKnown) for (const u of fallbackUrls) {
    const k = pageKey(u);
    if (seen.has(k) || isHome(k) || linkedFrom.has(k)) continue;
    seen.add(k);
    out.push({ url: u, title: null, source: "crawl", evidence: "No other crawled page links here", sitemap: null, words: null });
  }
  for (const p of posts) {
    const k = pageKey(p.url);
    if (crawled.has(k) || seen.has(k) || linkedFrom.has(k)) continue;
    seen.add(k);
    out.push({ url: p.url, title: p.title, source: "blog", evidence: "Not reached by the crawl, and no other blog post links here", sitemap: null, words: null });
  }
  return out;
}

export interface LinkedPage { page: string | null; backlinks: number | null }
export interface NoBacklinkPage { url: string; title: string | null; source: string }

/**
 * Live site pages with no backlink from another website. `linked` is DataForSEO's list of pages that receive
 * backlinks; when it was cut off (`complete` false) a page missing from it may still have a few links.
 */
export function pagesWithoutBacklinks(site: { url: string; title: string | null; source: string }[], linked: LinkedPage[]): NoBacklinkPage[] {
  const has = new Set(linked.filter((l) => (l.backlinks ?? 0) > 0).map((l) => pageKey(l.page)));
  const seen = new Set<string>();
  const out: NoBacklinkPage[] = [];
  for (const p of site) {
    const k = pageKey(p.url);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (!has.has(k)) out.push({ url: p.url, title: p.title, source: p.source });
  }
  return out;
}
