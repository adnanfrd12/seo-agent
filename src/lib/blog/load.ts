import type { SupabaseClient } from "@supabase/supabase-js";
import type { DfsKeyword } from "./keywords";
import type { MapInfo, PostLink } from "./parse";
import { pathOf } from "./parse";

/* ------------------------------------------------------------------ stored posts (no network calls) */
export interface BlogGeo {
  neighborhood: string | null; city: string | null; zip: string | null; lat: number | null; lng: number | null;
  road_crossings: string[]; landmarks: string[]; neighborhoods: string[]; zip_codes?: string[]; model: string | null;
}
export interface BlogPost {
  id: string; source: string; url: string; slug: string | null; title: string; excerpt: string | null;
  published_at: string | null; published_date: string | null; modified_at: string | null;
  categories: string[]; tags: string[];
  featured_image: { url: string; alt: string; width: number | null; height: number | null; unreadable?: boolean } | null;
  word_count: number; links: PostLink[]; internal_links: number; external_links: number;
  target_service: { url: string; title: string; anchor: string } | null;
  suggested_service: { url: string; title: string; score: number } | null;
  map: MapInfo | null; geo: BlogGeo | null;
  /** target/secondary read from the text; dfs = DataForSEO ranking keywords ("domain" = matched from the site list, "page" = the post's own list) */
  keywords: { target?: string; secondary?: string[]; dfs?: DfsKeyword[]; dfs_source?: "domain" | "page"; dfs_at?: string } | null;
  geo_cost: number; fetched_at: string;
}

export async function loadBlog(supabase: SupabaseClient, clientId: string): Promise<{ ok: boolean; missing: boolean; posts: BlogPost[]; lastFetched: string | null }> {
  const { data, error } = await supabase.from("blog_posts")
    .select("id, source, url, slug, title, excerpt, published_at, published_date, modified_at, categories, tags, featured_image, word_count, links, internal_links, external_links, target_service, suggested_service, map, geo, keywords, geo_cost, fetched_at")
    .eq("client_id", clientId).order("published_date", { ascending: false, nullsFirst: false }).limit(2000);
  if (error) return { ok: false, missing: error.code === "42P01" || error.code === "PGRST205", posts: [], lastFetched: null };
  const posts = (data ?? []).map((p) => ({ ...p, geo_cost: Number(p.geo_cost ?? 0), links: (p.links ?? []) as PostLink[] })) as BlogPost[];
  return { ok: true, missing: false, posts, lastFetched: posts.reduce<string | null>((a, p) => (!a || p.fetched_at > a ? p.fetched_at : a), null) };
}

export interface BlogPerf {
  clicks: number; impressions: number; ctr: number | null; position: number | null; queries: number;
  top: { query: string; clicks: number; impressions: number; position: number | null }[];
  views: number; users: number; sessions: number; key_events: number;
}

/** Search Console + GA4 per post path for a period (one database call). Empty when not available. */
export async function loadBlogPerformance(supabase: SupabaseClient, clientId: string, range: { start: string; end: string }): Promise<Map<string, BlogPerf>> {
  const { data, error } = await supabase.rpc("get_blog_performance", { p_client_id: clientId, p_start: range.start, p_end: range.end });
  if (error || !data || typeof data !== "object") return new Map();
  const num = (v: unknown) => (v == null ? null : Number(v));
  return new Map(Object.entries(data as Record<string, Record<string, unknown>>).map(([path, v]) => [path, {
    clicks: Number(v.clicks ?? 0), impressions: Number(v.impressions ?? 0), ctr: num(v.ctr), position: num(v.position), queries: Number(v.queries ?? 0),
    top: ((v.top as Record<string, unknown>[] | null) ?? []).map((t) => ({ query: String(t.query), clicks: Number(t.clicks ?? 0), impressions: Number(t.impressions ?? 0), position: num(t.position) })),
    views: Number(v.views ?? 0), users: Number(v.users ?? 0), sessions: Number(v.sessions ?? 0), key_events: Number(v.key_events ?? 0),
  }]));
}

/* ------------------------------------------------------------------ issues and coverage (pure) */
export type IssueKey = "not_indexed" | "no_service_link" | "thin" | "no_image" | "no_alt" | "no_map" | "map_not_profile" | "orphan" | "same_area";
export const ISSUES: Record<IssueKey, { label: string; severity: "high" | "medium" | "low"; advice: string }> = {
  not_indexed: { label: "No Google impressions", severity: "high", advice: "Published over 30 days ago and never shown in Google (90 days). Check it's indexed (Search Console > URL inspection), link to it from a service page and request indexing." },
  map_not_profile: { label: "Map isn't your profile", severity: "high", advice: "The post's Google Maps link or embed points at a different place. Link to your own Business Profile (maps?cid=...) so the post supports it." },
  no_service_link: { label: "No service-page link", severity: "medium", advice: "The post doesn't link to the service page it's about. Add a link with the service keyword as anchor text (see the suggested page)." },
  no_map: { label: "No Google Map", severity: "medium", advice: "Add a Google Maps embed of the area plus a link to your Business Profile; it ties the post to the location." },
  thin: { label: "Under 600 words", severity: "medium", advice: "Short posts rarely rank. Expand it with local detail, steps, prices or FAQs." },
  orphan: { label: "No other post links here", severity: "medium", advice: "Link to this post from related posts so readers and Google can find it." },
  no_image: { label: "No featured image", severity: "medium", advice: "Add a featured image: it shows in search results, social shares and the blog list." },
  no_alt: { label: "Image has no alt text", severity: "low", advice: "Describe the featured image in its alt text (include the service and area naturally)." },
  same_area: { label: "Area already covered", severity: "low", advice: "Another post targets the same neighbourhood. Fine for different services; for the same topic, merge or pick a new area." },
};
export const ISSUE_ORDER = Object.keys(ISSUES) as IssueKey[];

