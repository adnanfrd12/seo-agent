import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { demand, fetchSerp, SERP_EST, siteKeywords, storedSerps, type Serp } from "./store";

/**
 * Search-experience (SXO) check: is the page that ranks the right TYPE of page for the keyword? For each top keyword
 * the Google top 10 (DataForSEO, ~$0.002 per search, reused from other toolkit runs when fresh) is classified by page
 * type and compared with the site's ranking page. Taxonomy simplified from the seo-sxo skill of the MIT-licensed
 * claude-seo project (https://github.com/AgricIDaniel/claude-seo).
 */
export const MAX_SXO = 8;
export const sxoEstimate = (n = MAX_SXO) => Number((n * SERP_EST).toFixed(3));
export type PageType = "Home page" | "Service / product page" | "Blog / guide" | "Directory / listing" | "Category / gallery" | "Marketplace / retailer" | "Video";

const DIRECTORIES = /yelp|yellowpages|thumbtack|angi|homeadvisor|bbb\.org|manta|nextdoor|houzz|mapquest|tripadvisor|chamberofcommerce|expertise\.com|bark\.com|porch|threebestrated|clutch\.co|facebook|linkedin|instagram|reddit|quora|wikipedia/;
const RETAIL = /amazon|ebay|walmart|homedepot|lowes|etsy|alibaba|temu|wayfair|target\.com|vistaprint|signs\.com|bestbuy|costco/;

export function classify(url: string, title = "", home?: string): PageType {
  let host = "", path = "/";
  try { const u = new URL(url); host = u.host.replace(/^www\./, ""); path = u.pathname.toLowerCase(); } catch { /* keep defaults */ }
  if (/youtube|vimeo|tiktok/.test(host)) return "Video";
  if (DIRECTORIES.test(host)) return "Directory / listing";
  if (RETAIL.test(host)) return "Marketplace / retailer";
  if (path === "/" || path === "" || (home && url.replace(/\/$/, "") === home.replace(/\/$/, ""))) return "Home page";
  const t = title.toLowerCase();
  if (/\/(blog|news|article|posts?|guide|learn|resources?|insights?)\//.test(path) || /^(how|what|why|when|best|top \d+|\d+ )/.test(t) || /\bguide\b|\bvs\.?\b|\btips\b|\bideas\b|\bcost of\b/.test(t) || /\/\d{4}\/\d{2}\//.test(path)) return "Blog / guide";
  if (/\/(category|categories|collections?|shop|products|gallery|portfolio|tag)\b/.test(path) || /\bgallery\b|\bportfolio\b/.test(t)) return "Category / gallery";
  return "Service / product page";
}

export interface SxoRow {
  keyword: string; volume: number | null; impressions: number; position: number | null; ourUrl: string | null; ourType: PageType | null;
  mix: Partial<Record<PageType, number>>; dominant: PageType; dominantShare: number; mismatch: boolean; localPack: boolean; features: string[]; advice: string;
}
export interface SxoRun { rows: SxoRow[]; serps: Serp[]; searched: number; reused: number; cost: number }

export async function runSxo(admin: SupabaseClient, clientId: string, target: { domain: string; location_code: number; language_code: string }): Promise<SxoRun> {
  const kws = (await siteKeywords(admin, clientId)).filter((k) => k.url && k.keyword.split(" ").length >= 2).sort((a, b) => demand(b) - demand(a)).slice(0, MAX_SXO);
  if (!kws.length) throw new Error("No ranking keywords with a page are stored yet. Refresh Organic Keywords or connect Search Console first.");
  const { data: posts } = await admin.from("blog_posts").select("url").eq("client_id", clientId).limit(2000);
  const blogUrls = new Set((posts ?? []).map((p) => String(p.url).replace(/\/$/, "")));
  const stored = await storedSerps(admin, clientId);
  const rows: SxoRow[] = [], serps: Serp[] = [];
  let cost = 0, reused = 0;
  const res = await Promise.allSettled(kws.map(async (k) => {
    const hit = stored.get(k.keyword);
    if (hit) { reused++; return { k, serp: hit, cost: 0 }; }
    const r = await fetchSerp(admin, clientId, k.keyword, target.location_code, target.language_code);
    return { k, ...r };
  }));
  for (const r of res) {
    if (r.status !== "fulfilled") continue;
    const { k, serp } = r.value;
    cost += r.value.cost; serps.push(serp);
    const mix: SxoRow["mix"] = {};
    for (const o of serp.organic) { const t = classify(o.url, o.title); mix[t] = (mix[t] ?? 0) + 1; }
    const [dominant, n] = (Object.entries(mix) as [PageType, number][]).sort((a, b) => b[1] - a[1])[0] ?? ["Service / product page", 0];
    const ourType = k.url ? (blogUrls.has(k.url.replace(/\/$/, "")) ? "Blog / guide" : classify(k.url)) : null;
    const share = serp.organic.length ? n / serp.organic.length : 0;
    const localPack = serp.features.includes("local_pack") || serp.features.includes("map");
    const mismatch = ourType != null && ourType !== dominant && (mix[ourType] ?? 0) < 2 && share >= 0.4;
    const ours = ourType ? (mix[ourType] ?? 0) : 0;
    const advice = !mismatch
      ? ourType === dominant
        ? `Page type matches what Google ranks (${dominant}, ${n}/${serp.organic.length}). Improve depth and relevance on the same page.`
        : `Mixed results: Google mostly ranks ${dominant.toLowerCase()} pages (${n}/${serp.organic.length}) but also ${ours} ${ourType?.toLowerCase()} page${ours === 1 ? "" : "s"} like yours. Your page type can rank; consider a dedicated ${dominant.toLowerCase()} too.`
      : dominant === "Blog / guide" ? `Google mostly ranks guides here. Write a helpful article for "${k.keyword}" and link it to the service page.`
      : dominant === "Service / product page" || dominant === "Home page" ? `Google mostly ranks service pages. Point this keyword at a dedicated service page instead of a ${ourType?.toLowerCase()}, and link the current page to it.`
      : dominant === "Directory / listing" ? `Directories dominate this search. Get listed on the top directories shown and keep the Business Profile strong${localPack ? " (a map pack shows)" : ""}.`
      : `Google mostly ranks ${dominant.toLowerCase()} pages. Match that format, or target a closer keyword with the current page.`;
    rows.push({ keyword: k.keyword, volume: k.volume, impressions: k.impressions, position: k.position, ourUrl: k.url, ourType, mix, dominant, dominantShare: Math.round(share * 100), mismatch, localPack, features: serp.features, advice });
  }
  if (!rows.length) {
    const err = res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(err ? String((err.reason as Error)?.message ?? "Search failed") : "No searches completed.");
  }
  return { rows, serps, searched: rows.length - reused, reused, cost: Number(cost.toFixed(4)) };
}
