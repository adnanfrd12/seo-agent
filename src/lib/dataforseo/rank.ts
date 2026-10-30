import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, BudgetError, recordSpend } from "./budget";
import { DfsError, dfsPost } from "./client";
import { localIdentity } from "./local";
import { arr, num, obj, str, type Ctx, type Target } from "./research";

/**
 * Rank tracking: where the website appears in Google for chosen keywords. One Live SERP call per keyword
 * (measured: $0.002 for the top 10 results, $0.005 for 30, $0.0155 for 100), stored per day so history
 * and movement come from our own data. Nothing is fetched when a page is opened; a weekly job and a
 * manual "check now" are the only triggers, and both go through the daily spend cap.
 */
// the top 100, so a site ranking on pages 3-10 still gets a real position (measured $0.0155 per search)
export const RANK_DEPTH = 100;
export const RANK_EVERY_DAYS = 7;
export const MAX_RANK_KEYWORDS = 50;
const RANK_PARALLEL = 4;
export const rankEstimate = (keywords: number, depth = RANK_DEPTH) => Number((keywords * (depth <= 10 ? 0.002 : depth <= 30 ? 0.005 : 0.0155)).toFixed(4));

export interface RankKeyword { id: string; keyword: string; device: "desktop" | "mobile"; location_code: number; language_code: string; created_at: string }
export interface RankTop { position: number; domain: string | null; url: string | null; title: string | null }
export interface RankCheck { keyword_id: string; checked_on: string; position: number | null; url: string | null; depth: number; top: RankTop[] }

const bare = (d: string | null | undefined) => (d ?? "").toLowerCase().replace(/^www\./, "");
const sameSite = (domain: string | null, site: string) => { const d = bare(domain); return d === site || d.endsWith(`.${site}`); };

/** What else Google shows on the results page: SERP features, who holds the map pack, who advertises, what the AI Overview cites. */
export interface RankSerp {
  features: string[];
  local_pack: { title: string | null; domain: string | null; rating: number | null; own: boolean }[];
  ads: string[];
  ai_overview: { domain: string | null; url: string | null; title: string | null }[];
  featured_snippet: string | null;
}

const isGoogle = (d: string | null | undefined) => /(^|\.)google\.com$/.test(d ?? "");

/**
 * The real website of an organic result. Google now often links results through google.com/goto, so the
 * domain field reads "google.com"; the breadcrumb ("https://www.site.com › path › ...") still names the site.
 */
export function realSite(i: Record<string, unknown>): { domain: string | null; url: string | null } {
  const domain = str(i.domain), url = str(i.url);
  if (!isGoogle(domain)) return { domain, url };
  const crumb = str(i.breadcrumb) ?? "";
  const m = /^(https?:\/\/[^\s›]+)/.exec(crumb.trim());
  if (!m) return { domain: null, url: null };
  const path = crumb.split("›").slice(1).map((x) => x.trim()).filter((x) => x && !x.includes("...") && !x.includes("…"));
  try {
    const u = new URL(m[1]);
    return { domain: u.hostname, url: `${u.origin}/${path.join("/")}${path.length ? "/" : ""}` };
  } catch { return { domain: null, url: null }; }
}

/** Position of the site among the organic results (first match), plus the top 10 and the rest of the page for context. */
export function locate(items: Record<string, unknown>[], site: string, cid: string | null = null): { position: number | null; url: string | null; top: RankTop[]; serp: RankSerp } {
  const organic = items.filter((i) => i.type === "organic").map((i) => ({ item: i, ...realSite(i) }));
  const mine = organic.find((i) => sameSite(i.domain, site));
  const refs = items.filter((i) => i.type === "ai_overview").flatMap((i) => arr(i.references));
  const snippet = items.find((i) => i.type === "featured_snippet");
  return {
    position: mine ? num(mine.item.rank_group) : null,
    url: mine ? mine.url : null,
    top: organic.slice(0, 10).map((i) => ({ position: num(i.item.rank_group) ?? 0, domain: i.domain, url: i.url, title: str(i.item.title)?.slice(0, 120) ?? null })),
    serp: {
      features: [...new Set(items.map((i) => str(i.type)).filter((t): t is string => !!t && t !== "organic"))],
      local_pack: items.filter((i) => i.type === "local_pack").slice(0, 5).map((i) => ({
        title: str(i.title)?.slice(0, 100) ?? null, domain: isGoogle(str(i.domain)) ? null : str(i.domain), rating: num(obj(i.rating).value), own: (!!cid && str(i.cid) === cid) || sameSite(str(i.domain), site),
      })),
      ads: [...new Set(items.filter((i) => i.type === "paid").map((i) => bare(str(i.domain))).filter(Boolean))].slice(0, 8),
      ai_overview: refs.filter((r) => !isGoogle(str(r.domain))).slice(0, 10).map((r) => ({ domain: str(r.domain), url: str(r.url), title: str(r.title)?.slice(0, 120) ?? null })),
      featured_snippet: snippet ? str(snippet.domain) : null,
    },
  };
}

