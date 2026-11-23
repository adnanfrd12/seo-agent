import "server-only";
import { gsc, type GscCtx } from "./api";

/**
 * The URL inventory: every URL in the submitted sitemaps (indexes read recursively) and every page Search
 * Console shows, each fetched by our crawler (status, redirect, canonical, robots, title, headings, words,
 * internal links, JSON-LD) and checked with the URL Inspection API in a quota-aware rotating queue.
 */
export interface SitemapInfo { path: string; type: string; isPending: boolean; isIndex: boolean; lastSubmitted: string | null; lastDownloaded: string | null; errors: number; warnings: number; submitted: number; urls: string[] }
export interface Crawl { status: number | null; redirect: string | null; canonical: string | null; robots: string | null; xRobots: string | null; title: string | null; desc: string | null; h1: string | null; headings: string[]; words: number; links: string[]; schema: string[]; ms: number | null; at: string }
export interface Inspection {
  at: string; verdict: string; coverageState: string; robotsTxtState: string; indexingState: string; pageFetchState: string; lastCrawlTime: string | null; crawledAs: string | null;
  googleCanonical: string | null; userCanonical: string | null; sitemap: string[]; referringUrls: string[];
  rich: { type: string; items: number; warnings: number; errors: number; issues: { message: string; severity: string }[] }[];
}
export interface InventoryRow { url: string; sources: string[]; sitemaps: string[]; crawl: Crawl | null }

const UA = "Mozilla/5.0 (compatible; SEO-Insights-dashboard/1.0)";
const norm = (u: string) => { try { const x = new URL(u.trim()); x.hash = ""; x.hostname = x.hostname.toLowerCase(); return x.toString(); } catch { return u.trim(); } };
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8211;/g, "–").replace(/&#8217;/g, "’").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const text = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function fetchText(url: string, ms = 15_000): Promise<{ status: number; body: string; final: string; redirected: boolean; headers: Headers; ms: number } | null> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    return { status: r.status, body: (await r.text()).slice(0, 2_500_000), final: r.url, redirected: r.redirected, headers: r.headers, ms: Date.now() - t0 };
  } catch { return null; }
}

/** sitemaps.list plus the URLs inside each sitemap (indexes followed). */
export async function readSitemaps(ctx: GscCtx): Promise<SitemapInfo[]> {
  const res = await gsc(ctx, "GOOGLE_SEARCH_CONSOLE_LIST_SITEMAPS", {});
  const list = (res.sitemap as Record<string, unknown>[] | undefined) ?? [];
  const out: SitemapInfo[] = [];
  for (const s of list) {
    const contents = (s.contents as { type?: string; submitted?: string }[] | undefined) ?? [];
    const info: SitemapInfo = {
      path: String(s.path), type: String(s.type ?? "sitemap"), isPending: Boolean(s.isPending), isIndex: Boolean(s.isSitemapsIndex),
      lastSubmitted: (s.lastSubmitted as string) ?? null, lastDownloaded: (s.lastDownloaded as string) ?? null,
      errors: Number(s.errors ?? 0), warnings: Number(s.warnings ?? 0), submitted: Number(contents.find((c) => c.type === "web")?.submitted ?? 0), urls: [],
    };
    const seen = new Set<string>();
    const walk = async (u: string, depth: number) => {
      if (seen.has(u) || depth > 3 || seen.size > 60) return;
      seen.add(u);
      const r = await fetchText(u, 20_000);
      if (!r || r.status >= 400) return;
      const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
      if (/<sitemapindex/i.test(r.body)) { for (const l of locs.slice(0, 50)) await walk(l, depth + 1); }
      else info.urls.push(...locs.filter((l) => !/\.(jpe?g|png|gif|webp|svg|pdf)$/i.test(l)).map(norm));
    };
    await walk(info.path, 0);
    info.urls = [...new Set(info.urls)].slice(0, 5000);
    out.push(info);
  }
  return out;
}

