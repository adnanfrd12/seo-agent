import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOT_UA, findWpApi, wpPages } from "@/lib/blog/wordpress";
import { decodeEntities, htmlToText, servicePages, wordCount } from "@/lib/blog/parse";

/**
 * Free "site scan" behind six Toolkit tools (drift monitor, AI readiness, image audit, hreflang, programmatic
 * planner, e-commerce check). It reads ~25 key pages plus robots.txt / llms.txt from the client's OWN website
 * (honest BOT_UA, 4 requests at a time, no paid API) and stores ONE dfs_cache row per tool (cost 0).
 *
 * Checks, thresholds and severities are adapted from the MIT-licensed claude-seo skills
 * (github.com/AgricIDaniel/claude-seo: seo-drift, seo-agentic, seo-geo, seo-images, seo-hreflang,
 * seo-programmatic, seo-ecommerce). No code or scripts from that repo are used.
 */
export const TK = {
  drift: "tk_seo-drift", ai: "tk_seo-agentic", images: "tk_seo-images", hreflang: "tk_seo-hreflang", programmatic: "tk_seo-programmatic", ecommerce: "tk_seo-ecommerce",
} as const;
export const SCAN_EVERY_DAYS = 7;
const MAX_PAGES = 25;

/* ------------------------------------------------------------------ fetching */
interface Fetched { url: string; status: number | null; finalUrl: string; html: string; headers: Headers | null; ms: number; error?: string }
/** One retry with a longer timeout when the site doesn't answer (slow WordPress hosts time out now and then). */
async function get(url: string, timeoutMs = 20_000, accept = "text/html,*/*;q=0.8"): Promise<Fetched> {
  const r = await getOnce(url, timeoutMs, accept);
  return r.status == null ? getOnce(url, timeoutMs + 20_000, accept) : r;
}
async function getOnce(url: string, timeoutMs = 20_000, accept = "text/html,*/*;q=0.8"): Promise<Fetched> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": BOT_UA, accept }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get("content-type") ?? "";
    const html = /html|xml|text|json/.test(type) ? await res.text() : (await res.body?.cancel(), "");
    return { url, status: res.status, finalUrl: res.url || url, html, headers: res.headers, ms: Date.now() - t0 };
  } catch (e) {
    return { url, status: null, finalUrl: url, html: "", headers: null, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 100) : "fetch failed" };
  }
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/* ------------------------------------------------------------------ parsing */
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null; };
const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
export const pathOfUrl = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/" : x.pathname.replace(/\/$/, ""); } catch { return u; } };

function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { out.push(JSON.parse(m[1].trim())); } catch { /* invalid block */ } }
  return out;
}
function walkLd(v: unknown, fn: (o: Record<string, unknown>) => void) {
  if (Array.isArray(v)) { v.forEach((x) => walkLd(x, fn)); return; }
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  fn(o);
  for (const k of Object.keys(o)) if (k === "@graph" || typeof o[k] === "object") walkLd(o[k], fn);
}
const typesOf = (o: Record<string, unknown>) => { const t = o["@type"]; return (Array.isArray(t) ? t : t ? [t] : []).map(String); };

export interface PageImage { src: string; alt: string | null; width: number | null; height: number | null; loading: string | null; srcset: boolean; format: string; index: number; inPicture: boolean }
export interface Snapshot {
  url: string; status: number | null; finalUrl: string; error?: string;
  title: string | null; desc: string | null; h1: string | null; h1Count: number; canonical: string | null; robots: string | null;
  schema: string[]; words: number; internalLinks: number;
  lang: string | null; hreflang: { lang: string; href: string }[];
  headings: number; questionHeadings: number; paragraphs: number; answerParagraphs: number; lists: number; tables: number;
}
interface Parsed { snap: Snapshot; images: PageImage[]; ld: unknown[]; html: string }

