import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractLinks, servicePages, wordCount, type SiteIndex } from "@/lib/blog/parse";
import { BOT_UA, findWpApi, wpPages } from "@/lib/blog/wordpress";
import { assertBudget, recordSpend } from "./budget";
import { dfsGet, dfsTaskPost } from "./client";
import { localIdentity, type Profile } from "./local";
import { arr, obj, str, type Ctx } from "./research";

/**
 * Google Business Profile posts ("updates") of the client and its tracked competitors, from DataForSEO
 * business_data/google/my_business_updates (task_post ≈ $0.003 for the newest 20 posts; task_get is free).
 * Fields per post: post_text, timestamp / post_date, images_url, links[{ title (button), url }], url (on Google).
 * Google doesn't expose the post type; it is inferred from the button (an "offer" button = Offer, else Update).
 * ONE dfs_cache row per business (endpoint "gbp_posts", key "self" or the competitor key used by gbp_profile).
 */
export const POSTS_DEPTH = 20;
export const POSTS_EST = 0.004;
export const POSTS_ENDPOINT = "gbp_posts";
export const GOOGLE_POST_LIMIT = 1500;

export type LinkDest = "service" | "home" | "blog" | "contact" | "page" | "google" | "external" | "none";
export interface GbpPost {
  date: string | null; type: "Update" | "Offer"; text: string; words: number; chars: number; image: string | null;
  cta: string | null; url: string | null; domain: string | null; path: string | null; dest: LinkDest;
  status: number | null; broken: boolean; googleUrl: string | null;
}
export interface PostsRow {
  key: string; name: string; own: boolean; taskId: string | null; postedAt: string; status: "pending" | "done" | "failed"; error?: string;
  fetchedAt: string | null; posts: GbpPost[];
}
type Who = { cid?: string | null; placeId?: string | null; name: string };

const bizKeyword = (w: Who) => (w.cid ? `cid:${w.cid}` : w.placeId ? `place_id:${w.placeId}` : w.name);
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
// an offer button opens the offer on Google itself (search.google.com/local/posts)
const isGoogle = (domain: string) => /(^|\.)google\.[a-z.]+$/.test(domain);

async function save(admin: SupabaseClient, clientId: string, row: PostsRow, cost: number) {
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: POSTS_ENDPOINT, params_hash: row.key, params: { name: row.name, own: row.own }, data: row, row_count: row.posts.length, cost, fetched_at: new Date().toISOString() },
    { onConflict: "client_id,endpoint,params_hash" },
  );
}

/** Starts one collection of the newest posts. Earlier posts stay visible until the new ones arrive. */
export async function startPosts(ctx: Ctx, who: Who, key: string, own: boolean): Promise<PostsRow> {
  await assertBudget(ctx.admin, ctx.clientId, POSTS_EST, ctx.source);
  const { id, cost } = await dfsTaskPost("/business_data/google/my_business_updates/task_post", {
    keyword: bizKeyword(who), location_code: 2840, language_code: "en", depth: POSTS_DEPTH,
  });
  await recordSpend(ctx.admin, ctx.clientId, POSTS_ENDPOINT, cost, ctx.source);
  const { data: prev } = await ctx.admin.from("dfs_cache").select("data").eq("client_id", ctx.clientId).eq("endpoint", POSTS_ENDPOINT).eq("params_hash", key).maybeSingle();
  const old = prev?.data as PostsRow | null;
  const row: PostsRow = { key, name: who.name, own, taskId: id, postedAt: new Date().toISOString(), status: "pending", fetchedAt: old?.fetchedAt ?? null, posts: old?.posts ?? [] };
  await save(ctx.admin, ctx.clientId, row, cost);
  return row;
}

/** The client plus up to 3 competitors already compared on Local SEO (their gbp_profile rows). */
export async function postTargets(admin: SupabaseClient, clientId: string): Promise<{ key: string; own: boolean; who: Who }[]> {
  const [me, { data }] = await Promise.all([
    localIdentity(admin, clientId),
    admin.from("dfs_cache").select("params_hash, data, fetched_at").eq("client_id", clientId).eq("endpoint", "gbp_profile").order("fetched_at", { ascending: false }).limit(50),
  ]);
  const rows = data ?? [];
  const self = rows.find((r) => r.params_hash === "self")?.data as Profile | null | undefined;
  const out: { key: string; own: boolean; who: Who }[] = [];
  if (me) out.push({ key: "self", own: true, who: { name: self?.title ?? me.name, cid: me.cid ?? self?.cid ?? null, placeId: me.placeId ?? self?.placeId ?? null } });
  for (const r of rows) {
    if (r.params_hash === "self" || out.length >= 4) continue;
    const p = r.data as Profile | null;
    if (!p?.title || out.some((o) => o.key === r.params_hash)) continue;
    out.push({ key: r.params_hash as string, own: false, who: { name: p.title, cid: p.cid, placeId: p.placeId } });
  }
  return out;
}

/* ------------------------------------------------------------------ collecting (free) */
async function siteIndex(admin: SupabaseClient, clientId: string, host: string): Promise<SiteIndex> {
  const site: SiteIndex = { host, posts: new Set(), services: new Map(), pages: new Set() };
  const { data } = await admin.from("blog_posts").select("url").eq("client_id", clientId).limit(2000);
  for (const r of data ?? []) { try { site.posts.add(new URL(String(r.url)).pathname.replace(/\/+$/, "")); } catch { /* skip */ } }
  try {
    const base = await findWpApi(`https://${host}`);
    if (base) { const sp = servicePages(await wpPages(base), host); site.services = sp.services; site.pages = sp.pages; }
  } catch { /* not WordPress: posts only */ }
  return site;
}

