import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, BudgetError, recordSpend } from "@/lib/dataforseo/budget";
import { DfsError, dfsPost } from "@/lib/dataforseo/client";
import { arr, obj, str, type Ctx, type Json } from "@/lib/dataforseo/research";
import type { PlatformKey, PReview } from "./platforms";

/**
 * Review sites without a reviews API, found from the business's name, address and phone (NAP) and read from
 * their public listing pages: YellowPages, Nextdoor, Angi, BBB, Houzz and Thumbtack (Yelp is only found here;
 * its reviews come from DataForSEO's Yelp endpoint when that is switched on).
 *
 * These sites refuse plain requests from servers, so every page is opened by DataForSEO's crawler in a real
 * browser (On-Page "instant_pages", ≈$0.005 a page; the page's HTML is then fetched for free). Nothing is posted,
 * no login is used and no bot check is worked around: a site that also refuses DataForSEO is reported as blocked.
 *   Finding: YellowPages' own search by phone; Nextdoor's public page address (name-city-state) confirmed by the
 *            phone on it; Google search through DataForSEO for Yelp, BBB, Angi, Houzz and Thumbtack.
 *   Reading: schema.org data in the page (YellowPages, BBB, Houzz, Thumbtack), Angi's page data (rating, count,
 *            reviews with owner replies) and Nextdoor's page data (faves = recommendations, newest ones' text).
 */
export const CRAWL_EST = 0.006;
const SEARCH_EST = 0.004;
export const DISCOVERY_EST = 3 * CRAWL_EST + 5 * SEARCH_EST;
export const DISCOVERY_EVERY_DAYS = 30;

/** Read from their listing pages (BBB, Houzz and Thumbtack usually refuse; they're tried and reported). */
export const CRAWLED: PlatformKey[] = ["yellowpages", "nextdoor", "angi", "bbb", "houzz", "thumbtack"];

/* ------------------------------------------------------------------ name, address, phone */
const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

export interface Nap { name: string; phone: string | null; digits: string | null; street: string | null; city: string | null; state: string | null; zip: string | null }

/** The 10 digits of a US phone number ("+1 281-235-3242" -> "2812353242"), or null. */
export const digitsOf = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  const t = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return t.length === 10 ? t : null;
};
const stateCode = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : STATES[v.toLowerCase()] ?? null;
};
/** Lower-case words only, "&" read as "and", legal suffixes dropped: for comparing business names. */
export const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, " ").replace(/\b(llc|inc|co|corp|ltd|pllc)\b/g, " ").replace(/\s+/g, " ").trim();
const slug = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The business's name, address and phone, from the connected Business Profile (or the stored DataForSEO profile). */
export async function clientNap(admin: SupabaseClient, clientId: string): Promise<Nap | null> {
  const [{ data: res }, { data: prof }] = await Promise.all([
    admin.from("integration_resources").select("display_name, metadata").eq("client_id", clientId).eq("provider", "gbp").eq("is_selected", true).limit(1).maybeSingle(),
    admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "gbp_profile").eq("params_hash", "self").maybeSingle(),
  ]);
  const m = obj(res?.metadata), loc = obj(m.lbm_location), p = obj(prof?.data);
  const name = (str(loc.name) || str(res?.display_name) || str(p.title) || "").trim();
  if (!name) return null;
  const phone = str(m.phone) || str(loc.phone_number) || str(p.phone) || null;
  // "18484 Clay Rd, Houston, TX 77084, USA"
  const parts = (str(m.address) || str(loc.address) || str(p.address) || "").split(",").map((x) => x.trim())
    .filter((x) => x && !/^(usa|us|united states)$/i.test(x));
  const stZip = /^([A-Za-z .]+?)\s+(\d{5})(?:-\d{4})?$/.exec(parts.at(-1) ?? "");
  return {
    name, phone, digits: digitsOf(phone),
    street: parts.length >= 3 ? parts[0] : null,
    city: str(loc.city) || (parts.length >= 2 ? parts[parts.length - 2] : null),
    state: stateCode(str(loc.administrative_area)) ?? stateCode(stZip?.[1]),
    zip: str(loc.postal_code) || stZip?.[2] || null,
  };
}