const fmt = (src: string) => { const m = src.toLowerCase().split(/[?#]/)[0].match(/\.(avif|webp|jpe?g|png|gif|svg|bmp|tiff?)$/); return m ? m[1].replace("jpeg", "jpg") : "other"; };

function parse(f: Fetched, host: string): Parsed {
  const html = f.html;
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html;
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (n: string) => { const t = metas.find((x) => (attr(x, "name") ?? attr(x, "property") ?? "").toLowerCase() === n); return t ? attr(t, "content") : null; };
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const canon = links.find((l) => (attr(l, "rel") ?? "").toLowerCase() === "canonical");
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const main = body.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ");
  const h1s = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1]));
  // passage structure is counted in the content only (menus and footers would inflate lists and headings)
  const content = main.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ");
  const heads = [...content.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) => clean(m[1]));
  const paras = [...content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => wordCount(clean(m[1]))).filter((n) => n >= 8);
  let internal = 0;
  for (const m of main.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi)) { try { const u = new URL(decodeEntities(m[1]), f.finalUrl); if (/^https?:$/.test(u.protocol) && bare(u.hostname) === host) internal++; } catch { /* skip */ } }
  const ld = jsonLd(html);
  const schema = new Set<string>();
  ld.forEach((x) => walkLd(x, (o) => typesOf(o).forEach((t) => schema.add(t))));
  const hreflang = links.filter((l) => attr(l, "hreflang")).map((l) => ({ lang: attr(l, "hreflang") ?? "", href: attr(l, "href") ?? "" }));
  const robots = [meta("robots"), f.headers?.get("x-robots-tag")].filter(Boolean).join(", ") || null;
  const canonical = canon ? (() => { try { return new URL(attr(canon, "href") ?? "", f.finalUrl).toString(); } catch { return null; } })() : null;

  const images: PageImage[] = [];
  let idx = 0;
  const pictures = [...main.matchAll(/<picture\b[\s\S]*?<\/picture>/gi)].map((m) => m[0]);
  for (const m of main.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const raw = attr(tag, "data-lazy-src") ?? attr(tag, "data-src") ?? attr(tag, "src") ?? "";
    if (!raw || raw.startsWith("data:")) continue;
    let src: string;
    try { src = new URL(raw, f.finalUrl).toString(); } catch { continue; }
    const lazyClass = /\blazy/i.test(attr(tag, "class") ?? "") || Boolean(attr(tag, "data-src") ?? attr(tag, "data-lazy-src"));
    images.push({
      src, alt: attr(tag, "alt"), width: Number(attr(tag, "width")) || null, height: Number(attr(tag, "height")) || null,
      loading: attr(tag, "loading") ?? (lazyClass ? "lazy (script)" : null), srcset: Boolean(attr(tag, "srcset") ?? attr(tag, "data-srcset")),
      format: fmt(src), index: idx++, inPicture: pictures.some((p) => p.includes(raw)),
    });
  }
  return {
    html, ld, images,
    snap: {
      url: f.url, status: f.status, finalUrl: f.finalUrl, ...(f.error ? { error: f.error } : {}),
      title: title ? clean(title) : null, desc: meta("description"), h1: h1s[0] ?? null, h1Count: h1s.length, canonical, robots,
      schema: [...schema].sort(), words: wordCount(htmlToText(main)), internalLinks: internal,
      lang: html.match(/<html\b[^>]*\blang=["']([^"']+)/i)?.[1] ?? null, hreflang,
      headings: heads.length, questionHeadings: heads.filter((h) => /\?\s*$|^(how|what|why|when|where|which|who|can|do|does|is|are|should)\b/i.test(h)).length,
      paragraphs: paras.length, answerParagraphs: paras.filter((n) => n >= 40 && n <= 170).length,
      lists: [...content.matchAll(/<(ul|ol)\b/gi)].length, tables: [...content.matchAll(/<table\b/gi)].length,
    },
  };
}

/* ------------------------------------------------------------------ page selection */
async function keyPages(admin: SupabaseClient, clientId: string, origin: string, host: string, extra: string[]): Promise<string[]> {
  const { data } = await admin.from("dfs_cache").select("endpoint, data").eq("client_id", clientId).in("endpoint", ["relevant_pages", "tech_checks"]).order("fetched_at", { ascending: false }).limit(10);
  const rows = data ?? [];
  const rel = (rows.find((r) => r.endpoint === "relevant_pages")?.data as { rows?: { page: string | null; traffic: number | null }[] } | undefined)?.rows ?? [];
  const tech = (rows.find((r) => r.endpoint === "tech_checks")?.data as { pages?: { url: string }[] } | undefined)?.pages ?? [];
  const want = [`${origin}/`, ...rel.filter((r) => r.page).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)).slice(0, 10).map((r) => r.page!), ...extra.slice(0, 10), ...tech.map((t) => t.url)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of want) {
    try {
      const x = new URL(u.startsWith("http") ? u : `https://${u}`);
      if (bare(x.hostname) !== host) continue;
      const key = x.pathname.replace(/\/$/, "") || "/";
      if (seen.has(key) || /\.(pdf|jpe?g|png|webp|xml)$/i.test(key)) continue;
      seen.add(key);
      out.push(`${origin}${x.pathname}`);
    } catch { /* skip */ }
    if (out.length >= MAX_PAGES) break;
  }
  return out;
}