/** Search volume, difficulty, CPC and intent for tracked keywords (DataForSEO Labs, ~$0.01 + $0.0001 per keyword), at most monthly. */
export async function refreshKeywordMetrics(ctx: Ctx, target: Target, keywords: { keyword: string }[]): Promise<number> {
  const list = [...new Set(keywords.map((k) => k.keyword.toLowerCase()))].slice(0, 700);
  if (!list.length) return 0;
  await assertBudget(ctx.admin, ctx.clientId, 0.02, ctx.source);
  const { result, cost } = await dfsPost("/dataforseo_labs/google/keyword_overview/live", { keywords: list, location_code: target.location_code, language_code: target.language_code });
  await recordSpend(ctx.admin, ctx.clientId, "rank_metrics", cost, ctx.source);
  const at = new Date().toISOString().slice(0, 10);
  for (const it of arr(result?.items)) {
    const info = obj(it.keyword_info);
    const metrics = {
      volume: num(info.search_volume), cpc: num(info.cpc), competition: str(info.competition_level),
      difficulty: num(obj(it.keyword_properties).keyword_difficulty), intent: str(obj(it.search_intent_info).main_intent), at,
    };
    await ctx.admin.from("rank_keywords").update({ metrics }).eq("client_id", ctx.clientId).ilike("keyword", str(it.keyword) ?? "");
  }
  return cost;
}

export async function checkKeyword(ctx: Ctx, target: Target, kw: RankKeyword, depth = RANK_DEPTH, cid: string | null = null): Promise<{ position: number | null; cost: number }> {
  await assertBudget(ctx.admin, ctx.clientId, rankEstimate(1, depth), ctx.source);
  // the advanced result also carries the map pack, ads and AI Overview on the same page, at the same price
  const { result, cost } = await dfsPost("/serp/google/organic/live/advanced", {
    keyword: kw.keyword, location_code: kw.location_code, language_code: kw.language_code, device: kw.device, depth,
  }, { timeoutMs: 110_000, attempts: 1 }); // a 100-result search can take over a minute; one attempt, so it is never billed twice
  await recordSpend(ctx.admin, ctx.clientId, "rank", cost, ctx.source);
  const found = locate(arr(result?.items), bare(target.domain), cid);
  const row = { client_id: ctx.clientId, keyword_id: kw.id, checked_on: new Date().toISOString().slice(0, 10), position: found.position, url: found.url, depth, top: found.top, cost };
  const saved = await ctx.admin.from("rank_checks").upsert({ ...row, serp: found.serp }, { onConflict: "keyword_id,checked_on" });
  // before migration 21 the serp column doesn't exist: keep the position anyway
  if (saved.error) await ctx.admin.from("rank_checks").upsert(row, { onConflict: "keyword_id,checked_on" });
  return { position: found.position, cost };
}

export interface RankRun { checked: number; skipped: number; cost: number; stopped: string | null; errors: string[] }

/** Checks every keyword that has no result newer than RANK_EVERY_DAYS (all of them when `force`), stopping at the spend cap. */
export async function runRankChecks(ctx: Ctx, target: Target, opts: { force?: boolean; deadline?: number } = {}): Promise<RankRun> {
  const run: RankRun = { checked: 0, skipped: 0, cost: 0, stopped: null, errors: [] };
  // the Business Profile id, so the client's own map-pack listing is recognised
  const cid = (await localIdentity(ctx.admin, ctx.clientId))?.cid ?? null;
  const { data: kws } = await ctx.admin.from("rank_keywords").select("*").eq("client_id", ctx.clientId).order("created_at").limit(MAX_RANK_KEYWORDS);
  const { data: last } = await ctx.admin.from("rank_checks").select("keyword_id, checked_on").eq("client_id", ctx.clientId).order("checked_on", { ascending: false }).limit(2000);
  const lastOn = new Map<string, string>();
  for (const r of last ?? []) if (!lastOn.has(r.keyword_id as string)) lastOn.set(r.keyword_id as string, r.checked_on as string);
  const cutoff = new Date(Date.now() - (RANK_EVERY_DAYS - 0.5) * 86_400_000).toISOString().slice(0, 10);
  const due = ((kws ?? []) as RankKeyword[]).filter((kw) => { const prev = lastOn.get(kw.id); return opts.force || !prev || prev <= cutoff; });
  run.skipped = (kws?.length ?? 0) - due.length;
  // a live Google search takes 10-30 seconds, so a few run side by side
  for (let i = 0; i < due.length && !run.stopped; i += RANK_PARALLEL) {
    if (opts.deadline && Date.now() > opts.deadline) { run.stopped = "time"; break; }
    const results = await Promise.allSettled(due.slice(i, i + RANK_PARALLEL).map((kw) => checkKeyword(ctx, target, kw, RANK_DEPTH, cid)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") { run.checked++; run.cost += r.value.cost; return; }
      const e = r.reason;
      if (e instanceof BudgetError) { run.stopped = "budget"; run.errors.push(e.message); return; }
      run.errors.push(`${due[i + j].keyword}: ${e instanceof Error ? e.message : "failed"}`);
      if (e instanceof DfsError && ["auth", "payment", "config"].includes(e.kind)) run.stopped = "provider";
    });
  }
  // volume / difficulty / CPC for keywords that have none or are over a month old (one call for all of them)
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const stale = ((kws ?? []) as (RankKeyword & { metrics?: { at?: string } | null })[]).filter((k) => "metrics" in k && (!k.metrics?.at || k.metrics.at < monthAgo));
  if (!run.stopped && stale.length) {
    try { run.cost += await refreshKeywordMetrics(ctx, target, stale); } catch (e) { run.errors.push(`keyword metrics: ${e instanceof Error ? e.message : "failed"}`); }
  }
  return run;
}