export interface BlogAnalysis {
  issues: Map<string, IssueKey[]>;
  /** posts that link to each post path */
  inbound: Map<string, { id: string; title: string; anchor: string }[]>;
  monthly: { month: string; count: number }[];
  areas: { name: string; count: number }[];
  services: { title: string; url: string; count: number }[];
  suggested: { title: string; url: string; count: number }[];
}

const monthKey = (d: string) => d.slice(0, 7);
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * `perf90`: Search Console totals for the last 90 days (for "no impressions"); `today` in the client's
 * time zone (YYYY-MM-DD). An empty perf90 (Search Console not connected) never marks posts unindexed.
 */
export function analyseBlog(posts: BlogPost[], perf90: Map<string, BlogPerf>, today: string): BlogAnalysis {
  const byPath = new Map(posts.map((p) => [pathOf(p.url), p]));
  const inbound = new Map<string, { id: string; title: string; anchor: string }[]>();
  for (const p of posts) {
    const seen = new Set<string>();
    for (const l of p.links) {
      if (l.kind !== "post" || !l.path || l.path === pathOf(p.url) || seen.has(l.path)) continue;
      seen.add(l.path);
      inbound.set(l.path, [...(inbound.get(l.path) ?? []), { id: p.id, title: p.title, anchor: l.anchor }]);
    }
  }
  const areaCount = new Map<string, number>();
  for (const p of posts) { const a = p.geo?.neighborhood; if (a) areaCount.set(a, (areaCount.get(a) ?? 0) + 1); }
  const monthAgo = Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000;
  const gscOn = perf90.size > 0;
  const issues = new Map<string, IssueKey[]>();
  for (const p of posts) {
    const list: IssueKey[] = [];
    const path = pathOf(p.url);
    const published = p.published_date ? Date.parse(`${p.published_date}T00:00:00Z`) : null;
    if (gscOn && published != null && published < monthAgo && (perf90.get(path)?.impressions ?? 0) === 0) list.push("not_indexed");
    if (p.map?.matches_profile === false) list.push("map_not_profile");
    if (!p.target_service) list.push("no_service_link");
    if (!p.map || (!p.map.embed && !p.map.cid)) list.push("no_map");
    if (p.word_count < 600) list.push("thin");
    if (!(inbound.get(path)?.length) && byPath.size > 1) list.push("orphan");
    if (!p.featured_image) list.push("no_image");
    else if (!p.featured_image.unreadable && !p.featured_image.alt) list.push("no_alt");
    if (p.geo?.neighborhood && (areaCount.get(p.geo.neighborhood) ?? 0) > 1) list.push("same_area");
    issues.set(p.id, list);
  }
  const months = lastMonths(today, 12);
  const perMonth = new Map(months.map((m) => [m, 0]));
  for (const p of posts) if (p.published_date && perMonth.has(monthKey(p.published_date))) perMonth.set(monthKey(p.published_date), (perMonth.get(monthKey(p.published_date)) ?? 0) + 1);
  const tally = (pick: (p: BlogPost) => { title: string; url: string } | null) => {
    const m = new Map<string, { title: string; url: string; count: number }>();
    // by path: the same page can be linked as "http://site/x" and "https://site/x/"
    for (const p of posts) { const s = pick(p); if (!s) continue; const key = pathOf(s.url); const x = m.get(key) ?? { ...s, count: 0 }; x.count++; m.set(key, x); }
    return [...m.values()].sort((a, b) => b.count - a.count);
  };
  return {
    issues, inbound,
    monthly: months.map((m) => ({ month: m, count: perMonth.get(m) ?? 0 })),
    areas: [...areaCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    services: tally((p) => p.target_service), suggested: tally((p) => (p.target_service ? null : p.suggested_service)),
  };
}

/* ------------------------------------------------------------------ monthly report */
export interface BlogReport {
  total: number; inRange: number; previous: number; avgWords: number | null;
  withMap: number; mapToProfile: number; withService: number;
  posts: { title: string; url: string; date: string | null; words: number; area: string | null; service: string | null; clicks: number; impressions: number }[];
}

export function blogReport(posts: BlogPost[], perf: Map<string, BlogPerf>, range: { start: string; end: string }): BlogReport | null {
  if (!posts.length) return null;
  const days = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
  const prevEnd = new Date(Date.parse(range.start) - 86_400_000).toISOString().slice(0, 10);
  const prevStart = new Date(Date.parse(range.start) - days * 86_400_000).toISOString().slice(0, 10);
  const inRange = posts.filter((p) => p.published_date && p.published_date >= range.start && p.published_date <= range.end);
  const pct = (n: number) => Math.round((n / posts.length) * 100);
  return {
    total: posts.length, inRange: inRange.length,
    previous: posts.filter((p) => p.published_date && p.published_date >= prevStart && p.published_date <= prevEnd).length,
    avgWords: Math.round(posts.reduce((a, p) => a + p.word_count, 0) / posts.length),
    withMap: pct(posts.filter((p) => p.map && (p.map.embed || p.map.cid)).length),
    mapToProfile: pct(posts.filter((p) => p.map?.matches_profile).length),
    withService: pct(posts.filter((p) => p.target_service).length),
    posts: inRange.map((p) => {
      const f = perf.get(pathOf(p.url));
      return { title: p.title, url: p.url, date: p.published_date, words: p.word_count, area: p.geo?.neighborhood ?? null, service: p.target_service?.title ?? null, clicks: f?.clicks ?? 0, impressions: f?.impressions ?? 0 };
    }),
  };
}