/* ------------------------------------------------------------------ drift */
export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";
export interface DriftChange { url: string; field: string; before: string; after: string; severity: Severity; detected: string; vs: "previous" | "baseline" }
export interface DriftData { baselineAt: string; checkedAt: string; checks: string[]; baseline: Record<string, Snapshot>; latest: Record<string, Snapshot>; changes: DriftChange[] }

const show = (v: unknown) => (v == null || v === "" ? "(none)" : Array.isArray(v) ? (v.length ? v.join(", ") : "(none)") : String(v));
/** Field-by-field comparison; severities follow the claude-seo seo-drift rules (indexability > canonical/schema > title/H1 > description). */
export function diffSnap(a: Snapshot, b: Snapshot): Omit<DriftChange, "url" | "detected" | "vs">[] {
  const out: Omit<DriftChange, "url" | "detected" | "vs">[] = [];
  const add = (field: string, before: unknown, after: unknown, severity: Severity) => out.push({ field, before: show(before), after: show(after), severity });
  if (a.status !== b.status) add("HTTP status", a.status, b.status, b.status === 200 ? "Info" : "Critical");
  if (b.status !== 200 || a.status !== 200) return out;
  const noindex = (s: Snapshot) => /noindex/i.test(s.robots ?? "");
  if (noindex(a) !== noindex(b)) add("Meta robots", a.robots, b.robots, noindex(b) ? "Critical" : "Info");
  else if ((a.robots ?? "") !== (b.robots ?? "")) add("Meta robots", a.robots, b.robots, "Low");
  if ((a.canonical ?? "").replace(/\/$/, "") !== (b.canonical ?? "").replace(/\/$/, "")) add("Canonical", a.canonical, b.canonical, b.canonical ? "High" : "Critical");
  const removed = a.schema.filter((t) => !b.schema.includes(t)), added = b.schema.filter((t) => !a.schema.includes(t));
  if (removed.length) add("Schema removed", removed, b.schema, "High");
  if (added.length) add("Schema added", a.schema, added, "Info");
  if ((a.title ?? "") !== (b.title ?? "")) add("Title", a.title, b.title, b.title ? "Medium" : "High");
  if ((a.h1 ?? "") !== (b.h1 ?? "")) add("H1", a.h1, b.h1, b.h1 ? "Medium" : "High");
  if ((a.desc ?? "") !== (b.desc ?? "")) add("Meta description", a.desc, b.desc, "Low");
  if (a.words >= 150 && b.words < a.words * 0.7) add("Word count", a.words, b.words, "High");
  else if (Math.abs(b.words - a.words) > Math.max(80, a.words * 0.2)) add("Word count", a.words, b.words, "Low");
  if (a.internalLinks >= 10 && b.internalLinks < a.internalLinks * 0.7) add("Internal links", a.internalLinks, b.internalLinks, "Medium");
  return out;
}

