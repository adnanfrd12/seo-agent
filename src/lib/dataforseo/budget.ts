import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientOrgId, orgConfig, type OrgConfig } from "@/lib/org/config";
import { dfsConfiguredIn } from "./client";

/**
 * Spending guard, per organization (each organization pays its own DataForSEO account). Every paid call is logged
 * in dfs_spend (per client) and checked here first:
 *  - an organization's spend per UTC day (all its clients) can't pass the daily budget it set on the Integrations
 *    page (default $1.50)
 *  - scheduled (auto) refreshes may only use AUTO_SHARE of that, leaving room for button clicks
 *  - one client can't use more than PER_CLIENT_SHARE (40%) of the cap on its own
 */
export type SpendSource = "auto" | "manual";
export const AUTO_SHARE = 0.6;
export const PER_CLIENT_SHARE = 0.4;
export const DEFAULT_DAILY_BUDGET = 1.5;

export class BudgetError extends Error {}

export interface DfsSettings { dailyBudget: number; autoRefresh: boolean }

/** An organization, or a client standing for its organization. */
export type OrgRef = { orgId: string } | { clientId: string };
export const orgOf = async (ref: OrgRef) => ("orgId" in ref ? ref.orgId : clientOrgId(ref.clientId));

const settingsOf = (row: { daily_budget?: unknown; auto_refresh?: boolean | null } | null | undefined): DfsSettings => {
  const b = Number(row?.daily_budget);
  return { dailyBudget: Number.isFinite(b) && b > 0 ? b : DEFAULT_DAILY_BUDGET, autoRefresh: row?.auto_refresh ?? true };
};

/** The organization's spending settings (Integrations page). $1.50 / on until it saves its own. */
export async function getSettings(admin: SupabaseClient, ref: OrgRef): Promise<DfsSettings> {
  const orgId = await orgOf(ref);
  const { data, error } = await admin.from("organization_dfs_settings").select("daily_budget, auto_refresh").eq("organization_id", orgId).maybeSingle();
  if (!error) return settingsOf(data);
  // until migration 20261129000037 is applied: the former agency-wide row, for the first organization only
  const { data: org } = await admin.from("organizations").select("uses_env_fallback").eq("id", orgId).maybeSingle();
  if (!org?.uses_env_fallback) return settingsOf(null);
  const { data: legacy } = await admin.from("dfs_settings").select("daily_budget, auto_refresh").eq("id", 1).maybeSingle();
  return settingsOf(legacy);
}

/** Saves an organization's spending settings. Callers check the user's organization role first. */
export async function saveSettings(admin: SupabaseClient, orgId: string, s: DfsSettings, actor: string | null): Promise<{ error: string | null }> {
  const { error } = await admin.from("organization_dfs_settings").upsert(
    { organization_id: orgId, daily_budget: Math.round(s.dailyBudget * 100) / 100, auto_refresh: s.autoRefresh, updated_by: actor, updated_at: new Date().toISOString() },
    { onConflict: "organization_id" },
  );
  return { error: error ? error.message : null };
}

const today = () => new Date().toISOString().slice(0, 10);
const NOT_TRACKED = "API spend tracking isn't available, so no paid calls are made (apply migration 20261028000016).";

/** Every row of a spend query (the API returns at most 1,000 rows per request). */
async function rows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new BudgetError(NOT_TRACKED);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const total = (list: { cost: unknown }[]) => list.reduce((a, r) => a + Number(r.cost), 0);

/** Today's spend of the whole organization (all its clients). Throws BudgetError when spending can't be tracked. */
export async function orgSpend(admin: SupabaseClient, ref: OrgRef): Promise<number> {
  const orgId = await orgOf(ref);
  const day = today();
  // never make a paid call when spending can't be tracked (e.g. the migration isn't applied yet)
  return total(await rows<{ cost: unknown }>((from, to) => admin.from("dfs_spend").select("cost, clients!inner(organization_id)")
    .eq("day", day).eq("clients.organization_id", orgId).order("id").range(from, to)));
}

/** Today's spend of one client. Throws BudgetError when spending can't be tracked. */
export async function clientSpend(admin: SupabaseClient, clientId: string): Promise<number> {
  const day = today();
  return total(await rows<{ cost: unknown }>((from, to) => admin.from("dfs_spend").select("cost").eq("day", day).eq("client_id", clientId).order("id").range(from, to)));
}

/** Spend for display: 0 when tracking isn't available instead of throwing. */
export async function orgSpendOrZero(admin: SupabaseClient, ref: OrgRef) {
  try { return await orgSpend(admin, ref); } catch { return 0; }
}
export async function clientSpendOrZero(admin: SupabaseClient, clientId: string) {
  try { return await clientSpend(admin, clientId); } catch { return 0; }
}

