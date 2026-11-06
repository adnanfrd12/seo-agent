import { createHash } from "node:crypto";

/**
 * Pure readers for a blog post's HTML: text and word count, links (internal / external / map), the
 * Google Maps embed and CID, the neighbourhood the post targets, and which service page it supports.
 * No network or database access, so everything here is easy to test against saved posts.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", trade: "™", reg: "®", copy: "©", deg: "°", eacute: "é", bull: "•",
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment: scripts, styles, embeds and SVG removed, block tags as breaks. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript|iframe|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|tr|td|th|table|section|article|blockquote|figure|figcaption|br|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export const wordCount = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export const contentHash = (html: string) => createHash("sha1").update(html).digest("hex");

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");
/** "/my-post" for any URL on the site: no query, no fragment, no trailing slash ("" for the home page). */
export function pathOf(url: string): string {
  try { return new URL(url).pathname.replace(/\/+$/, ""); } catch { return url.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, ""); }
}

/* ------------------------------------------------------------------ links */
export type LinkKind = "home" | "post" | "service" | "contact" | "page" | "internal" | "map" | "external";
export interface PostLink { url: string; path: string | null; anchor: string; internal: boolean; kind: LinkKind }

export interface SiteIndex {
  host: string;
  /** paths of every blog post ("/slug") */
  posts: Set<string>;
  /** service pages, by path */
  services: Map<string, { url: string; title: string }>;
  /** every other WordPress page path (about, careers...) */
  pages: Set<string>;
}

const isMapUrl = (u: URL) => (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && (u.pathname.startsWith("/maps") || u.searchParams.has("cid")))
  || /^(maps\.app\.goo\.gl|goo\.gl)$/.test(u.hostname) || u.hostname === "maps.google.com";