/* ------------------------------------------------------------------ opening a page through DataForSEO */
export interface Page { status: number | null; html: string; error?: string }
export interface Meter { cost: number }

/**
 * Opens one public page with DataForSEO's crawler (real browser) and returns its HTML. A site that refuses the
 * crawler too comes back with its status (403 / 202 bot check) and no HTML; that is reported, never retried around.
 */
export async function openPage(ctx: Ctx, url: string, label: string, meter: Meter): Promise<Page> {
  await assertBudget(ctx.admin, ctx.clientId, CRAWL_EST, ctx.source);
  let res: Awaited<ReturnType<typeof dfsPost>>;
  try {
    res = await dfsPost("/on_page/instant_pages", { url, enable_javascript: true, enable_browser_rendering: true, store_raw_html: true }, { timeoutMs: 110_000, attempts: 1 });
  } catch (e) {
    if (e instanceof DfsError && (e.kind === "payment" || e.kind === "auth" || e.kind === "config")) throw e;
    return { status: null, html: "", error: /too long|50402|timeout/i.test(e instanceof Error ? e.message : "") ? "no answer in time" : "the crawler couldn't open it" };
  }
  if (res.cost) { meter.cost += res.cost; await recordSpend(ctx.admin, ctx.clientId, `listing_${label}`, res.cost, ctx.source); }
  const status = num(arr(res.result?.items)[0]?.status_code);
  if (status !== 200 || !res.id) return { status, html: "" };
  try {
    const raw = await dfsPost("/on_page/raw_html", { id: res.id, url }, { timeoutMs: 60_000, attempts: 2 });
    const html = str(obj(raw.result?.items).html) ?? "";
    return html ? { status, html } : { status, html: "", error: "the page came back empty" };
  } catch { return { status, html: "", error: "the page's HTML couldn't be fetched" }; }
}

/* ------------------------------------------------------------------ parsing */
const num = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : v && typeof v === "object" ? [obj(v)] : []);
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString().slice(0, 10) : null);
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function clean(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENT[e.toLowerCase()] ?? m;
    const hex = e[1] === "x" || e[1] === "X";
    const code = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
    try { return String.fromCodePoint(code); } catch { return m; }
  }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 2000) : null;
}

/** Every schema.org object in the page's JSON-LD (lists and @graph unfolded). */
export function jsonLd(html: string): Json[] {
  const out: Json[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const o = v as Json;
    out.push(o);
    walk(o["@graph"], depth + 1);
    for (const e of arr(o.itemListElement)) walk(e.item ?? e, depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim()), 0); } catch { /* not JSON */ }
  }
  return out;
}

export interface ListingData { name: string | null; phone: string | null; rating: number | null; total: number | null; reviews: PReview[]; faves?: number | null; followers?: number | null }

/** Rating, review count and reviews from schema.org LocalBusiness data (YellowPages, BBB, Houzz, Thumbtack…). */
export function fromSchema(objs: Json[], nap?: Nap | null): ListingData | null {
  const biz = objs.filter((o) => o.aggregateRating || o.review || o.reviews || (o.telephone && o.name));
  if (!biz.length) return null;
  const me = (nap?.digits ? biz.find((o) => digitsOf(str(o.telephone)) === nap.digits) : undefined)
    ?? biz.find((o) => o.aggregateRating || o.review) ?? biz[0];
  const ag = obj(me.aggregateRating);
  const reviews = [...list(me.review), ...list(me.reviews)].map((r): PReview => ({
    id: str(r["@id"]), rating: num(obj(r.reviewRating).ratingValue), author: str(obj(r.author).name) ?? str(r.author),
    date: day(str(r.datePublished) ?? str(r.dateCreated)), title: clean(str(r.name)),
    text: clean(str(r.reviewBody) ?? str(r.description)), reply: null, replyDate: null, url: str(r.url),
  }));
  return { name: str(me.name), phone: str(me.telephone), rating: num(ag.ratingValue), total: num(ag.reviewCount) ?? num(ag.ratingCount) ?? reviews.length, reviews };
}