/** The organization's spend per day for the last `days` days (for the Integrations card). */
export async function spendHistory(admin: SupabaseClient, ref: OrgRef, days = 7) {
  const orgId = await orgOf(ref);
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  let data: { day: string; cost: unknown; source: string }[] = [];
  try {
    data = await rows((from, to) => admin.from("dfs_spend").select("day, cost, source, clients!inner(organization_id)")
      .gte("day", since).eq("clients.organization_id", orgId).order("id").range(from, to));
  } catch { /* nothing to show */ }
  const byDay = new Map<string, { auto: number; manual: number }>();
  for (const r of data) {
    const o = byDay.get(r.day) ?? { auto: 0, manual: 0 };
    o[r.source as SpendSource] += Number(r.cost);
    byDay.set(r.day, o);
  }
  return [...byDay].sort((a, b) => b[0].localeCompare(a[0])).map(([day, v]) => ({ day, ...v, total: v.auto + v.manual }));
}

/** Throws BudgetError when a call of roughly `estimate` dollars would break a cap of the client's organization. */
export async function assertBudget(admin: SupabaseClient, clientId: string, estimate: number, source: SpendSource) {
  const orgId = await clientOrgId(clientId);
  const [{ dailyBudget: cap }, all] = await Promise.all([getSettings(admin, { orgId }), orgSpend(admin, { orgId })]);
  const limit = source === "auto" ? cap * AUTO_SHARE : cap;
  if (all + estimate > limit) {
    throw new BudgetError(source === "auto"
      ? `Scheduled refresh paused: today's automatic budget ($${(cap * AUTO_SHARE).toFixed(2)}) is used. It resumes tomorrow.`
      : `Daily API budget reached ($${all.toFixed(2)} of $${cap.toFixed(2)} spent today). Try again tomorrow, or raise the daily budget on the Integrations page.`);
  }
  const mine = await clientSpend(admin, clientId);
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

/**
 * Budget bookkeeping for a scheduled run over many clients. Each client's organization has its own DataForSEO
 * account, daily limit, automatic-refresh switch and spend, so one organization's limit or missing setup never stops
 * the others:
 *  - `of(clientId)`: the client's organization budget, or null when its organization can't make automatic paid calls
 *    (DataForSEO not set up, automatic refresh off, spend not tracked); the reason is recorded once per organization
 *  - `under(clientId, share, est)`: true while the organization's spend today plus `est` stays under `share` of its
 *    daily limit, false when that share is used, null when the organization is skipped
 *  - `skipped()`: organizations left out and why, for the run summary (ids and counts only)
 * `resolve` replaces the organization lookups in tests.
 */
export function runBudgets(admin: SupabaseClient, resolve: { orgOfClient?: (clientId: string) => Promise<string>; config?: (orgId: string) => Promise<OrgConfig> } = {}) {
  const orgOfClient = resolve.orgOfClient ?? clientOrgId, configOf = resolve.config ?? orgConfig;
  type OrgBudget = { orgId: string; cap: number; spent: () => Promise<number> };
  const orgs = new Map<string, Promise<OrgBudget | string>>();
  const skipped = new Map<string, { reason: string; clients: Set<string> }>();
  const load = async (orgId: string): Promise<OrgBudget | string> => {
    if (!dfsConfiguredIn(await configOf(orgId))) return "DataForSEO isn't set up for this organization";
    const settings = await getSettings(admin, { orgId });
    if (!settings.autoRefresh) return "automatic refresh is turned off on the organization's Integrations page";
    try { await orgSpend(admin, { orgId }); } catch { return "spend tracking unavailable (apply the latest migrations)"; }
    return { orgId, cap: settings.dailyBudget, spent: () => orgSpend(admin, { orgId }).catch(() => Infinity) };
  };
  const of = async (clientId: string): Promise<OrgBudget | null> => {
    let orgId: string;
    try { orgId = await orgOfClient(clientId); } catch { return null; }
    if (!orgs.has(orgId)) orgs.set(orgId, load(orgId).catch(() => "its settings couldn't be read"));
    const b = await orgs.get(orgId)!;
    if (typeof b !== "string") return b;
    const s = skipped.get(orgId) ?? { reason: b, clients: new Set<string>() };
    s.clients.add(clientId);
    skipped.set(orgId, s);
    return null;
  };
  return {
    of,
    async under(clientId: string, share: number, est = 0): Promise<boolean | null> {
      const b = await of(clientId);
      if (!b) return null;
      const spent = await b.spent();
      return est > 0 ? spent + est <= b.cap * share : spent < b.cap * share;
    },
    skipped: () => [...skipped].map(([organization, s]) => ({ organization, clients: s.clients.size, reason: s.reason })),
    /** organizations that could run paid steps */
    active: async () => (await Promise.all(orgs.values())).filter((b) => typeof b !== "string").length,
    /** today's spend of each organization that could run paid steps (organization id → USD), for the run summary */
    spent: async () => {
      const ran = (await Promise.all(orgs.values())).filter((b): b is OrgBudget => typeof b !== "string");
      return Object.fromEntries(await Promise.all(ran.map(async (b) => [b.orgId, Number((await b.spent()).toFixed(3))] as const)));
    },
  };
}
