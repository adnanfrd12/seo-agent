import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, recordSpend } from "./budget";
import { dfsPost } from "./client";
import { num, obj, str, type Ctx } from "./research";

/**
 * Lighthouse (Google's page-quality test) through DataForSEO On-Page, run on a small sample of pages,
 * mobile and desktop. Measured: $0.005 per page per device. On demand only; results stored per run.
 */
export const LH_EST = 0.005;
export interface LhRow {
  url: string; device: "mobile" | "desktop";
  performance: number | null; accessibility: number | null; best_practices: number | null; seo: number | null;
  lcp_ms: number | null; cls: number | null; tbt_ms: number | null; ttfb_ms: number | null; fcp_ms: number | null; speed_index_ms: number | null;
  error?: string;
}
export interface LhRun { checkedAt: string; cost: number; rows: LhRow[] }

const pct = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : null);

export async function runLighthouse(ctx: Ctx, urls: string[], devices: ("mobile" | "desktop")[]): Promise<LhRun> {
  const jobs = urls.flatMap((url) => devices.map((device) => ({ url, device })));
  await assertBudget(ctx.admin, ctx.clientId, jobs.length * LH_EST, ctx.source);
  let cost = 0;
  const rows: LhRow[] = [];
  // Lighthouse runs take 10-60 s each; three at a time keeps the request inside the server time limit
  for (let i = 0; i < jobs.length; i += 3) {
    const done = await Promise.all(jobs.slice(i, i + 3).map(async ({ url, device }): Promise<LhRow> => {
      try {
        // a slow page can take over a minute; one attempt only, so a timeout never bills twice
        const r = await dfsPost("/on_page/lighthouse/live/json", { url, for_mobile: device === "mobile" }, { timeoutMs: 125_000, attempts: 1 });
        cost += r.cost;
        const res = obj(r.result), cat = obj(res.categories), au = obj(res.audits);
        const a = (k: string) => num(obj(au[k]).numericValue);
        return {
          url: str(res.finalUrl) ?? url, device,
          performance: pct(obj(cat.performance).score), accessibility: pct(obj(cat.accessibility).score),
          best_practices: pct(obj(cat["best-practices"]).score), seo: pct(obj(cat.seo).score),
          lcp_ms: a("largest-contentful-paint"), cls: a("cumulative-layout-shift"), tbt_ms: a("total-blocking-time"),
          ttfb_ms: a("server-response-time"), fcp_ms: a("first-contentful-paint"), speed_index_ms: a("speed-index"),
        };
      } catch (e) {
        return { url, device, performance: null, accessibility: null, best_practices: null, seo: null, lcp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null, fcp_ms: null, speed_index_ms: null, error: e instanceof Error ? e.message : "failed" };
      }
    }));
    rows.push(...done);
  }
  await recordSpend(ctx.admin, ctx.clientId, "lighthouse", cost, ctx.source);
  const run: LhRun = { checkedAt: new Date().toISOString(), cost, rows };
  await ctx.admin.from("dfs_cache").upsert(
    { client_id: ctx.clientId, endpoint: "lighthouse", params_hash: run.checkedAt.slice(0, 10), params: { urls, devices }, data: run, row_count: rows.length, cost, fetched_at: run.checkedAt },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  return run;
}

/** Every stored run, newest first. */
export async function loadLighthouse(supabase: SupabaseClient, clientId: string): Promise<LhRun[]> {
  const { data } = await supabase.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "lighthouse").order("fetched_at", { ascending: false }).limit(20);
  return (data ?? []).map((r) => r.data as LhRun);
}
