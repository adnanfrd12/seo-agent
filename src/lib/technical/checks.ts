import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOT_UA } from "@/lib/blog/wordpress";

/**
 * Free technical checks read straight from the client's own website (no paid API): robots.txt, XML sitemaps,
 * HTTPS / HSTS, and a small sample of pages (at most MAX_PAGES) for titles, descriptions, headings, canonical,
 * meta robots, structured data, hreflang, mixed content, viewport, image alt text and redirect chains.
 * Requests identify themselves honestly (BOT_UA) and run a few at a time. Stored as ONE dfs_cache row
 * (endpoint "tech_checks", cost 0) and refreshed weekly by the research cron or on demand by an owner.
 */
export const TECH_ENDPOINT = "tech_checks";
export const TECH_EVERY_DAYS = 7;
const MAX_PAGES = 25;

export interface TechPage {
  url: string; finalUrl: string | null; status: number | null; hops: number; ms: number | null; error?: string;
  title: string | null; titleLen: number; desc: string | null; descLen: number; h1: number; words: number;
  canonical: string | null; noindex: boolean; schema: string[]; hreflang: number; mixed: number;
  viewport: boolean; lang: boolean; imgs: number; imgNoAlt: number; inSitemap: boolean;
}
export interface TechSitemap { url: string; status: number | null; valid: boolean; urls: number; index: boolean }
export interface TechChecks {
  checkedAt: string; domain: string; origin: string;
  robots: { status: number | null; disallowAll: boolean; sitemaps: string[]; disallows: string[] };
  sitemaps: TechSitemap[]; sitemapUrls: number; sitemapSample: string[];
  https: { httpToHttps: boolean | null; hsts: string | null; wwwConsistent: boolean | null; headers?: { xcto: boolean; xfo: boolean; referrer: boolean; csp: boolean } };
  pages: TechPage[];
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8211;|&ndash;/g, "-").replace(/&#8217;/g, "'").replace(/&nbsp;/g, " ").trim();
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i")); return m ? decode(m[2] ?? m[3] ?? "") : null; };
const norm = (u: string) => { try { const x = new URL(u); return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`.toLowerCase(); } catch { return u; } };

/** GET with manual redirects so chains can be counted (max 6 hops); one retry when the site doesn't answer. */
async function fetchChain(url: string, timeoutMs = 20_000): ReturnType<typeof fetchOnce> {
  const r = await fetchOnce(url, timeoutMs);
  return r.status == null ? fetchOnce(url, timeoutMs + 10_000) : r;
}
async function fetchOnce(url: string, timeoutMs = 20_000): Promise<{ status: number | null; finalUrl: string; hops: number; body: string; headers: Headers | null; ms: number; error?: string }> {
  let cur = url, hops = 0;
  const t0 = Date.now();
  try {
    for (;;) {
      const res = await fetch(cur, { headers: { "user-agent": BOT_UA, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc && hops < 6) { hops++; cur = new URL(loc, cur).toString(); await res.body?.cancel(); continue; }
      const body = (res.headers.get("content-type") ?? "").match(/html|xml|text/) ? await res.text() : (await res.body?.cancel(), "");
      return { status: res.status, finalUrl: cur, hops, body, headers: res.headers, ms: Date.now() - t0 };
    }
  } catch (e) {
    return { status: null, finalUrl: cur, hops, body: "", headers: null, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 120) : "fetch failed" };
  }
}

function schemaTypes(html: string): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.add(t); else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
    for (const k of ["@graph", "mainEntity", "itemListElement", "publisher", "author"]) if (k in o) walk(o[k]);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1].trim())); } catch { /* invalid JSON-LD is ignored */ } }
  if (/itemtype=["']https?:\/\/schema\.org\/(\w+)/i.test(html)) for (const m of html.matchAll(/itemtype=["']https?:\/\/schema\.org\/(\w+)/gi)) out.add(m[1]);
  return [...out];
}

export function analysePage(url: string, html: string, origin: string): Omit<TechPage, "url" | "finalUrl" | "status" | "hops" | "ms" | "inSitemap"> {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html.slice(0, 60_000);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (n: string) => { const t = metas.find((x) => (attr(x, "name") ?? attr(x, "property") ?? "").toLowerCase() === n); return t ? attr(t, "content") : null; };
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const canon = links.find((l) => (attr(l, "rel") ?? "").toLowerCase() === "canonical");
  const robots = `${meta("robots") ?? ""} ${meta("googlebot") ?? ""}`.toLowerCase();
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ");
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const secure = origin.startsWith("https:");
  const mixed = secure ? [...html.matchAll(/<(?:img|script|iframe|source|video|audio)\b[^>]*\ssrc=["']http:\/\/[^"']+/gi)].length + [...head.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']http:\/\/[^"']+/gi)].length : 0;
  const t = title ? decode(title.replace(/\s+/g, " ")) : null;
  const d = meta("description");
  return {
    title: t, titleLen: t?.length ?? 0, desc: d, descLen: d?.length ?? 0,
    h1: [...body.matchAll(/<h1\b/gi)].length,
    words: decode(text).split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length,
    canonical: canon ? (() => { try { return new URL(attr(canon, "href") ?? "", url).toString(); } catch { return null; } })() : null,
    noindex: /noindex/.test(robots), schema: schemaTypes(html),
    hreflang: links.filter((l) => attr(l, "hreflang")).length, mixed,
    viewport: Boolean(meta("viewport")), lang: /<html\b[^>]*\blang=["'][^"']+/i.test(html),
    imgs: imgs.length, imgNoAlt: imgs.filter((i) => attr(i, "alt") === null).length,
  };
}

async function readSitemaps(start: string[]): Promise<{ maps: TechSitemap[]; urls: string[] }> {
  const queue = [...new Set(start)];
  const maps: TechSitemap[] = [];
  const urls: string[] = [];
  while (queue.length && maps.length < 12) {
    const u = queue.shift()!;
    const r = await fetchChain(u, 15_000);
    const isIndex = /<sitemapindex/i.test(r.body);
    const locs = [...r.body.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1]));
    const valid = r.status === 200 && (isIndex || /<urlset/i.test(r.body));
    maps.push({ url: u, status: r.status, valid, urls: isIndex ? 0 : locs.length, index: isIndex });
    if (isIndex) {
      for (const l of locs) if (!maps.some((m) => m.url === l) && !queue.includes(l)) queue.push(l);
    } else urls.push(...locs);
  }
  return { maps, urls: [...new Set(urls)] };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/** Runs every check for one client and stores the result (free). `extraUrls` are important pages (traffic, Lighthouse). */
export async function runTechnicalChecks(admin: SupabaseClient, clientId: string, domain: string): Promise<TechChecks> {
  const home = await fetchChain(`https://${domain}/`);
  const origin = (() => { try { return new URL(home.finalUrl).origin; } catch { return `https://${domain}`; } })();

  // robots.txt
  const rb = await fetchChain(`${origin}/robots.txt`, 15_000);
  const lines = rb.status === 200 ? rb.body.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean) : [];
  let agentAll = false;
  const disallows: string[] = [];
  for (const l of lines) {
    const [k, ...rest] = l.split(":"); const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k.trim())) agentAll = v === "*";
    else if (agentAll && /^disallow$/i.test(k.trim()) && v) disallows.push(v);
  }
  const robotsMaps = lines.filter((l) => /^sitemap\s*:/i.test(l)).map((l) => l.replace(/^sitemap\s*:/i, "").trim());

  // sitemaps (the ones robots.txt names, else the usual WordPress / generic locations)
  let sm = await readSitemaps(robotsMaps.length ? robotsMaps : [`${origin}/sitemap_index.xml`]);
  if (!sm.maps.some((m) => m.valid)) { const alt = await readSitemaps([`${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`]); if (alt.maps.some((m) => m.valid)) sm = { maps: [...sm.maps, ...alt.maps], urls: alt.urls }; }
  const inMap = new Set(sm.urls.map(norm));

  // HTTPS: does plain http redirect to https; HSTS header; does the other www variant land on the same host
  const http = await fetchChain(`http://${domain}/`, 15_000);
  const alt = domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`;
  const other = await fetchChain(`https://${alt}/`, 15_000);
  const host = (u: string) => { try { return new URL(u).host; } catch { return ""; } };

  // the page sample: home, the client's most important pages (traffic, Lighthouse), then sitemap pages spread across sections
  const { data: cached } = await admin.from("dfs_cache").select("endpoint, data").eq("client_id", clientId).in("endpoint", ["relevant_pages", "lighthouse", "audit"]).order("fetched_at", { ascending: false }).limit(30);
  const rel = ((cached ?? []).find((r) => r.endpoint === "relevant_pages")?.data ?? []) as { page: string | null; traffic: number | null }[];
  const lh = (cached ?? []).filter((r) => r.endpoint === "lighthouse").flatMap((r) => ((r.data as { rows?: { url: string }[] }).rows ?? []).map((x) => x.url));
  const audit = (cached ?? []).find((r) => r.endpoint === "audit")?.data as { rows?: { url: string; status: number | null; depth: number | null }[] } | undefined;
  const sameSite = (u: string) => host(u).replace(/^www\./, "") === domain.replace(/^www\./, "");
  const fromMap = (() => { // round-robin across first path segments so one section never fills the sample
    const groups = new Map<string, string[]>();
    for (const u of sm.urls) { const seg = (() => { try { return new URL(u).pathname.split("/")[1] ?? ""; } catch { return ""; } })(); groups.set(seg, [...(groups.get(seg) ?? []), u]); }
    const lists = [...groups.values()], out: string[] = [];
    for (let i = 0; out.length < 40 && lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  })();
  const sample = [...new Map([
    home.finalUrl,
    ...lh,
    ...rel.filter((r) => r.page).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)).map((r) => (r.page!.startsWith("http") ? r.page! : `https://${r.page}`)),
    ...fromMap,
    ...(audit?.rows ?? []).filter((r) => r.status === 200).sort((a, b) => (a.depth ?? 9) - (b.depth ?? 9)).map((r) => r.url),
  ].filter(sameSite).map((u) => [norm(u), u] as const)).values()].slice(0, MAX_PAGES);

  const pages = await pool(sample, 6, async (url): Promise<TechPage> => {
    const r = url === home.finalUrl ? home : await fetchChain(url);
    const a = analysePage(r.finalUrl, r.status === 200 ? r.body : "", origin);
    return { url, finalUrl: r.finalUrl, status: r.status, hops: r.hops, ms: r.ms, ...(r.error ? { error: r.error } : {}), ...a, inSitemap: inMap.has(norm(url)) || inMap.has(norm(r.finalUrl)) };
  });

  const result: TechChecks = {
    checkedAt: new Date().toISOString(), domain, origin,
    robots: { status: rb.status, disallowAll: disallows.includes("/"), sitemaps: robotsMaps, disallows: disallows.slice(0, 30) },
    sitemaps: sm.maps, sitemapUrls: sm.urls.length, sitemapSample: sm.urls.slice(0, 2000),
    https: { httpToHttps: http.status == null ? null : http.finalUrl.startsWith("https://"), hsts: home.headers?.get("strict-transport-security") ?? null, wwwConsistent: other.status == null ? null : host(other.finalUrl) === host(home.finalUrl),
      headers: home.headers ? { xcto: home.headers.has("x-content-type-options"), xfo: home.headers.has("x-frame-options") || /frame-ancestors/i.test(home.headers.get("content-security-policy") ?? ""), referrer: home.headers.has("referrer-policy"), csp: home.headers.has("content-security-policy") } : undefined },
    pages,
  };
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: TECH_ENDPOINT, params_hash: TECH_ENDPOINT, params: {}, data: result, row_count: pages.length, cost: 0, fetched_at: result.checkedAt }, { onConflict: "client_id,endpoint,params_hash" });
  return result;
}

export async function loadTechChecks(supabase: SupabaseClient, clientId: string): Promise<TechChecks | null> {
  const { data } = await supabase.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", TECH_ENDPOINT).eq("params_hash", TECH_ENDPOINT).maybeSingle();
  return (data?.data as TechChecks | undefined) ?? null;
}