/* ------------------------------------------------------------------ reading (no API calls) */
export interface RankRow {
  id: string; keyword: string; device: string; position: number | null; previous: number | null; best: number | null; url: string | null;
  checkedOn: string | null; change: number | null; history: { date: string; position: number | null }[]; top: RankTop[]; volume: number | null;
  difficulty: number | null; cpc: number | null; intent: string | null; serp: RankSerp | null;
}

/** Everything the page and alerts read. `change` > 0 means the keyword moved up (a lower position number). */
export async function loadRanks(supabase: SupabaseClient, clientId: string): Promise<{ ok: boolean; rows: RankRow[]; lastChecked: string | null }> {
  const [kw, ch] = await Promise.all([
    supabase.from("rank_keywords").select("*").eq("client_id", clientId).order("created_at"),
    supabase.from("rank_checks").select("*").eq("client_id", clientId).order("checked_on", { ascending: false }).limit(5000),
  ]);
  if (kw.error || ch.error) return { ok: false, rows: [], lastChecked: null };
  const by = new Map<string, { checked_on: string; position: number | null; url: string | null; top: RankTop[]; serp: RankSerp | null }[]>();
  for (const c of ch.data ?? []) {
    const l = by.get(c.keyword_id as string) ?? [];
    const serp = c.serp && Array.isArray((c.serp as RankSerp).features) ? (c.serp as RankSerp) : null;
    l.push({ checked_on: c.checked_on as string, position: c.position as number | null, url: c.url as string | null, top: (c.top as RankTop[]) ?? [], serp });
    by.set(c.keyword_id as string, l);
  }
  let lastChecked: string | null = null;
  const rows = (kw.data ?? []).map((k): RankRow => {
    const h = by.get(k.id as string) ?? []; // newest first
    const m = (k.metrics ?? null) as { volume: number | null; difficulty: number | null; cpc: number | null; intent: string | null } | null;
    const cur = h[0] ?? null, prev = h[1] ?? null;
    const seen = h.map((x) => x.position).filter((p): p is number => p !== null);
    if (cur && (!lastChecked || cur.checked_on > lastChecked)) lastChecked = cur.checked_on;
    // a keyword that fell out of the top 30 counts as position 31 so the movement stays meaningful
    const eff = (p: number | null | undefined) => (p == null ? RANK_DEPTH + 1 : p);
    return {
      id: k.id as string, keyword: k.keyword as string, device: k.device as string, position: cur?.position ?? null, previous: prev ? prev.position : null,
      best: seen.length ? Math.min(...seen) : null, url: cur?.url ?? null, checkedOn: cur?.checked_on ?? null,
      change: cur && prev ? eff(prev.position) - eff(cur.position) : null,
      history: [...h].reverse().map((x) => ({ date: x.checked_on, position: x.position })), top: cur?.top ?? [],
      volume: m?.volume ?? null, difficulty: m?.difficulty ?? null, cpc: m?.cpc ?? null, intent: m?.intent ?? null, serp: cur?.serp ?? null,
    };
  });
  return { ok: true, rows, lastChecked };
}

/** Compact movement summary for alerts: keywords that moved a lot since the check before. */
export function movers(rows: RankRow[]) {
  const checked = rows.filter((r) => r.change !== null);
  return {
    dropped: checked.filter((r) => (r.change as number) <= -5 || (r.previous !== null && r.previous <= 10 && r.position === null)),
    gained: checked.filter((r) => (r.change as number) >= 5 || (r.position !== null && r.position <= 3 && (r.previous === null || r.previous > 3))),
  };
}

export { obj };