async function check(url: string): Promise<number | null> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const r = await fetch(url, { method, headers: { "user-agent": BOT_UA }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (method === "GET") await r.body?.cancel().catch(() => undefined);
      if (method === "HEAD" && (r.status === 405 || r.status === 403 || r.status >= 500)) continue;
      return r.status;
    } catch { /* try GET, then give up */ }
  }
  return null;
}

function classify(url: string | null, bizDomain: string | null, site: SiteIndex | null): { domain: string | null; path: string | null; dest: LinkDest } {
  if (!url) return { domain: null, path: null, dest: "none" };
  let u: URL;
  try { u = new URL(url); } catch { return { domain: null, path: null, dest: "external" }; }
  const domain = bare(u.hostname), path = u.pathname.replace(/\/+$/, "") || "/";
  if (isGoogle(domain)) return { domain, path, dest: "google" };
  if (!bizDomain || domain !== bare(bizDomain)) return { domain, path, dest: "external" };
  if (site) {
    const k = extractLinks(`<a href="${url.replace(/"/g, "%22")}">x</a>`, url, site)[0]?.kind;
    const dest: LinkDest = k === "home" ? "home" : k === "post" ? "blog" : k === "service" ? "service" : k === "contact" ? "contact" : "page";
    return { domain, path, dest };
  }
  const dest: LinkDest = path === "/" ? "home" : /contact|quote/i.test(path) ? "contact" : /\/(blog|news|posts?|articles?)(\/|$)/i.test(path) ? "blog" : "page";
  return { domain, path, dest };
}

export function shapePosts(result: Record<string, unknown> | null): Omit<GbpPost, "domain" | "path" | "dest" | "status" | "broken">[] {
  return arr(result?.items).filter((i) => i.type === "google_business_post").map((i) => {
    const text = (str(i.post_text) ?? str(i.snippet) ?? "").trim();
    const link = arr(i.links)[0];
    const cta = link ? str(obj(link).title) : null;
    return {
      date: str(i.timestamp)?.slice(0, 10) ?? null, type: /offer|redeem|coupon/i.test(cta ?? "") ? "Offer" : "Update",
      text, words: wordCount(text), chars: text.length, image: str(i.images_url), cta, url: link ? str(obj(link).url) : null, googleUrl: str(i.url),
    };
  });
}

/** Collects every finished posts task for the client: classifies each link and checks it answers. */
export async function pollPosts(admin: SupabaseClient, clientId: string): Promise<{ pending: number; done: number }> {
  const { data } = await admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", POSTS_ENDPOINT);
  let pending = 0, done = 0;
  let site: SiteIndex | null | undefined;
  const me = await localIdentity(admin, clientId);
  const { data: profs } = await admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", "gbp_profile");
  for (const r of data ?? []) {
    const t = r.data as PostsRow;
    if (t.status !== "pending" || !t.taskId) continue;
    const { status, result } = await dfsGet(`/business_data/google/my_business_updates/task_get/${t.taskId}`);
    if (status === 20000) {
      const prof = profs?.find((p) => p.params_hash === t.key)?.data as Profile | null | undefined;
      const bizDomain = t.own ? (me?.domain ?? prof?.domain ?? null) : (prof?.domain ?? null);
      if (t.own && bizDomain && site === undefined) site = await siteIndex(admin, clientId, bare(bizDomain));
      const raw = shapePosts(result);
      const codes = new Map<string, number | null>();
      const urls = [...new Set(raw.map((p) => p.url).filter((u): u is string => Boolean(u)))];
      for (let i = 0; i < urls.length; i += 5) await Promise.all(urls.slice(i, i + 5).map(async (u) => codes.set(u, await check(u))));
      const posts: GbpPost[] = raw.map((p) => {
        const c = classify(p.url, bizDomain, t.own ? site ?? null : null);
        const st = p.url ? codes.get(p.url) ?? null : null;
        return { ...p, ...c, status: st, broken: Boolean(p.url) && (st == null || st >= 400) };
      });
      await save(admin, clientId, { ...t, status: "done", fetchedAt: new Date().toISOString(), posts }, 0);
      done++;
    } else if (status === 40102) {
      await save(admin, clientId, { ...t, status: "done", fetchedAt: new Date().toISOString(), posts: [] }, 0);
      done++;
    } else if ((status >= 40000 && status !== 40601 && status !== 40602) || Date.now() - Date.parse(t.postedAt) > 6 * 3_600_000) {
      await save(admin, clientId, { ...t, status: "failed", error: `DataForSEO status ${status}` }, 0);
    } else pending++;
  }
  return { pending, done };
}

/** Reading only (no API calls). */
export async function loadPosts(supabase: SupabaseClient, clientId: string): Promise<PostsRow[]> {
  const { data } = await supabase.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", POSTS_ENDPOINT).limit(10);
  const rows = (data ?? []).map((r) => r.data as PostsRow).filter(Boolean)
    .map((r) => ({ ...r, posts: r.posts.map((p) => (p.dest === "external" && p.domain && isGoogle(p.domain) ? { ...p, dest: "google" as const } : p)) }));
  return rows.sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
}
