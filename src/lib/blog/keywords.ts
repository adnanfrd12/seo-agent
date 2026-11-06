import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, BudgetError, recordSpend, type SpendSource } from "@/lib/dataforseo/budget";
import { dfsConfigured, dfsPost } from "@/lib/dataforseo/client";
import { resolveTarget } from "@/lib/dataforseo/research";
import { pathOf } from "./parse";

/**
 * Google keywords each post ranks for, with search volume and difficulty (DataForSEO Labs).
 *  - free: the domain-wide keyword list the research run already stores (up to 1,000 keywords, each
 *    with its ranking page) is matched to posts by address
 *  - paid (~$0.014 a post): DataForSEO's list for the post's own address, which also finds keywords
 *    outside the domain's top 1,000. Automatic for posts from the last 60 days (refreshed weekly);
 *    every post on request.
 */
export const POST_KW_EST = 0.015;
const FRESH_DAYS = 7, NEW_DAYS = 60;

export interface DfsKeyword { keyword: string; position: number | null; volume: number | null; difficulty: number | null; cpc: number | null; intent: string | null; traffic: number | null }
export interface KeywordRun { matched: number; paid: number; cost: number; errors: string[]; stopped: string | null }

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const byVolume = (a: DfsKeyword, b: DfsKeyword) => (b.volume ?? -1) - (a.volume ?? -1) || (a.position ?? 999) - (b.position ?? 999);

export const keywordCost = (posts: number) => Number((posts * POST_KW_EST).toFixed(2));

export async function refreshPostKeywords(
  admin: SupabaseClient, clientId: string,
  opts: { paid: "none" | "new" | "all"; source: SpendSource; deadline?: number; maxPaid?: number },
): Promise<KeywordRun> {
  const run: KeywordRun = { matched: 0, paid: 0, cost: 0, errors: [], stopped: null };
  const deadline = opts.deadline ?? Date.now() + 200_000;
  const [target, postsRes, domainRes] = await Promise.all([
    resolveTarget(admin, clientId),
    admin.from("blog_posts").select("id, url, published_date, keywords").eq("client_id", clientId),
    admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "ranked_keywords").order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (postsRes.error) { run.errors.push(postsRes.error.message); run.stopped = "setup"; return run; }
  const posts = (postsRes.data ?? []) as { id: string; url: string; published_date: string | null; keywords: J | null }[];
  if (!posts.length) return run;

  // free: the stored domain list, by ranking page
  const byPath = new Map<string, DfsKeyword[]>();
  for (const r of arr(domainRes.data?.data)) {
    const url = str(r.url);
    if (!url) continue;
    const k: DfsKeyword = { keyword: str(r.keyword) ?? "", position: num(r.position), volume: num(r.volume), difficulty: num(r.difficulty), cpc: num(r.cpc), intent: str(r.intent), traffic: num(r.traffic) };
    if (!k.keyword) continue;
    const p = pathOf(url);
    byPath.set(p, [...(byPath.get(p) ?? []), k]);
  }
  const now = new Date().toISOString();
  const updates = new Map<string, J>();
  for (const p of posts) {
    const kw = obj(p.keywords);
    if (kw.dfs_source === "page") continue; // the post's own list is more complete; keep it
    const list = (byPath.get(pathOf(p.url)) ?? []).sort(byVolume).slice(0, 30);
    const before = JSON.stringify(kw.dfs ?? null);
    if (list.length && JSON.stringify(list) !== before) { updates.set(p.id, { ...kw, dfs: list, dfs_source: "domain", dfs_at: now }); run.matched++; }
  }

  // paid: the post's own address
  if (opts.paid !== "none" && target && dfsConfigured()) {
    const newSince = new Date(Date.now() - NEW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const staleBefore = Date.now() - FRESH_DAYS * 86_400_000;
    const due = posts.filter((p) => {
      const kw = obj(p.keywords);
      const fresh = kw.dfs_source === "page" && typeof kw.dfs_at === "string" && Date.parse(kw.dfs_at) > staleBefore;
      return !fresh && (opts.paid === "all" || (p.published_date ?? "") >= newSince);
    }).sort((a, b) => (b.published_date ?? "").localeCompare(a.published_date ?? "")).slice(0, opts.maxPaid ?? 20);
    for (const p of due) {
      if (Date.now() > deadline - 10_000) { run.stopped = "time"; break; }
      try {
        await assertBudget(admin, clientId, POST_KW_EST, opts.source);
        const { result, cost } = await dfsPost("/dataforseo_labs/google/ranked_keywords/live", { target: p.url, location_code: target.location_code, language_code: target.language_code, limit: 100 });
        await recordSpend(admin, clientId, "blog_keywords", cost, opts.source);
        run.cost += cost;
        run.paid++;
        const list = arr(result?.items).map((i): DfsKeyword => {
          const kd = obj(i.keyword_data), info = obj(kd.keyword_info), serp = obj(obj(i.ranked_serp_element).serp_item);
          return { keyword: str(kd.keyword) ?? "", position: num(serp.rank_absolute), volume: num(info.search_volume), difficulty: num(obj(kd.keyword_properties).keyword_difficulty), cpc: num(info.cpc), intent: str(obj(kd.search_intent_info).main_intent), traffic: num(serp.etv) };
        }).filter((k) => k.keyword).sort(byVolume).slice(0, 50);
        const kw = { ...obj(p.keywords), ...(updates.get(p.id) ?? {}) };
        updates.set(p.id, { ...kw, dfs: list, dfs_source: "page", dfs_at: new Date().toISOString() });
      } catch (e) {
        if (e instanceof BudgetError) { run.errors.push(e.message); run.stopped = "budget"; break; }
        if (run.errors.length < 3) run.errors.push(e instanceof Error ? e.message : "keyword lookup failed");
      }
    }
  }

  for (const [id, keywords] of updates) {
    const { error } = await admin.from("blog_posts").update({ keywords }).eq("id", id);
    if (error && run.errors.length < 3) run.errors.push(`Saving keywords: ${error.message}`);
  }
  run.cost = Number(run.cost.toFixed(4));
  return run;
}