/** Fetches one URL like a crawler: what Google would read on it. */
export async function crawlUrl(url: string, host: string): Promise<Crawl> {
  const at = new Date().toISOString();
  const r = await fetchText(url);
  if (!r) return { status: null, redirect: null, canonical: null, robots: null, xRobots: null, title: null, desc: null, h1: null, headings: [], words: 0, links: [], schema: [], ms: null, at };
  const h = r.body;
  const head = h.slice(0, 200_000);
  const meta = (name: string) => decode(head.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ?? head.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`, "i"))?.[1] ?? "") || null;
  const canonical = head.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? head.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1] ?? null;
  const body = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ");
  const main = body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body.match(/<body[\s\S]*<\/body>/i)?.[0] ?? body;
  const links = [...new Set([...h.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map((m) => { try { const u = new URL(decode(m[1]), r.final); return u.hostname.replace(/^www\./, "") === host ? norm(u.origin + u.pathname) : null; } catch { return null; } }).filter((x): x is string => !!x))];
  const schema = [...new Set([...h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => [...m[1].matchAll(/"@type"\s*:\s*(?:"([^"]+)"|\[([^\]]+)\])/g)].map((t) => (t[1] ?? t[2] ?? "").replace(/"/g, "").trim())))].filter(Boolean).slice(0, 20);
  return {
    status: r.status, redirect: r.redirected ? norm(r.final) : null, canonical: canonical ? norm(new URL(decode(canonical), r.final).toString()) : null,
    robots: meta("robots"), xRobots: r.headers.get("x-robots-tag"), title: text(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null, desc: meta("description"),
    h1: text(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") || null,
    headings: [...body.matchAll(/<h([2-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => text(m[2])).filter(Boolean).slice(0, 60),
    words: text(main).split(" ").filter((w) => /[a-z]/i.test(w)).length, links, schema, ms: r.ms, at,
  };
}

/** One URL Inspection API call, reduced to the fields the reports use. */
export async function inspect(ctx: GscCtx, url: string): Promise<Inspection> {
  const res = await gsc(ctx, "GOOGLE_SEARCH_CONSOLE_INSPECT_URL", { inspection_url: url, language_code: "en-US" }, 60_000);
  const ir = (res.inspectionResult ?? {}) as Record<string, unknown>;
  const ix = (ir.indexStatusResult ?? {}) as Record<string, unknown>;
  const rr = (ir.richResultsResult ?? {}) as { detectedItems?: { richResultType?: string; items?: { issues?: { issueMessage?: string; severity?: string }[] }[] }[] };
  return {
    at: new Date().toISOString(), verdict: String(ix.verdict ?? "VERDICT_UNSPECIFIED"), coverageState: String(ix.coverageState ?? "URL is unknown to Google"),
    robotsTxtState: String(ix.robotsTxtState ?? ""), indexingState: String(ix.indexingState ?? ""), pageFetchState: String(ix.pageFetchState ?? ""),
    lastCrawlTime: (ix.lastCrawlTime as string) ?? null, crawledAs: (ix.crawledAs as string) ?? null,
    googleCanonical: (ix.googleCanonical as string) ?? null, userCanonical: (ix.userCanonical as string) ?? null,
    sitemap: (ix.sitemap as string[]) ?? [], referringUrls: ((ix.referringUrls as string[]) ?? []).slice(0, 10),
    rich: (rr.detectedItems ?? []).map((d) => {
      const issues = (d.items ?? []).flatMap((i) => i.issues ?? []).map((x) => ({ message: x.issueMessage ?? "", severity: x.severity ?? "" }));
      const errs = (d.items ?? []).filter((i) => (i.issues ?? []).some((x) => x.severity === "ERROR")).length;
      return { type: d.richResultType ?? "Unknown", items: (d.items ?? []).length, warnings: (d.items ?? []).filter((i) => (i.issues ?? []).some((x) => x.severity === "WARNING")).length - 0, errors: errs, issues: issues.slice(0, 20) };
    }),
  };
}
