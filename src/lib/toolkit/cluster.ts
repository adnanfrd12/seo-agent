import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { demand, fetchSerp, SERP_EST, siteKeywords, storedSerps, type Serp, type SiteKeyword } from "./store";

/**
 * Keyword clustering by SERP overlap (shared top-10 URLs), following the seo-cluster skill of the MIT-licensed
 * claude-seo project (https://github.com/AgricIDaniel/claude-seo): 4+ shared results = same cluster, 2-3 = interlink.
 * Only the top MAX_SERP keywords are searched (DataForSEO, ~$0.002 each); the rest join a cluster by shared words,
 * or are grouped semantically by their core term when nothing overlaps. The hub of each cluster is mapped to the
 * site page that already ranks for most of its keywords, with internal-link suggestions between hub and spokes.
 */
export const MAX_SERP = 12;
export const clusterEstimate = (n = MAX_SERP) => Number((n * SERP_EST).toFixed(3));

const STOP = new Set("a an the for of in on to and or near me my best top cheap custom houston tx texas with by at from how what is are do does cost price prices company companies service services".split(" "));
const toks = (k: string) => k.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => t.replace(/s$/, ""));
const jacc = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / Math.max(1, new Set([...A, ...B]).size); };
const norm = (u: string) => { try { const x = new URL(u); return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`; } catch { return u; } };

export interface ClusterKw { keyword: string; volume: number | null; impressions: number; position: number | null; url: string | null; method: "serp" | "words" | "semantic" }
export interface Cluster {
  name: string; hubKeyword: string; method: "serp" | "semantic"; demand: number;
  hubPage: string | null; keywords: ClusterKw[]; pages: string[];
  links: { from: string; to: string; anchor: string }[]; action: string;
}
export interface ClusterRun { clusters: Cluster[]; interlinks: { a: string; b: string; shared: number }[]; serps: Serp[]; searched: number; reused: number; cost: number; totalKeywords: number }

export async function runCluster(admin: SupabaseClient, clientId: string, target: { domain: string; location_code: number; language_code: string }, maxSerp = MAX_SERP): Promise<ClusterRun> {
  const all = (await siteKeywords(admin, clientId)).filter((k) => toks(k.keyword).length > 0 && (k.volume || k.impressions >= 5));
  all.sort((a, b) => demand(b) - demand(a));
  const pool = all.slice(0, 150);
  if (pool.length < 3) throw new Error("Not enough keywords stored yet. Refresh Organic Keywords or connect Search Console first.");

  // 1. SERPs for the top keywords (reusing any stored by the other toolkit tools in the last 14 days)
  const stored = await storedSerps(admin, clientId);
  const serps: Serp[] = [];
  let cost = 0, reused = 0;
  const seeds = pool.slice(0, maxSerp);
  for (let i = 0; i < seeds.length; i += 4) {
    const batch = await Promise.allSettled(seeds.slice(i, i + 4).map(async (k) => {
      const hit = stored.get(k.keyword);
      if (hit) { reused++; return { serp: hit, cost: 0 }; }
      return fetchSerp(admin, clientId, k.keyword, target.location_code, target.language_code);
    }));
    for (const b of batch) if (b.status === "fulfilled") { serps.push(b.value.serp); cost += b.value.cost; }
    if (batch.some((b) => b.status === "rejected" && /budget|limit/i.test(String((b.reason as Error)?.message)))) break;
  }

  // 2. union-find over SERP overlap
  const urls = new Map(serps.map((s) => [s.keyword, new Set(s.organic.map((o) => norm(o.url)))]));
  const parent = new Map(serps.map((s) => [s.keyword, s.keyword]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  const interlinks: ClusterRun["interlinks"] = [];
  for (let i = 0; i < serps.length; i++) for (let j = i + 1; j < serps.length; j++) {
    const a = serps[i].keyword, b = serps[j].keyword;
    const shared = [...urls.get(a)!].filter((u) => urls.get(b)!.has(u)).length;
    if (shared >= 4) parent.set(find(a), find(b));
    else if (shared >= 2) interlinks.push({ a, b, shared });
  }
  const groups = new Map<string, ClusterKw[]>();
  const byKw = new Map(pool.map((k) => [k.keyword, k]));
  const asKw = (k: SiteKeyword, method: ClusterKw["method"]): ClusterKw => ({ keyword: k.keyword, volume: k.volume, impressions: k.impressions, position: k.position, url: k.url, method });
  for (const s of serps) { const r = find(s.keyword); groups.set(r, [...(groups.get(r) ?? []), asKw(byKw.get(s.keyword)!, "serp")]); }

  // 3. remaining keywords join the closest SERP cluster by shared words, else a semantic group by core term
  const freq = new Map<string, number>();
  for (const k of pool) for (const t of new Set(toks(k.keyword))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const semantic = new Map<string, ClusterKw[]>();
  for (const k of pool) {
    if (urls.has(k.keyword)) continue;
    const kt = toks(k.keyword);
    let best: string | null = null, bestScore = 0;
    for (const [root, list] of groups) {
      const s = Math.max(...list.map((x) => jacc(kt, toks(x.keyword))));
      if (s > bestScore) { bestScore = s; best = root; }
    }
    if (best && bestScore >= 0.6) { groups.get(best)!.push(asKw(k, "words")); continue; }
    const core = [...kt].sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0))[0];
    semantic.set(core, [...(semantic.get(core) ?? []), asKw(k, "semantic")]);
  }

  const build = (list: ClusterKw[], method: Cluster["method"], label?: string): Cluster => {
    const sorted = [...list].sort((a, b) => (b.volume ?? 0) + b.impressions / 3 - ((a.volume ?? 0) + a.impressions / 3));
    const hub = sorted[0];
    const pageCount = new Map<string, number>();
    for (const k of sorted) if (k.url) pageCount.set(k.url, (pageCount.get(k.url) ?? 0) + 1 + (k === hub ? 1 : 0));
    const pages = [...pageCount].sort((a, b) => b[1] - a[1]).map(([u]) => u);
    const hubPage = pages[0] ?? null;
    const links: Cluster["links"] = [];
    for (const p of pages.slice(1, 6)) {
      const kw = sorted.find((k) => k.url === p)?.keyword ?? hub.keyword;
      links.push({ from: p, to: hubPage!, anchor: hub.keyword }, { from: hubPage!, to: p, anchor: kw });
    }
    const action = !hubPage ? `Create a hub page targeting "${hub.keyword}" and link the cluster's posts to it.`
      : pages.length > 1 ? `Make ${hubPage.replace(/^https?:\/\/[^/]+/, "") || "/"} the hub; ${pages.length - 1} other page${pages.length > 2 ? "s compete" : " competes"} for these keywords: link them to the hub (or merge if they overlap heavily).`
      : `Strengthen ${hubPage.replace(/^https?:\/\/[^/]+/, "") || "/"} and add ${Math.min(3, sorted.length - 1) || 1} supporting post${sorted.length > 2 ? "s" : ""} linking to it.`;
    return { name: label ?? hub.keyword, hubKeyword: hub.keyword, method, demand: Math.round(sorted.reduce((a, k) => a + (k.volume ?? 0) + k.impressions / 3, 0)), hubPage, keywords: sorted, pages, links, action };
  };
  const clusters = [
    ...[...groups.values()].map((l) => build(l, "serp")),
    ...[...semantic].filter(([, l]) => l.length >= 2).map(([core, l]) => build(l, "semantic", `${core} (semantic)`)),
  ].sort((a, b) => b.demand - a.demand).slice(0, 30);
  return { clusters, interlinks: interlinks.slice(0, 30), serps, searched: serps.length - reused, reused, cost: Number(cost.toFixed(4)), totalKeywords: pool.length };
}