/* ------------------------------------------------------------------ AI readiness */
export const AI_BOTS = [
  { ua: "GPTBot", owner: "OpenAI", purpose: "training" }, { ua: "OAI-SearchBot", owner: "OpenAI", purpose: "search" }, { ua: "ChatGPT-User", owner: "OpenAI", purpose: "user fetch" },
  { ua: "ClaudeBot", owner: "Anthropic", purpose: "training" }, { ua: "Claude-SearchBot", owner: "Anthropic", purpose: "search" }, { ua: "Claude-User", owner: "Anthropic", purpose: "user fetch" },
  { ua: "PerplexityBot", owner: "Perplexity", purpose: "search" }, { ua: "Perplexity-User", owner: "Perplexity", purpose: "user fetch" },
  { ua: "Google-Extended", owner: "Google", purpose: "Gemini training" }, { ua: "Applebot-Extended", owner: "Apple", purpose: "training" },
  { ua: "Meta-ExternalAgent", owner: "Meta", purpose: "training" }, { ua: "Amazonbot", owner: "Amazon", purpose: "search" },
  { ua: "CCBot", owner: "Common Crawl", purpose: "training" }, { ua: "Bytespider", owner: "ByteDance", purpose: "training" },
] as const;
export interface BotRule { ua: string; owner: string; purpose: string; group: string; access: "allowed" | "blocked" | "partial" }
export interface AiReady {
  checkedAt: string; origin: string; siteName: string | null;
  llms: { status: number | null; present: boolean; bytes: number; hasH1: boolean; hasSummary: boolean; links: number; sections: number; full: boolean };
  robots: { status: number | null; contentSignal: string | null; bots: BotRule[] };
  entity: { types: string[]; name: string | null; sameAs: string[]; hasAddress: boolean; hasPhone: boolean; hasLogo: boolean; hasGeo: boolean };
  pages: { url: string; title: string | null; words: number; headings: number; questionHeadings: number; answerParagraphs: number; lists: number; tables: number; faq: boolean; citability: number }[];
  draft: string;
}

function robotsRules(txt: string): Map<string, { allow: string[]; disallow: string[] }> {
  const groups = new Map<string, { allow: string[]; disallow: string[] }>();
  let agents: string[] = [], inRules = false;
  for (const line of txt.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2];
    if (k === "user-agent") { if (inRules) { agents = []; inRules = false; } agents.push(v.toLowerCase()); for (const a of agents) if (!groups.has(a)) groups.set(a, { allow: [], disallow: [] }); }
    else if (k === "allow" || k === "disallow") { inRules = true; for (const a of agents) { const g = groups.get(a)!; if (v) (k === "allow" ? g.allow : g.disallow).push(v); } }
  }
  return groups;
}

/** Passage citability 0-100 (seo-geo): self-contained 40-170 word answer blocks, question headings, lists/tables, FAQ data, length. */
function citability(s: Snapshot, faq: boolean): number {
  let x = 0;
  x += Math.min(30, s.answerParagraphs * 6);
  x += Math.min(20, s.questionHeadings * 7);
  x += Math.min(15, s.headings * 2);
  x += s.lists + s.tables > 0 ? 10 : 0;
  x += faq ? 10 : 0;
  x += s.words >= 600 ? 15 : s.words >= 300 ? 8 : 0;
  return Math.min(100, x);
}

/* ------------------------------------------------------------------ images */
export interface ImageRow { src: string; page: string; alt: string | null; width: number | null; height: number | null; loading: string | null; srcset: boolean; format: string; aboveFold: boolean; bytes: number | null; inPicture: boolean }
export interface ImageAudit { checkedAt: string; pages: number; images: ImageRow[] }

