import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiErrorMessage } from "@/lib/ai/claude";
import { recordClaudeUse } from "@/lib/ai/usage";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError } from "@/lib/dataforseo/client";
import type { Target } from "@/lib/dataforseo/research";
import { METHOD, type MethodContext } from "./method";
import { readPage } from "./pages";
import { MAX_KEYWORDS, MAX_PAGES, type FanoutMode, type FanoutQuery, type PageSummary } from "./shared";
import { volumeOf, volumes } from "./volume";

/** Keywords run 4 at a time and pages 3 at a time, so a full run stays well inside one request. */
const BATCH = { keywords: 4, pages: 3 };

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  return out;
}

/** Readable error for the UI and the run's failure list (an out-of-credit Anthropic account included). */
export const fanoutError = (e: unknown) => aiErrorMessage(e);

export interface RunOptions { kind: "keywords" | "pages"; inputs: string[]; mode: FanoutMode; withVolume: boolean; userId: string | null }
export interface RunOutcome { runId: string; queries: number; failed: number; aiCost: number; volumeCost: number; volumeNote: string | null }
type Row = FanoutQuery & { seed: string };

/** The fan-out tables exist (the migration is applied): checked before anything is spent. */
export async function fanoutReady(admin: SupabaseClient) {
  // a head request doesn't surface a missing table as an error, so read (at most) one row
  const { error } = await admin.from("fanout_runs").select("id").limit(1);
  return !error;
}

export async function runFanout(admin: SupabaseClient, clientId: string, target: Target, business: string, o: RunOptions): Promise<RunOutcome> {
  const inputs = o.inputs.slice(0, o.kind === "keywords" ? MAX_KEYWORDS : MAX_PAGES);
  const ctx: MethodContext = { site: target.domain, business };
  const rows: Row[] = [], errors: { input: string; error: string }[] = [], summaries: PageSummary[] = [];
  let aiCost = 0, model = METHOD.model;

  if (o.kind === "keywords") {
    const res = await inBatches(inputs, BATCH.keywords, (k) => METHOD.keyword(k, o.mode, ctx));
    res.forEach((r, i) => {
      if (r.status === "fulfilled") { aiCost += r.value.cost; model = r.value.model; rows.push(...r.value.queries.map((q) => ({ ...q, seed: inputs[i] }))); }
      else errors.push({ input: inputs[i], error: fanoutError(r.reason) });
    });
  } else {
    const res = await inBatches(inputs, BATCH.pages, async (url) => { const p = await readPage(url); return { f: await METHOD.page(p, o.mode, ctx), url: p.url, title: p.title }; });
    res.forEach((r, i) => {
      if (r.status === "rejected") { errors.push({ input: inputs[i], error: fanoutError(r.reason) }); return; }
      const { f, url, title } = r.value;
      aiCost += f.cost; model = f.model;
      rows.push(...f.queries.map((q) => ({ ...q, seed: url })));
      const n = (c: string) => f.queries.filter((q) => q.coverage === c).length;
      summaries.push({ url, title, topic: f.topic, mainQuery: f.mainQuery, covered: n("covered"), partial: n("partial"), missing: n("missing") });
    });
  }
  if (model && aiCost > 0) await recordClaudeUse(admin, clientId, "fanout", model, aiCost, inputs.length - errors.length);

  // nothing produced: report why instead of saving an empty run
  if (!rows.length) throw new Error(errors[0]?.error ?? "No fan-out queries came back. Try again.");

  // search volume is optional and never fails the run: what Claude produced is already paid for
  let volumeCost = 0, volumeNote: string | null = null;
  if (o.withVolume && rows.length) {
    try {
      const v = await volumes(admin, clientId, target, rows.map((r) => r.query));
      volumeCost = v.cost;
      for (const r of rows) r.volume = volumeOf(v.map, r.query);
    } catch (e) {
      volumeNote = e instanceof BudgetError || e instanceof DfsError ? e.message : "Search volumes couldn't be loaded.";
    }
  }

  const { data: run, error } = await admin.from("fanout_runs").insert({
    client_id: clientId, kind: o.kind, mode: o.mode, method: METHOD.id, model, inputs, query_count: rows.length,
    ai_cost_usd: Number(aiCost.toFixed(5)), volume_cost_usd: Number(volumeCost.toFixed(5)), errors, summaries, created_by: o.userId,
  }).select("id").single();
  if (error || !run) throw new Error(`Couldn't save the run: ${error?.message ?? "unknown error"}`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await admin.from("fanout_queries").insert(rows.slice(i, i + 500).map((r, j) => ({
      run_id: run.id, client_id: clientId, seed: r.seed, ord: i + j, query: r.query, type: r.type, intent: r.intent || null, reasoning: r.reasoning || null,
      coverage: r.coverage ?? null, suggestion: r.suggestion ?? null, volume: r.volume ?? null,
    })));
    if (e) throw new Error(`Couldn't save the queries: ${e.message}`);
  }
  return { runId: run.id as string, queries: rows.length, failed: errors.length, aiCost, volumeCost, volumeNote };
}

/* ------------------------------------------------------------------ reading (RLS client: members only) */
export interface RunListItem { id: string; kind: "keywords" | "pages"; mode: FanoutMode; method: string; inputs: string[]; query_count: number; ai_cost_usd: number; volume_cost_usd: number; created_at: string }
export interface RunDetail extends RunListItem { errors: { input: string; error: string }[]; summaries: PageSummary[]; queries: (FanoutQuery & { seed: string })[] }

export async function listRuns(db: SupabaseClient, clientId: string): Promise<{ runs: RunListItem[]; ready: boolean }> {
  const { data, error } = await db.from("fanout_runs").select("id, kind, mode, method, inputs, query_count, ai_cost_usd, volume_cost_usd, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(30);
  if (error) return { runs: [], ready: false };
  return { runs: (data ?? []).map((r) => ({ ...r, ai_cost_usd: Number(r.ai_cost_usd), volume_cost_usd: Number(r.volume_cost_usd) })) as RunListItem[], ready: true };
}

export async function loadRun(db: SupabaseClient, clientId: string, id: string): Promise<RunDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data: run }, { data: qs }] = await Promise.all([
    db.from("fanout_runs").select("id, kind, mode, method, inputs, query_count, ai_cost_usd, volume_cost_usd, created_at, errors, summaries").eq("client_id", clientId).eq("id", id).maybeSingle(),
    db.from("fanout_queries").select("seed, query, type, intent, reasoning, coverage, suggestion, volume").eq("client_id", clientId).eq("run_id", id).order("ord").limit(2000),
  ]);
  if (!run) return null;
  return {
    ...(run as unknown as RunDetail), ai_cost_usd: Number(run.ai_cost_usd), volume_cost_usd: Number(run.volume_cost_usd),
    queries: (qs ?? []).map((q) => ({ ...q, intent: q.intent ?? "", reasoning: q.reasoning ?? "", coverage: q.coverage ?? undefined, suggestion: q.suggestion ?? undefined })) as RunDetail["queries"],
  };
}