/** Next.js app-router page data (the strings pushed into self.__next_f), joined. */
function flight(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]) as string; } catch { /* skip a malformed chunk */ }
  }
  return out;
}
/** The JSON array that follows `"key":` in a larger text. */
function arrayAfter(text: string, key: string): unknown[] | null {
  const i = text.indexOf(`"${key}":[`);
  if (i < 0) return null;
  const s = i + key.length + 3;
  let depth = 0, inStr = false, esc = false, e = s;
  for (; e < text.length; e++) {
    const ch = text[e];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 0) { e++; break; } }
  }
  try { const v: unknown = JSON.parse(text.slice(s, e)); return Array.isArray(v) ? v : null; } catch { return null; }
}

/** Angi profile: overall rating, review count and the reviews (with the pro's replies) from the page data. */
export function fromAngi(html: string): ListingData | null {
  const raw = flight(html);
  const at = raw.indexOf('"overallRating":');
  if (at < 0) return null;
  const near = raw.slice(at, at + 800);
  const reviews = (arrayAfter(raw, "reviews") ?? []).map(obj).map((r): PReview => {
    const text = clean(str(r.text));
    return {
      id: str(r.reviewId), rating: num(r.rating), author: str(r.reviewerName), date: day(str(r.dateReviewed)), title: clean(str(r.jobLabel)),
      text: text && !/^unknown$/i.test(text) ? text : null, reply: clean(str(r.responseText)), replyDate: null, url: null,
    };
  });
  return { name: null, phone: null, rating: num(/"overallRating":([\d.]+)/.exec(near)?.[1]), total: num(/"reviewCount":(\d+)/.exec(near)?.[1]) ?? reviews.length, reviews };
}

/** "21h", "3d", "Oct 12" or "Oct 12, 2024" (Nextdoor's age labels) as a date. */
function relDay(t: string, now: number): string | null {
  const m = /^(\d+)\s*(s|m|min|h|hr|d|w|wk|mo|y|yr)s?$/i.exec(t.trim());
  if (m) {
    const unit: Record<string, number> = { s: 1e3, m: 6e4, min: 6e4, h: 3.6e6, hr: 3.6e6, d: 8.64e7, w: 6.048e8, wk: 6.048e8, mo: 2.592e9, y: 3.1536e10, yr: 3.1536e10 };
    return new Date(now - Number(m[1]) * (unit[m[2].toLowerCase()] ?? 0)).toISOString().slice(0, 10);
  }
  if (!t.trim()) return null;
  const d = Date.parse(/\d{4}/.test(t) ? t : `${t} ${new Date(now).getUTCFullYear()}`);
  if (!Number.isFinite(d)) return null;
  return new Date(d > now + 86_400_000 ? d - 3.1536e10 : d).toISOString().slice(0, 10);
}

