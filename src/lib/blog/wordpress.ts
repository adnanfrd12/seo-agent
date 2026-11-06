import "server-only";

/**
 * The client's own WordPress site through its public REST API (no login, no cost). Only published
 * content that any visitor can see is read. Requests identify themselves honestly and are small:
 * ids first, then full content only for posts that are new or changed.
 */
export const BOT_UA = "Mozilla/5.0 (compatible; SEOInsightsBot/1.0)";

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const rendered = (v: unknown) => str((v as { rendered?: unknown } | null)?.rendered);

export async function getText(url: string, opts: { timeoutMs?: number; accept?: string } = {}): Promise<{ status: number; type: string; body: string; headers: Headers }> {
  const res = await fetch(url, {
    headers: { "user-agent": BOT_UA, accept: opts.accept ?? "*/*" }, redirect: "follow", cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text(), headers: res.headers };
}

/** "https://site.com/wp-json/wp/v2/" or "https://site.com/?rest_route=/wp/v2/", whichever answers; null when the site isn't WordPress. */
export async function findWpApi(origin: string): Promise<string | null> {
  for (const base of [`${origin}/wp-json/wp/v2/`, `${origin}/?rest_route=/wp/v2/`]) {
    try {
      const r = await getText(wpUrl(base, "posts", { per_page: 1, _fields: "id" }), { accept: "application/json", timeoutMs: 15_000 });
      if (r.status === 200 && r.type.includes("json") && Array.isArray(JSON.parse(r.body))) return base;
    } catch { /* try the next form */ }
  }
  return null;
}

export function wpUrl(base: string, route: string, params: Record<string, string | number>): string {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return base.includes("rest_route=") ? `${base}${route}&${q}` : `${base}${route}?${q}`;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// hosts like LiteSpeed throttle bursts: requests are spaced out, and one that hangs or is refused
// (timeout, 429, 5xx) is tried once more after a short wait
async function wpJson(url: string, timeoutMs = 30_000): Promise<{ rows: J[]; totalPages: number }> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await pause(4_000);
    try {
      await pause(250);
      const r = await getText(url, { accept: "application/json", timeoutMs });
      if (r.status === 429 || r.status >= 500) { last = new Error(`WordPress answered ${r.status}`); continue; }
      if (r.status !== 200) throw new Error(`WordPress answered ${r.status} for ${url.replace(/\?.*$/, "")}`);
      const json = JSON.parse(r.body) as unknown;
      return { rows: arr(json), totalPages: Number(r.headers.get("x-wp-totalpages")) || 1 };
    } catch (e) {
      if (!(e instanceof Error) || !/abort|timeout|fetch failed|ECONN|socket/i.test(`${e.name} ${e.message}`)) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? new Error(`WordPress didn't answer in time (${last.message})`) : new Error("WordPress didn't answer");
}

/** Every published post: id, address, dates. A few requests of 100 each. */
export async function wpListPosts(base: string): Promise<{ id: number; link: string; date_gmt: string; modified_gmt: string }[]> {
  const out: { id: number; link: string; date_gmt: string; modified_gmt: string }[] = [];
  for (let page = 1; page <= 100; page++) {
    const { rows, totalPages } = await wpJson(wpUrl(base, "posts", { per_page: 100, page, orderby: "date", order: "desc", _fields: "id,link,date_gmt,modified_gmt" }));
    for (const p of rows) out.push({ id: Number(p.id), link: str(p.link), date_gmt: str(p.date_gmt), modified_gmt: str(p.modified_gmt) });
    if (page >= totalPages || rows.length < 100) break;
  }
  return out;
}

export interface WpPost {
  id: number; link: string; slug: string; title: string; excerpt: string; content: string;
  date: string; date_gmt: string; modified_gmt: string; categories: number[]; tags: number[]; featured_media: number;
  /** the featured image, embedded in the same response (works even where /wp/v2/media is locked) */
  media: WpMedia | null;
}

const embeddedMedia = (p: J): WpMedia | null => {
  const m = arr((p._embedded as J | undefined)?.["wp:featuredmedia"])[0];
  if (!m || m.code || !str(m.source_url)) return null; // an error object when the image is private
  const d = (m.media_details ?? {}) as { width?: unknown; height?: unknown };
  return { id: Number(m.id), url: str(m.source_url), alt: str(m.alt_text).trim(), width: Number(d.width) || null, height: Number(d.height) || null };
};

/** Full content for the given posts, 10 per request (rendering post content is slow on many hosts). */
export async function wpPosts(base: string, ids: number[]): Promise<WpPost[]> {
  const out: WpPost[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const { rows } = await wpJson(wpUrl(base, "posts", {
      include: chunk.join(","), per_page: chunk.length, _embed: "wp:featuredmedia",
      _fields: "id,link,slug,title,excerpt,content,date,date_gmt,modified_gmt,categories,tags,featured_media,_links,_embedded",
    }), 60_000);
    for (const p of rows) {
      out.push({
        id: Number(p.id), link: str(p.link), slug: str(p.slug), title: rendered(p.title), excerpt: rendered(p.excerpt), content: rendered(p.content),
        date: str(p.date), date_gmt: str(p.date_gmt), modified_gmt: str(p.modified_gmt),
        categories: Array.isArray(p.categories) ? (p.categories as number[]) : [], tags: Array.isArray(p.tags) ? (p.tags as number[]) : [],
        featured_media: Number(p.featured_media) || 0, media: embeddedMedia(p),
      });
    }
  }
  return out;
}

export interface WpMedia { id: number; url: string; alt: string; width: number | null; height: number | null }

export async function wpMedia(base: string, ids: number[]): Promise<Map<number, WpMedia>> {
  const out = new Map<number, WpMedia>();
  const want = [...new Set(ids.filter((x) => x > 0))];
  for (let i = 0; i < want.length; i += 100) {
    const chunk = want.slice(i, i + 100);
    const { rows } = await wpJson(wpUrl(base, "media", { include: chunk.join(","), per_page: chunk.length, _fields: "id,source_url,alt_text,media_details" }));
    for (const m of rows) {
      const d = (m.media_details ?? {}) as { width?: unknown; height?: unknown };
      out.set(Number(m.id), { id: Number(m.id), url: str(m.source_url), alt: str(m.alt_text).trim(), width: Number(d.width) || null, height: Number(d.height) || null });
    }
  }
  return out;
}

/** Category or tag names by id. */
export async function wpTerms(base: string, kind: "categories" | "tags", ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const want = [...new Set(ids.filter((x) => x > 0))];
  for (let i = 0; i < want.length; i += 100) {
    const chunk = want.slice(i, i + 100);
    const { rows } = await wpJson(wpUrl(base, kind, { include: chunk.join(","), per_page: chunk.length, _fields: "id,name" }));
    for (const t of rows) out.set(Number(t.id), str(t.name));
  }
  return out;
}

/** Every published page (for telling service pages apart from posts and company pages). */
export async function wpPages(base: string): Promise<{ id: number; parent: number; link: string; slug: string; title: string }[]> {
  const out: { id: number; parent: number; link: string; slug: string; title: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { rows, totalPages } = await wpJson(wpUrl(base, "pages", { per_page: 100, page, _fields: "id,parent,link,slug,title" }));
    for (const p of rows) out.push({ id: Number(p.id), parent: Number(p.parent) || 0, link: str(p.link), slug: str(p.slug), title: rendered(p.title) });
    if (page >= totalPages || rows.length < 100) break;
  }
  return out;
}