/** Every <a href> in content order, resolved against the post URL and classified. */
export function extractLinks(html: string, postUrl: string, site: SiteIndex): PostLink[] {
  const out: PostLink[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decodeEntities(m[2]).trim();
    if (!raw || /^(#|mailto:|tel:|javascript:|sms:)/i.test(raw)) continue;
    let u: URL;
    try { u = new URL(raw, postUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const anchor = htmlToText(m[3]).replace(/\s+/g, " ").slice(0, 160);
    const internal = bareHost(u.hostname) === site.host;
    const path = internal ? u.pathname.replace(/\/+$/, "") : null;
    let kind: LinkKind = "external";
    if (internal && path !== null) {
      kind = path === "" ? "home"
        : site.posts.has(path) ? "post"
        : site.services.has(path) ? "service"
        : /^\/(contact|contact-us|get-a-quote|quote|request-a-quote)$/i.test(path) ? "contact"
        : site.pages.has(path) ? "page" : "internal";
    } else if (isMapUrl(u)) kind = "map";
    out.push({ url: u.toString(), path, anchor, internal, kind });
  }
  return out;
}

/* ------------------------------------------------------------------ Google Maps */
export interface MapInfo {
  /** Maps CID of the business the post links to (maps?cid=...), or the place in the embed */
  cid: string | null;
  /** true when that CID is the client's own Business Profile */
  matches_profile: boolean | null;
  embed: boolean;
  place_name: string | null; zip: string | null; lat: number | null; lng: number | null;
  /** Google feature ids found in embeds and place links ("0x...:0x...") */
  feature_ids: string[];
  cid_anchor: string | null;
  place_url: string | null;
}

/** A Google feature id "0xAAAA:0xBBBB" carries the place's CID in its second half. */
export function featureIdToCid(fid: string): string | null {
  const m = /^0x[0-9a-f]+:0x([0-9a-f]+)$/i.exec(fid);
  if (!m) return null;
  try { return BigInt(`0x${m[1]}`).toString(); } catch { return null; }
}

const decodePlace = (s: string) => {
  try { return decodeURIComponent(s.replace(/\+/g, " ")).trim(); } catch { return s.replace(/\+/g, " ").trim(); }
};

export function parseMap(html: string, links: PostLink[], profileCid: string | null): MapInfo | null {
  const embeds = [...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)].map((m) => decodeEntities(m[2])).filter((s) => /google\.[a-z.]+\/maps\/embed|maps\.google\./.test(s));
  const mapLinks = links.filter((l) => l.kind === "map");
  if (!embeds.length && !mapLinks.length) return null;
  const cidLink = mapLinks.find((l) => /[?&](cid|ludocid)=\d+/.test(l.url));
  const linkCid = cidLink ? /[?&](?:cid|ludocid)=(\d+)/.exec(cidLink.url)?.[1] ?? null : null;
  const fids = [...new Set([...embeds, ...mapLinks.map((l) => l.url)].flatMap((s) => [...s.matchAll(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/gi)].map((m) => m[1].toLowerCase())))];
  const fidCids = fids.map(featureIdToCid).filter((x): x is string => Boolean(x));
  // the place link names the area the post targets: /maps/place/Westlake+Village,+TX+77084/@29.79,-95.71,...
  const place = mapLinks.map((l) => /\/maps\/place\/([^/@?]+)\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(l.url)).find(Boolean) ?? null;
  const embedCenter = embeds.map((s) => /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/.exec(s)).find(Boolean) ?? null;
  const placeName = place ? decodePlace(place[1]) : null;
  const cid = linkCid ?? (profileCid && fidCids.includes(profileCid) ? profileCid : fidCids.at(-1) ?? null);
  const matches = profileCid ? Boolean(cid && (cid === profileCid || fidCids.includes(profileCid) || linkCid === profileCid)) : null;
  return {
    cid, matches_profile: matches, embed: embeds.length > 0,
    place_name: placeName, zip: placeName ? /\b(\d{5})(?:-\d{4})?\b/.exec(placeName)?.[1] ?? null : null,
    lat: place ? Number(place[2]) : embedCenter ? Number(embedCenter[2]) : null,
    lng: place ? Number(place[3]) : embedCenter ? Number(embedCenter[1]) : null,
    feature_ids: fids, cid_anchor: cidLink?.anchor || null,
    place_url: mapLinks.find((l) => l.url.includes("/maps/place/"))?.url ?? null,
  };
}

/** The neighbourhood name from a place name like "Westlake Village, TX 77084". */
export const neighbourhoodOf = (placeName: string | null) => placeName?.split(",")[0]?.trim() || null;

/* ------------------------------------------------------------------ service pages */
// company, legal and job pages (job openings read like "sign-installer-service-technician")
const NOT_SERVICE = /(^|[-/])(about|contact|careers?|jobs?|privacy|terms|cookies?|blogs?|news|thank|faq|sitemap|reviews?|testimonials?|gallery|portfolio|team|login|account|cart|checkout|policy|disclaimer|accessibility|search|home|landing|apply|hiring|employment|openings?|positions?|specialist|technician|coordinator|manager|associate|intern)([-/]|$)/i;

/** Which WordPress pages are service pages: everything that isn't a company, legal or job page (or a child of one). */
export function servicePages(pages: { id: number; parent: number; link: string; slug: string; title: string }[], host: string) {
  const excluded = new Set(pages.filter((p) => NOT_SERVICE.test(p.slug) || NOT_SERVICE.test(p.title.toLowerCase().replace(/\s+/g, "-"))).map((p) => p.id));
  const out = new Map<string, { url: string; title: string }>();
  const other = new Set<string>();
  for (const p of pages) {
    let path: string;
    try { const u = new URL(p.link); if (bareHost(u.hostname) !== host) continue; path = u.pathname.replace(/\/+$/, ""); } catch { continue; }
    if (path === "" || excluded.has(p.id) || excluded.has(p.parent)) other.add(path);
    else out.set(path, { url: p.link, title: p.title });
  }
  return { services: out, pages: other };
}

const STOP = new Set(("a an and are as at be best by can do does for from get how in into is it its make made more most much near need new of on or our over should take that the their them this to top what when where which who why will with you your " +
  "business businesses company companies guide tips ideas long time way ways help").split(" "));
// "signage" and "sign" are the same topic; without this a rare word like "signage" decides the match
const SAME: Record<string, string> = { signage: "sign", graphics: "graphic", lettering: "letter", lighted: "lit", illuminated: "lit" };
const singular = (w: string) => SAME[w] ?? (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export function tokens(s: string, drop: Set<string> = new Set()): string[] {
  return [...new Set(s.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map(singular).filter((w) => !drop.has(w)))];
}

/**
 * The service page a post most likely supports, by topic: words from the target keyword (counted
 * double), the title and the anchors of links to the home page, weighted by how rare each word is
 * across service pages ("sign" is on every page; "office" is not). Place words are ignored.
 */
export function suggestService(
  input: { keyword: string | null; title: string; anchors: string[]; places: string[] },
  services: Map<string, { url: string; title: string }>,
): { url: string; title: string; score: number } | null {
  if (!services.size) return null;
  const drop = new Set(input.places.flatMap((p) => tokens(p)).concat(["houston", "tx", "texas"]));
  const docs = [...services.values()].map((s) => ({ ...s, t: new Set(tokens(`${s.title} ${s.url.replace(/^https?:\/\/[^/]+/, "")}`, drop)) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.t) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log((docs.length + 1) / ((df.get(t) ?? 0) + 1)) + 0.05;
  const weight = new Map<string, number>();
  const add = (s: string | null, w: number) => { for (const t of tokens(s ?? "", drop)) weight.set(t, Math.max(weight.get(t) ?? 0, w)); };
  add(input.title, 1); for (const a of input.anchors) add(a, 1.5); add(input.keyword, 2);
  let best: { url: string; title: string; score: number } | null = null;
  for (const d of docs) {
    let score = 0;
    for (const [t, w] of weight) if (d.t.has(t)) score += idf(t) * w;
    if (score > (best?.score ?? 0)) best = { url: d.url, title: d.title, score: Math.round(score * 100) / 100 };
  }
  // a shared generic word alone ("sign") is not a match
  return best && best.score >= 1 ? best : null;
}

/* ------------------------------------------------------------------ sharing */
export function shareLinks(url: string, title: string) {
  const u = encodeURIComponent(url), t = encodeURIComponent(title);
  return {
    read: url,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    x: `https://x.com/intent/post?url=${u}&text=${t}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    email: `mailto:?subject=${t}&body=${u}`,
  };
}