/** Nextdoor business page: faves (Nextdoor's recommendations), followers and the newest public recommendations. */
export function fromNextdoor(html: string, now: number): ListingData | null {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let data: Json;
  try { data = JSON.parse(m[1]) as Json; } catch { return null; }
  const apollo = obj(obj(obj(data.props).pageProps).apolloState);
  const keys = Object.keys(apollo);
  const page = obj(apollo[keys.find((k) => k.startsWith("EntityPage:")) ?? ""]);
  const biz = obj(apollo[keys.find((k) => k.startsWith("Business:")) ?? ""]);
  if (!keys.length || (!Object.keys(page).length && !Object.keys(biz).length)) return null;
  const faves = num(obj(page.faveCount).value) ?? num(biz.faveCount);
  const reviews: PReview[] = [];
  for (const [k, feed] of Object.entries(obj(apollo.ROOT_QUERY))) {
    if (!k.startsWith("orgPagesFeed(")) continue;
    for (const item of arr(obj(feed).feedItems)) for (const [kk, rf] of Object.entries(item)) {
      if (!kk.startsWith("recommendationsFeed(")) continue;
      for (const r0 of arr(obj(rf).feedItems)) {
        const r = r0.__ref ? obj(apollo[String(r0.__ref)]) : r0;
        // a recommendation made as a reply to a neighbor's post ("Looking for a reliable plumber…") keeps its text in the comment
        const post = obj(apollo[String(obj(r.recFeedPost).__ref ?? "")]);
        const commentsKey = Object.keys(post).find((k) => k.startsWith("comments("));
        const edge = arr(obj(obj(commentsKey ? post[commentsKey] : null).pagedComments).edges)[0];
        const comment = obj(apollo[String(obj(obj(obj(edge).node).comment).__ref ?? "")]);
        const text = clean(str(obj(r.bodyText).text)) ?? clean(str(comment.body));
        if (!text) continue;
        const meta = (str(obj(r.secondaryText).text) ?? "").split("·").map((x) => x.trim());
        const area = meta.length > 1 ? meta[0].replace(/^Nextdoor\s+/i, "") : null;
        const who = str(obj(r.author).displayName);
        const at = num(obj(comment.createdAt).epochMillis);
        reviews.push({
          id: str(r.trackingId) ?? str(r.sourceId), rating: null, author: who && area ? `${who} (${area})` : who,
          date: at ? new Date(at).toISOString().slice(0, 10) : relDay(meta.at(-1) ?? "", now), title: clean(str(post.subject)), text, reply: null, replyDate: null, url: null,
        });
      }
    }
  }
  const ld = jsonLd(html).find((o) => o.telephone || o["@type"] === "LocalBusiness");
  return { name: str(ld?.name) ?? str(page.name), phone: str(ld?.telephone), rating: null, total: null, reviews, faves, followers: num(obj(page.followerCount).value) };
}

/** Parses a listing page of one platform. */
export function parseListing(platform: PlatformKey, html: string, nap: Nap | null, now: number): ListingData | null {
  if (platform === "nextdoor") return fromNextdoor(html, now);
  if (platform === "angi") return fromAngi(html) ?? fromSchema(jsonLd(html), nap);
  return fromSchema(jsonLd(html), nap);
}

/* ------------------------------------------------------------------ finding the listings */
export interface FoundLink { url: string; how: string; rating?: number | null; votes?: number | null }
export interface Discovery {
  at: string; links: Partial<Record<PlatformKey, FoundLink>>; checked: PlatformKey[]; errors: string[]; cost: number;
  nap: { name: string; phone: string | null; city: string | null; state: string | null };
}

