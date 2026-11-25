import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cachedRows } from "@/lib/data-cache";
import type { Candidate, RunState, StoredWin } from "./types";

/**
 * Storage of the quick wins engine, in dfs_cache (endpoint "aiqw", one client per row set):
 *   "items"            the current quick wins (key = candidate_id; status, owner, baseline carried across runs)
 *   "run:<id>"         one run: scope, progress steps, counts, token usage, cost, diff, rejections (the audit log)
 *   "candidates:last"  the last run's candidates and per-rule counts (debug view)
 *   "batch:pending"    a nightly Message Batch waiting to be collected
 */
const EP = "aiqw";

async function get<T>(admin: SupabaseClient, clientId: string, key: string): Promise<T | null> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", EP).eq("params_hash", key).maybeSingle();
  return (data?.data as T | undefined) ?? null;
}
async function put(admin: SupabaseClient, clientId: string, key: string, data: unknown, rows = 0, cost = 0) {
  const { error } = await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: EP, params_hash: key, params: { kind: key.split(":")[0] }, data, row_count: rows, cost, fetched_at: new Date().toISOString() }, { onConflict: "client_id,endpoint,params_hash" });
  if (error) throw new Error(`Couldn't save ${key}: ${error.message}`);
}

export const loadItems = async (admin: SupabaseClient, clientId: string) => (await get<{ items: StoredWin[] }>(admin, clientId, "items"))?.items ?? [];
/** Read-only copy for display (shared in memory until the list is saved again). Writers use loadItems. */
export const readItems = async (admin: SupabaseClient, clientId: string) => ((await cachedRows(admin, clientId, EP, ["items"])).get("items")?.data as { items: StoredWin[] } | undefined)?.items ?? [];
export const saveItems = (admin: SupabaseClient, clientId: string, items: StoredWin[]) => put(admin, clientId, "items", { items }, items.length);

export const loadRun = (admin: SupabaseClient, clientId: string, id: string) => get<RunState>(admin, clientId, `run:${id}`);
export const saveRun = (admin: SupabaseClient, run: RunState) => put(admin, run.clientId, `run:${run.id}`, run, run.counts.kept, run.usage.cost);

export async function listRuns(admin: SupabaseClient, clientId: string, limit = 30): Promise<RunState[]> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", EP).like("params_hash", "run:%").order("fetched_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => r.data as RunState).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** A run still in progress (started less than 6 minutes ago: older "running" rows were cut off by the function limit). */
export const activeRun = (runs: RunState[]) => runs.find((r) => r.status === "running" && Date.now() - Date.parse(r.startedAt) < 6 * 60_000) ?? null;

/** Claude spend this calendar month (UTC) for one client: logged runs plus Nova answers and roadmap generations. */
export async function claudeMonthSpend(admin: SupabaseClient, clientId: string): Promise<number> {
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const month = since.toISOString().slice(0, 7);
  const { data } = await admin.from("dfs_cache").select("params_hash, cost, data").eq("client_id", clientId).eq("endpoint", EP).or(`params_hash.like.run:%,params_hash.eq.ask:${month}`).gte("fetched_at", since.toISOString()).limit(1000);
  return (data ?? []).filter((r) => !String(r.params_hash).startsWith("run:") || String((r.data as RunState).startedAt ?? "") >= since.toISOString()).reduce((a, r) => a + Number(r.cost ?? 0), 0);
}

/** Adds one Nova answer's or roadmap generation's cost to this month's total (one row per month: calls and cost). */
export async function recordAskCost(admin: SupabaseClient, clientId: string, cost: number) {
  const key = `ask:${new Date().toISOString().slice(0, 7)}`;
  const cur = await get<{ questions: number; cost: number }>(admin, clientId, key);
  const next = { questions: (cur?.questions ?? 0) + 1, cost: Math.round(((cur?.cost ?? 0) + cost) * 10000) / 10000 };
  await put(admin, clientId, key, next, next.questions, next.cost);
}

export const saveCandidates = (admin: SupabaseClient, clientId: string, d: { at: string; perRule: Record<string, number>; candidates: Candidate[]; sent: string[] }) => put(admin, clientId, "candidates:last", d, d.candidates.length);
export const loadCandidates = (admin: SupabaseClient, clientId: string) => get<{ at: string; perRule: Record<string, number>; candidates: Candidate[]; sent: string[] }>(admin, clientId, "candidates:last");

export interface PendingBatch { batchId: string; runId: string; chunks: string[][]; submittedAt: string }
export const loadPending = (admin: SupabaseClient, clientId: string) => get<PendingBatch>(admin, clientId, "batch:pending");
export const savePending = (admin: SupabaseClient, clientId: string, p: PendingBatch) => put(admin, clientId, "batch:pending", p);
export const clearPending = async (admin: SupabaseClient, clientId: string) => { await admin.from("dfs_cache").delete().eq("client_id", clientId).eq("endpoint", EP).eq("params_hash", "batch:pending"); };
