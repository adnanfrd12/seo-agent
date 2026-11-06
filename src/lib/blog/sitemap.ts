import "server-only";
import { decodeEntities, htmlToText } from "./parse";
import { getText } from "./wordpress";

/**
 * Fallback for sites that aren't WordPress: blog posts are found through the sitemap and read from
 * their HTML (Open Graph / article meta, JSON-LD and the <article> or <main> element).
 */

const POSTY = /post|blog|article|news|insight|resource/i;
const POST_PATH = /\/(blog|blogs|news|articles?|posts?|insights|resources|learn)\/[^/]+|\/20\d\d\/\d\d\//i;

const locs = (xml: string) => [...xml.matchAll(/<(sitemap|url)>([\s\S]*?)<\/\1>/gi)].map((m) => ({
  loc: decodeEntities(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/i.exec(m[2])?.[1] ?? "").trim(),
  lastmod: /<lastmod>\s*(.*?)\s*<\/lastmod>/i.exec(m[2])?.[1] ?? null,
  index: m[1].toLowerCase() === "sitemap",
})).filter((x) => x.loc);

async function xml(url: string): Promise<string | null> {
  try {
    const r = await getText(url, { accept: "application/xml,text/xml,*/*", timeoutMs: 20_000 });
    return r.status === 200 && /<(urlset|sitemapindex)\b/i.test(r.body) ? r.body : null;
  } catch { return null; }
}

/** Post addresses with their last-modified dates, or null when no usable sitemap exists. */
export async function sitemapPosts(origin: string, limit = 500): Promise<{ url: string; lastmod: string | null }[] | null> {
  const starts: string[] = [];
  try {
    const robots = await getText(`${origin}/robots.txt`, { timeoutMs: 10_000 });
    if (robots.status === 200) for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) starts.push(m[1]);
  } catch { /* no robots.txt */ }
  starts.push(`${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`, `${origin}/post-sitemap.xml`);
  const seen = new Set<string>();
  const out = new Map<string, string | null>();
  let postSpecific = false;
  for (const start of [...new Set(starts)]) {
    const body = await xml(start);
    if (!body) continue;
    const entries = locs(body);
    const children = entries.filter((e) => e.index);
    const sets = children.length
      ? (children.some((c) => POSTY.test(c.loc)) ? children.filter((c) => POSTY.test(c.loc)) : children).slice(0, 10).map((c) => c.loc)
      : [start];
    postSpecific = children.some((c) => POSTY.test(c.loc)) || POSTY.test(start);
    for (const set of sets) {
      if (seen.has(set)) continue;
      seen.add(set);
      const page = set === start ? body : await xml(set);
      if (!page) continue;
      for (const e of locs(page)) if (!e.index) out.set(e.loc, e.lastmod);
    }
    if (out.size) break;
  }
  if (!out.size) return null;
  const home = new Set([`${origin}`, `${origin}/`]);
  const list = [...out.entries()].filter(([u]) => !home.has(u) && (postSpecific || POST_PATH.test(u)));
  return list.slice(0, limit).map(([url, lastmod]) => ({ url, lastmod }));
}

function metas(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /\b(?:property|name|itemprop)\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2]?.toLowerCase();
    const content = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
    if (key && content != null && !out.has(key)) out.set(key, decodeEntities(content).trim());
  }
  return out;
}

function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]) as unknown;
      const list = Array.isArray(j) ? j : [j];
      for (const x of list) {
        const graph = (x as { "@graph"?: unknown })["@graph"];
        for (const n of Array.isArray(graph) ? graph : [x]) if (n && typeof n === "object") out.push(n as Record<string, unknown>);
      }
    } catch { /* invalid JSON-LD */ }
  }
  return out;
}

// the first <article> only (lazy), so "related posts" articles further down don't inflate the word count
const block = (html: string, tag: string, lazy = false) => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*${lazy ? "?" : ""})</${tag}>`, "i").exec(html);
  return m ? m[1] : null;
};

export interface HtmlPost {
  title: string; published: string | null; modified: string | null; image: { url: string; alt: string } | null; content: string; categories: string[];
  /** the page says it's an article (og:type, Article/BlogPosting JSON-LD or a publish date): how crawled pages are told apart from service pages */
  isArticle: boolean;
}

/** One post page read from its HTML. */
export async function readHtmlPost(url: string): Promise<HtmlPost | null> {
  const r = await getText(url, { accept: "text/html", timeoutMs: 25_000 });
  if (r.status !== 200 || !/html/i.test(r.type)) return null;
  const html = r.body;
  const meta = metas(html);
  const ld = jsonLd(html).find((n) => /Article|BlogPosting|NewsArticle/i.test(String(n["@type"] ?? ""))) ?? null;
  const h1 = block(html, "h1");
  // "Post title | Site name": keep the post's own title
  const rawTitle = meta.get("og:title") || (h1 ? htmlToText(h1) : "") || htmlToText(block(html, "title") ?? "") || url;
  const title = rawTitle.replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, "").trim() || rawTitle;
  // the main text: the first <article> when it holds the post, else <main>, else the page without its chrome
  const chrome = (h: string) => h.replace(/<(header|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const words = (h: string | null) => (h ? htmlToText(chrome(h)).split(/\s+/).length : 0);
  const candidates = [block(html, "article", true), block(html, "main"), block(html, "body") ?? html];
  const content = chrome(candidates.find((c) => words(c) >= 300) ?? candidates.reduce<string>((a, c) => (c && words(c) > words(a) ? c : a), html));
  const time = /<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  const img = meta.get("og:image") || meta.get("twitter:image") || (typeof ld?.image === "string" ? ld.image : null);
  const section = meta.get("article:section") || (typeof ld?.articleSection === "string" ? ld.articleSection : "");
  return {
    title,
    published: meta.get("article:published_time") || meta.get("datepublished") || (typeof ld?.datePublished === "string" ? ld.datePublished : null) || time,
    modified: meta.get("article:modified_time") || (typeof ld?.dateModified === "string" ? ld.dateModified : null),
    image: img ? { url: img, alt: meta.get("og:image:alt") ?? "" } : null,
    content, categories: section ? [section] : [],
    isArticle: meta.get("og:type") === "article" || Boolean(ld) || meta.has("article:published_time"),
  };
}