const GOOGLE_FIND: { key: PlatformKey; label: string; host: RegExp; path: RegExp }[] = [
  { key: "yelp", label: "Yelp", host: /(^|\.)yelp\.com$/, path: /^\/biz\/[^/?#]+/ },
  { key: "bbb", label: "BBB", host: /(^|\.)bbb\.org$/, path: /\/profile\// },
  { key: "angi", label: "Angi", host: /(^|\.)angi\.com$/, path: /^\/companylist\/us\/.+-reviews-\d+\.htm/ },
  { key: "houzz", label: "Houzz", host: /(^|\.)houzz\.com$/, path: /^\/(professionals|pro)\// },
  { key: "thumbtack", label: "Thumbtack", host: /(^|\.)thumbtack\.com$/, path: /\/(service|pro)\// },
];

/** Google now links results through google.com/goto; one plain request returns the real address in its redirect. */
async function realUrl(u: string): Promise<string | null> {
  let cur = u;
  for (let i = 0; i < 3; i++) {
    let host: string;
    try { host = new URL(cur).hostname; } catch { return null; }
    if (!/(^|\.)google\.[a-z.]+$/.test(host)) return cur;
    try {
      const r = await fetch(cur.replace("://google.", "://www.google."), { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } });
      const loc = r.headers.get("location");
      if (!loc) return null;
      cur = new URL(loc, cur).toString();
    } catch { return null; }
  }
  return null;
}
/** "https://www.yelp.com › biz › name-houston" -> the address, when Google didn't shorten it with "…". */
const fromCrumb = (c: string) => (!c || /\.\.\.|…/.test(c) ? null : c.split("›").map((x) => x.trim()).filter(Boolean).join("/"));

async function googleFind(ctx: Ctx, nap: Nap, p: (typeof GOOGLE_FIND)[number], meter: Meter): Promise<FoundLink | null> {
  await assertBudget(ctx.admin, ctx.clientId, SEARCH_EST, ctx.source);
  const { result, cost } = await dfsPost("/serp/google/organic/live/advanced", {
    keyword: `"${nap.name}" ${p.label}${nap.city ? ` ${nap.city}` : ""}`, location_name: "United States", language_code: "en", depth: 10,
  }, { attempts: 3 });
  if (cost) { meter.cost += cost; await recordSpend(ctx.admin, ctx.clientId, `listing_find_${p.key}`, cost, ctx.source); }
  const want = norm(nap.name);
  for (const it of arr(result?.items)) {
    if (it.type !== "organic") continue;
    const crumb = str(it.breadcrumb) ?? "";
    let hint = str(it.domain) ?? "";
    try { hint = new URL(crumb.split("›")[0].trim()).hostname; } catch { /* keep the domain */ }
    if (!p.host.test(hint.replace(/^www\./, ""))) continue;
    // the listing's own page: its title starts with the business name ("LED Lights and Signs - Houston, TX - Yelp")
    const title = norm(str(it.title));
    if (!want || !(title === want || title.startsWith(`${want} `))) continue;
    let url = str(it.url);
    if (url && /(^|\.)google\.[a-z.]+\//.test(url)) url = (await realUrl(url)) ?? fromCrumb(crumb);
    if (!url) continue;
    let u: URL;
    try { u = new URL(url); } catch { continue; }
    if (!p.host.test(u.hostname.replace(/^www\./, "")) || !p.path.test(u.pathname)) continue;
    const rating = obj(it.rating);
    return { url: `${u.origin}${u.pathname}`, how: "Google search for the business name", rating: num(rating.value), votes: num(rating.votes_count) };
  }
  return null;
}

async function findYellowPages(ctx: Ctx, nap: Nap, meter: Meter): Promise<{ link: FoundLink } | null> {
  const where = [nap.city, nap.state].filter(Boolean).join(", ");
  const term = nap.digits ?? nap.name;
  const page = await openPage(ctx, `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(term)}&geo_location_terms=${encodeURIComponent(where || "United States")}`, "find_yellowpages", meter);
  if (!page.html) return null;
  const items = jsonLd(page.html).filter((o) => o.telephone && o.name);
  const hit = (nap.digits ? items.find((o) => digitsOf(str(o.telephone)) === nap.digits) : undefined)
    ?? items.find((o) => norm(str(o.name)) === norm(nap.name) && (!nap.zip || str(obj(o.address).postalCode) === nap.zip));
  const href = hit ? [str(hit.url), str(hit["@id"])].find((x) => x && /\/mip\//.test(x)) : null;
  if (!href) return null;
  const u = new URL(href, "https://www.yellowpages.com");
  return { link: { url: `https://www.yellowpages.com${u.pathname}`, how: nap.digits ? "YellowPages search by phone" : "YellowPages search by name" } };
}

async function findNextdoor(ctx: Ctx, nap: Nap, meter: Meter): Promise<{ link: FoundLink; page: Page } | null> {
  if (!nap.city || !nap.state) return null;
  const tail = `${slug(nap.city)}-${nap.state.toLowerCase()}`;
  const a = slug(nap.name), b = slug(nap.name.replace(/&/g, " "));
  for (const s of [...new Set([`${a}-${tail}`, `${b}-${tail}`, `${a}-${tail}-1`])].slice(0, 3)) {
    const url = `https://nextdoor.com/pages/${s}/`;
    const page = await openPage(ctx, url, "find_nextdoor", meter);
    if (!page.html) continue;
    const d = fromNextdoor(page.html, Date.now());
    const byPhone = Boolean(nap.digits && digitsOf(d?.phone) === nap.digits);
    if (byPhone || (d?.name && norm(d.name) === norm(nap.name))) return { link: { url, how: byPhone ? "Nextdoor page matched by phone" : "Nextdoor page matched by name" }, page };
  }
  return null;
}

/**
 * Looks for the business on every site without a reviews API (≈$0.04). Pages opened while looking are handed
 * back, so they can be read without opening them a second time.
 */
export async function discover(ctx: Ctx, nap: Nap): Promise<{ discovery: Discovery; pages: Partial<Record<PlatformKey, Page>> }> {
  const meter: Meter = { cost: 0 };
  const links: Discovery["links"] = {};
  const pages: Partial<Record<PlatformKey, Page>> = {};
  const errors: string[] = [];
  let fatal: unknown = null;
  const note = (label: string) => (e: unknown) => {
    if (e instanceof DfsError && (e.kind === "payment" || e.kind === "auth" || e.kind === "config")) fatal ??= e;
    errors.push(`${label}: ${e instanceof BudgetError ? "daily budget reached" : e instanceof Error ? e.message.slice(0, 120) : "failed"}`);
  };
  await Promise.all([
    findYellowPages(ctx, nap, meter).then((f) => { if (f) links.yellowpages = f.link; }, note("YellowPages")),
    findNextdoor(ctx, nap, meter).then((f) => { if (f) { links.nextdoor = f.link; pages.nextdoor = f.page; } }, note("Nextdoor")),
    // staggered: several simultaneous Google searches make the search engine fail some of them (40101)
    ...GOOGLE_FIND.map((p, i) => new Promise((r) => setTimeout(r, i * 1500)).then(() => googleFind(ctx, nap, p, meter))
      .then((f) => { if (f) links[p.key] = f; }, note(p.label))),
  ]);
  if (fatal) throw fatal;
  const checked: PlatformKey[] = ["yellowpages", "nextdoor", ...GOOGLE_FIND.map((p) => p.key)];
  return {
    discovery: {
      at: new Date().toISOString(), links, errors, cost: Number(meter.cost.toFixed(4)),
      checked: checked.filter((k) => links[k] || !errors.some((e) => e.startsWith(labelOf(k)))),
      nap: { name: nap.name, phone: nap.phone, city: nap.city, state: nap.state },
    },
    pages,
  };
}
const labelOf = (k: PlatformKey) => ({ yellowpages: "YellowPages", nextdoor: "Nextdoor" } as Partial<Record<PlatformKey, string>>)[k] ?? GOOGLE_FIND.find((p) => p.key === k)?.label ?? k;

export async function getDiscovery(admin: SupabaseClient, clientId: string): Promise<Discovery | null> {
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  const d = obj(data?.settings).review_found as Discovery | undefined;
  return d && typeof d.at === "string" ? d : null;
}
export async function saveDiscovery(admin: SupabaseClient, clientId: string, d: Discovery) {
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  await admin.from("clients").update({ settings: { ...obj(data?.settings), review_found: d } }).eq("id", clientId);
}
