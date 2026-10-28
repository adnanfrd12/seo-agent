import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Spending guard. Every paid call is logged in dfs_spend and checked here first:
 *  - total spend per UTC day can't pass the daily budget set on the Integrations page (default $1.50)
 *  - scheduled (auto) refreshes may only use AUTO_SHARE of that, leaving room for button clicks
 *  - one client can't use more than PER_CLIENT_SHARE (40%) of the cap on its own
 */
export type SpendSource = "auto" | "manual";
export const AUTO_SHARE = 0.6;
export const PER_CLIENT_SHARE = 0.4;
export const DEFAULT_DAILY_BUDGET = 1.5;

export class BudgetError extends Error {}

export interface DfsSettings { dailyBudget: number; autoRefresh: boolean }

/** The agency-wide spending settings (Integrations page). Falls back to $1.50 / on if the row is unavailable. */
export async function getSettings(admin: SupabaseClient): Promise<DfsSettings> {
  const { data } = await admin.from("dfs_settings").select("daily_budget, auto_refresh").eq("id", 1).maybeSingle();
  const b = Number(data?.daily_budget);
  return { dailyBudget: Number.isFinite(b) && b > 0 ? b : DEFAULT_DAILY_BUDGET, autoRefresh: data?.auto_refresh ?? true };
}

const today = () => new Date().toISOString().slice(0, 10);

export async function spend(admin: SupabaseClient, clientId?: string | null) {
  const q = admin.from("dfs_spend").select("cost").eq("day", today()).limit(10000);
  const { data, error } = clientId ? await q.eq("client_id", clientId) : await q;
  // never make a paid call when spending can't be tracked (e.g. the migration isn't applied yet)
  if (error) throw new BudgetError("API spend tracking isn't available, so no paid calls are made (apply migration 20261028000016).");
  return (data ?? []).reduce((a, r) => a + Number(r.cost), 0);
}

/** Spend for display: 0 when tracking isn't available instead of throwing. */
export async function spendOrZero(admin: SupabaseClient, clientId?: string | null) {
  try { return await spend(admin, clientId); } catch { return 0; }
}

/** Spend per day for the last `days` days (for the Integrations card). */
export async function spendHistory(admin: SupabaseClient, days = 7) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const { data } = await admin.from("dfs_spend").select("day, cost, source").gte("day", since).limit(20000);
  const byDay = new Map<string, { auto: number; manual: number }>();
  for (const r of data ?? []) {
    const o = byDay.get(r.day) ?? { auto: 0, manual: 0 };
    o[r.source as SpendSource] += Number(r.cost);
    byDay.set(r.day, o);
  }
  return [...byDay].sort((a, b) => b[0].localeCompare(a[0])).map(([day, v]) => ({ day, ...v, total: v.auto + v.manual }));
}

/** Throws BudgetError when a call of roughly `estimate` dollars would break a cap. */
export async function assertBudget(admin: SupabaseClient, clientId: string, estimate: number, source: SpendSource) {
  const cap = (await getSettings(admin)).dailyBudget;
  const total = await spend(admin);
  const limit = source === "auto" ? cap * AUTO_SHARE : cap;
  if (total + estimate > limit) {
    throw new BudgetError(source === "auto"
      ? `Scheduled refresh paused: today's automatic budget ($${(cap * AUTO_SHARE).toFixed(2)}) is used. It resumes tomorrow.`
      : `Daily API budget reached ($${total.toFixed(2)} of $${cap.toFixed(2)} spent today). Try again tomorrow, or raise the daily budget on the Integrations page.`);
  }
  const mine = await spend(admin, clientId);
  if (mine + estimate > cap * PER_CLIENT_SHARE) {
    throw new BudgetError(`This client has reached its daily API limit ($${mine.toFixed(2)} spent today). Everything fetched so far is saved; try again tomorrow.`);
  }
}

export async function recordSpend(admin: SupabaseClient, clientId: string, endpoint: string, cost: number, source: SpendSource) {
  if (cost > 0) {
    const { error } = await admin.from("dfs_spend").insert({ client_id: clientId, endpoint, cost, source });
    if (error) console.error("dfs_spend insert failed", error.message); // the pre-call spend check makes this very unlikely
  }
}
