import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditResult } from "@/lib/dataforseo/audit";
import { bare, fetchHtml, hostOf, outline } from "@/lib/toolkit/store";
import type { PageInput } from "./method";

/** A page of the client's site that can be fanned out: from the site audit crawl, the blog and Search Console. */
export type PageSource = "crawl" | "blog" | "gsc";
export interface PageOption { url: string; title: string | null; sources: PageSource[]; impressions: number }

const key = (u: string) => { try { const x = new URL(u); return `${bare(x.host)}${x.pathname.replace(/\/$/, "")}`; } catch { return u; } };
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|xml|txt|zip)$|\/(wp-json|feed|tag|author|page\/\d+)(\/|$)|[?&](s|p|replytocom)=/i;

/** Stored data only (no API calls). */
export async function pageOptions(db: SupabaseClient, clientId: string, domain: string): Promise<PageOption[]> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [audit, blog, gsc] = await Promise.all([
    db.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "audit").eq("params_hash", "audit").maybeSingle(),
    db.from("blog_posts").select("url, title").eq("client_id", clientId).limit(1000),
    db.from("gsc_page_metrics").select("page, impressions").eq("client_id", clientId).gte("metric_date", since).limit(20000),
  ]);
  const map = new Map<string, PageOption>();
  const add = (url: string | null | undefined, title: string | null, source: PageSource, impressions = 0) => {
    if (!url || hostOf(url) !== bare(domain) || SKIP.test(url)) return;
    const k = key(url);
    const o = map.get(k) ?? { url, title: null, sources: [], impressions: 0 };
    if (!o.title && title) o.title = title;
    if (!o.sources.includes(source)) o.sources.push(source);
    o.impressions += impressions;
    map.set(k, o);
  };
  for (const r of ((audit.data?.data as AuditResult | undefined)?.rows ?? [])) if (r.status == null || r.status === 200) add(r.url, r.title, "crawl");
  for (const r of blog.data ?? []) add(r.url as string, (r.title as string) || null, "blog");
  for (const r of gsc.data ?? []) add(r.page as string, null, "gsc", Number(r.impressions ?? 0));
  return [...map.values()].sort((a, b) => b.impressions - a.impressions || a.url.localeCompare(b.url)).slice(0, 400);
}

/** Reads one page of the client's site for the fan-out analysis. */
export async function readPage(url: string): Promise<PageInput> {
  const r = await fetchHtml(url, 30_000);
  if (!r.html) throw new Error(r.status ? `The page answered ${r.status} without HTML.` : "The page didn't answer.");
  if (r.status && r.status >= 400) throw new Error(`The page answered ${r.status}.`);
  const o = outline(r.html);
  if (o.words < 50) throw new Error(`Only ${o.words} words of text could be read (the page may need JavaScript).`);
  return { url: r.finalUrl, title: o.title, headings: o.headings.map((h) => `H${h.level} ${h.text}`), text: o.text };
}