/* ------------------------------------------------------------------ programmatic */
export interface ProgrammaticData { checkedAt: string; wp: boolean; services: { path: string; url: string; title: string }[]; otherPages: string[]; sitemapUrls: number }

/* ------------------------------------------------------------------ run */
const save = (admin: SupabaseClient, clientId: string, endpoint: string, data: unknown, rows: number, at: string) =>
  admin.from("dfs_cache").upsert({ client_id: clientId, endpoint, params_hash: endpoint, params: {}, data, row_count: rows, cost: 0, fetched_at: at }, { onConflict: "client_id,endpoint,params_hash" });

export async function loadScan<T>(supabase: SupabaseClient, clientId: string, endpoint: string): Promise<{ data: T; fetchedAt: string } | null> {
  const { data } = await supabase.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", endpoint).eq("params_hash", endpoint).maybeSingle();
  return data ? { data: data.data as T, fetchedAt: data.fetched_at as string } : null;
}

export interface ScanResult { pages: number; changes: number; images: number; services: number }

/** Reads the key pages once and refreshes all six tool rows. `resetBaseline` starts a fresh drift baseline. */
export async function runSiteScan(admin: SupabaseClient, clientId: string, domain: string, opts: { resetBaseline?: boolean } = {}): Promise<ScanResult> {
  const now = new Date().toISOString();
  const home = await get(`https://${domain}/`);
  const origin = (() => { try { return new URL(home.finalUrl).origin; } catch { return `https://${domain}`; } })();
  const host = bare(new URL(origin).hostname);

  // WordPress service pages (free REST API) feed both the page sample and the programmatic planner
  const wpBase = await findWpApi(origin).catch(() => null);
  const wpList = wpBase ? await wpPages(wpBase).catch(() => []) : [];
  const sp = servicePages(wpList, host);
  const services = [...sp.services.entries()].map(([path, v]) => ({ path, url: v.url, title: decodeEntities(v.title) }));

  const urls = await keyPages(admin, clientId, origin, host, services.map((s) => s.url));
  const fetched = await pool(urls, 4, (u) => (u === `${origin}/` && home.status ? Promise.resolve({ ...home, url: u }) : get(u)));
  const parsed = fetched.map((f) => parse(f, host));

  /* drift */
  const stored = (await loadScan<DriftData>(admin, clientId, TK.drift))?.data ?? null;
  // a reset keeps the change log and check dates but makes today's pages the new reference
  const prev = stored && opts.resetBaseline ? { ...stored, baseline: {}, latest: {}, baselineAt: now } : stored;
  const latest: Record<string, Snapshot> = Object.fromEntries(parsed.map((p) => [p.snap.url, p.snap]));
  const baseline: Record<string, Snapshot> = { ...(prev?.baseline ?? {}) };
  const changes: DriftChange[] = [];
  for (const p of parsed) {
    const s = p.snap;
    // a network timeout is not a regression: keep the last good snapshot and compare next time
    if (s.status == null) { const last = prev?.latest[s.url]; if (last) latest[s.url] = last; continue; }
    if (!baseline[s.url] || baseline[s.url].status == null) { baseline[s.url] = s; continue; }
    const before = prev?.latest[s.url] ?? baseline[s.url];
    for (const c of diffSnap(before, s)) changes.push({ ...c, url: s.url, detected: now, vs: "previous" });
  }
  const drift: DriftData = {
    baselineAt: prev?.baselineAt ?? now, checkedAt: now, checks: [now, ...(prev?.checks ?? [])].slice(0, 26), baseline, latest,
    changes: [...changes, ...(prev?.changes ?? [])].filter((c) => !(c.field === "HTTP status" && (c.before === "(none)" || c.after === "(none)")) && Date.parse(c.detected) > Date.now() - 180 * 86_400_000).slice(0, 400),
  };

  /* AI readiness */
  const [llms, llmsFull, robots] = await Promise.all([get(`${origin}/llms.txt`, 15_000, "text/plain,*/*"), get(`${origin}/llms-full.txt`, 15_000, "text/plain,*/*"), get(`${origin}/robots.txt`, 15_000, "text/plain,*/*")]);
  const llmsOk = llms.status === 200 && !/<html/i.test(llms.html.slice(0, 500)) && llms.html.trim().length > 0;
  const rules = robots.status === 200 ? robotsRules(robots.html) : new Map<string, { allow: string[]; disallow: string[] }>();
  const bots: BotRule[] = AI_BOTS.map((b) => {
    const key = [...rules.keys()].find((k) => k !== "*" && b.ua.toLowerCase() === k) ?? ([...rules.keys()].includes("*") ? "*" : null);
    const g = key ? rules.get(key)! : { allow: [], disallow: [] };
    const all = g.disallow.includes("/") && !g.allow.includes("/");
    return { ...b, group: key ?? "(no rule)", access: all ? "blocked" : g.disallow.length && key !== "*" ? "partial" : "allowed" };
  });
  const homeP = parsed.find((p) => p.snap.url === `${origin}/` && p.snap.status === 200) ?? parsed.find((p) => p.snap.status === 200);
  const ents: Record<string, unknown>[] = [];
  homeP?.ld.forEach((x) => walkLd(x, (o) => { if (typesOf(o).some((t) => /Organization|LocalBusiness|Store|Contractor|Service$|Corporation/i.test(t)) && !typesOf(o).includes("WebSite")) ents.push(o); }));
  const ent = ents.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0] ?? null;
  const sameAs = ent ? ([] as unknown[]).concat(ent.sameAs ?? []).map(String) : [];
  const siteName = (ent?.name as string | undefined) ?? homeP?.snap.title?.split(/[|\-–]/).pop()?.trim() ?? domain;
  const ai: AiReady = {
    checkedAt: now, origin, siteName,
    llms: { status: llms.status, present: llmsOk, bytes: llmsOk ? llms.html.length : 0, hasH1: llmsOk && /^#\s+\S/m.test(llms.html), hasSummary: llmsOk && /^>\s+\S/m.test(llms.html), links: llmsOk ? [...llms.html.matchAll(/\]\(https?:\/\//g)].length : 0, sections: llmsOk ? [...llms.html.matchAll(/^##\s+/gm)].length : 0, full: llmsFull.status === 200 && !/<html/i.test(llmsFull.html.slice(0, 500)) && llmsFull.html.length > 0 },
    robots: { status: robots.status, contentSignal: robots.html.match(/^\s*content-signal\s*:\s*(.+)$/im)?.[1]?.trim() ?? null, bots },
    entity: { types: ent ? typesOf(ent) : [], name: (ent?.name as string | undefined) ?? null, sameAs, hasAddress: Boolean(ent?.address), hasPhone: Boolean(ent?.telephone), hasLogo: Boolean(ent?.logo ?? ent?.image), hasGeo: Boolean(ent?.geo ?? ent?.areaServed) },
    pages: parsed.filter((p) => p.snap.status === 200).slice(0, 15).map((p) => {
      const faq = p.snap.schema.includes("FAQPage");
      return { url: p.snap.url, title: p.snap.title, words: p.snap.words, headings: p.snap.headings, questionHeadings: p.snap.questionHeadings, answerParagraphs: p.snap.answerParagraphs, lists: p.snap.lists, tables: p.snap.tables, faq, citability: citability(p.snap, faq) };
    }),
    draft: "",
  };
  const desc = homeP?.snap.desc ?? `${siteName} website.`;
  const line = (p: Parsed) => `- [${p.snap.title?.split(/\s[|\-–]\s/)[0] ?? pathOfUrl(p.snap.url)}](${p.snap.url})${p.snap.desc ? `: ${p.snap.desc}` : ""}`;
  const svcSet = new Set(services.map((s) => s.url.replace(/\/$/, "")));
  const ok = parsed.filter((p) => p.snap.status === 200 && p !== homeP);
  ai.draft = [
    `# ${siteName}`, "", `> ${desc}`, "",
    ent?.address ? `Address: ${[(ent.address as Record<string, unknown>).streetAddress, (ent.address as Record<string, unknown>).addressLocality, (ent.address as Record<string, unknown>).addressRegion].filter(Boolean).join(", ")}` : "",
    ent?.telephone ? `Phone: ${String(ent.telephone)}` : "", "",
    "## Services", ...ok.filter((p) => svcSet.has(p.snap.url.replace(/\/$/, ""))).map(line), "",
    "## Key pages", `- [Home](${origin}/): ${desc}`, ...ok.filter((p) => !svcSet.has(p.snap.url.replace(/\/$/, ""))).slice(0, 12).map(line), "",
    sameAs.length ? "## Profiles" : "", ...sameAs.map((s) => `- ${s}`),
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim() + "\n";

  /* images: dedupe, size the first 80 unique files with HEAD requests */
  const rowsImg: ImageRow[] = [];
  for (const p of parsed) for (const im of p.images) rowsImg.push({ src: im.src, page: p.snap.url, alt: im.alt, width: im.width, height: im.height, loading: im.loading, srcset: im.srcset, format: im.format, aboveFold: im.index < 2, bytes: null, inPicture: im.inPicture });
  const uniq = [...new Set(rowsImg.map((r) => r.src))].slice(0, 80);
  const sizes = new Map<string, number | null>();
  await pool(uniq, 6, async (u) => {
    try {
      const r = await fetch(u, { method: "HEAD", headers: { "user-agent": BOT_UA }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      sizes.set(u, Number(r.headers.get("content-length")) || null);
    } catch { sizes.set(u, null); }
  });
  for (const r of rowsImg) r.bytes = sizes.get(r.src) ?? null;
  const images: ImageAudit = { checkedAt: now, pages: parsed.length, images: rowsImg.slice(0, 1000) };

  /* hreflang + lang */
  const hreflang = { checkedAt: now, pages: parsed.map((p) => ({ url: p.snap.url, status: p.snap.status, lang: p.snap.lang, hreflang: p.snap.hreflang, contentLanguage: p.snap.status === 200 ? fetched.find((f) => f.url === p.snap.url)?.headers?.get("content-language") ?? null : null })) };

  /* e-commerce detection (seo-ecommerce applies only with a product catalogue) */
  const wc = wpBase ? await get(`${origin}/wp-json/wc/store/v1/products?per_page=1`, 10_000, "application/json") : null;
  const productSchema = parsed.some((p) => p.snap.schema.some((t) => /^(Product|Offer|AggregateOffer|ProductGroup)$/.test(t)));
  const wooMarkup = parsed.some((p) => /woocommerce|wc-block|add_to_cart/i.test(p.html.slice(0, 400_000)));
  const ecommerce = { checkedAt: now, wooApi: wc ? wc.status === 200 && wc.html.trim().startsWith("[") && wc.html.trim() !== "[]" : false, wooApiStatus: wc?.status ?? null, productSchema, wooMarkup, pagesChecked: parsed.length };

  const programmatic: ProgrammaticData = { checkedAt: now, wp: Boolean(wpBase), services, otherPages: [...sp.pages], sitemapUrls: 0 };

  await Promise.all([
    save(admin, clientId, TK.drift, drift, parsed.length, now), save(admin, clientId, TK.ai, ai, ai.pages.length, now),
    save(admin, clientId, TK.images, images, images.images.length, now), save(admin, clientId, TK.hreflang, hreflang, parsed.length, now),
    save(admin, clientId, TK.programmatic, programmatic, services.length, now), save(admin, clientId, TK.ecommerce, ecommerce, 1, now),
  ]);
  return { pages: parsed.length, changes: changes.length, images: images.images.length, services: services.length };
}

/** Epoch ms n days ago (kept out of components so render stays pure for the linter). */
export const daysAgo = (n: number) => Date.now() - n * 86_400_000;
