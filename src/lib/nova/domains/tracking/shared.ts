import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_DAYS } from "@/lib/activity";
import { getSettings, PER_CLIENT_SHARE, spendOrZero } from "@/lib/dataforseo/budget";
import { hostOf } from "@/lib/dataforseo/research";

/** Helpers shared by the tracked-list tools (rank tracking, AI visibility, competitors, brand terms). */

/** $1.25; small amounts keep their real precision: $0.0155, $0.046, $0.02. */
export function money(n: number): string {
  if (!(n > 0 && n < 0.1)) return `$${n.toFixed(2)}`;
  const [whole, dec = ""] = n.toFixed(4).replace(/0+$/, "").split(".");
  return `$${whole}.${dec.padEnd(2, "0")}`;
}

export const uniq = <T,>(list: T[]) => [...new Set(list)];

/** "a", "a and b", "a, b and c" */
export const andList = (l: string[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l.at(-1)}`);

export const round1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

/** Drops empty values so read outputs stay compact. */
export function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));
}

/** JSON for the model, at most `max` characters: the list under `key` is shortened until it fits. */
export function capJson(base: Record<string, unknown>, key: string, list: unknown[], max = 12_000): string {
  let out = JSON.stringify({ ...base, [key]: list });
  for (let n = list.length - 1; out.length > max && n >= 0; n--) {
    out = JSON.stringify({ ...base, [key]: list.slice(0, n), [`${key}_not_shown`]: list.length - n });
  }
  return out;
}

/** "Name (desktop)" style lists for Confirm cards, quoted. */
export const quoted = (s: string) => `“${s}”`;

/** Scheduled DataForSEO jobs only run for clients someone opened recently (src/lib/activity.ts). */
export const ACTIVE_NOTE = `clients opened in the last ${ACTIVE_DAYS} days`;

export const NO_TARGET = "This client has no research website yet. Opening the Rank Tracking or Competitors page as an owner or admin sets it from Search Console, Bing or Business Profile.";

export interface TargetInfo {
  domain: string; location_code: number; language_code: string; auto_refresh: boolean;
  competitors: string[]; competitors_excluded: string[]; competitor_mode: "auto" | "manual";
}

/** The saved research target, read only (resolveTarget() would create one; prepare must not change anything). */
export async function readTarget(admin: SupabaseClient, clientId: string): Promise<TargetInfo | null> {
  const full = await admin.from("research_targets").select("domain, location_code, language_code, auto_refresh, competitors, competitors_excluded, competitor_mode").eq("client_id", clientId).maybeSingle();
  // before migration 18 the last two columns don't exist
  const t = full.error
    ? (await admin.from("research_targets").select("domain, location_code, language_code, auto_refresh, competitors").eq("client_id", clientId).maybeSingle()).data
    : full.data;
  if (!t) return null;
  return { competitors_excluded: [], competitor_mode: "auto", ...t, competitors: (t.competitors ?? []) as string[] } as TargetInfo;
}

/** A bare domain like example.com (the same rule as the dashboard's research forms), or null. */
const DOMAIN_RE = /^(?!-)([a-z0-9-]+\.)+[a-z]{2,}$/;
export function cleanDomain(raw: string): string | null {
  const h = hostOf(raw.trim().toLowerCase());
  return h && DOMAIN_RE.test(h) ? h : null;
}
export const sameDomain = (a: string, b: string) => a.replace(/^www\./, "").toLowerCase() === b.replace(/^www\./, "").toLowerCase();

/**
 * Today's DataForSEO spend against the caps assertBudget() enforces for button-started ("manual") runs:
 * the daily budget for everything, and PER_CLIENT_SHARE of it for one client. `left` is what this client may still spend today.
 */
export async function dfsBudget(admin: SupabaseClient, clientId: string) {
  const [settings, all, mine] = await Promise.all([getSettings(admin), spendOrZero(admin), spendOrZero(admin, clientId)]);
  const cap = settings.dailyBudget, clientCap = cap * PER_CLIENT_SHARE;
  const left = Math.max(0, Math.min(cap - all, clientCap - mine));
  return {
    left,
    line: `DataForSEO today: ${money(all)} of the ${money(cap)} daily cap used; this client ${money(mine)} of its ${money(clientCap)} limit (${Math.round(PER_CLIENT_SHARE * 100)}% of the cap). A run stops at a cap and keeps what it fetched.`,
    exhausted: `Today's DataForSEO limit is used up for this client (${money(mine)} of ${money(clientCap)}, or ${money(all)} of the ${money(cap)} cap overall). Try again tomorrow, or raise the daily budget on the Integrations page.`,
  };
}

/**
 * Whether the scheduled DataForSEO jobs run for this client: the agency-wide switch (Integrations page) and the
 * client's own automatic refresh must both be on. Returns null when they run, else why not.
 */
export async function scheduleOff(admin: SupabaseClient, target: TargetInfo | null): Promise<string | null> {
  if (!(await getSettings(admin)).autoRefresh) return "automatic refresh is off for all clients (Integrations page)";
  if (target && !target.auto_refresh) return "this client's automatic research refresh is off";
  return null;
}

/** Days since an ISO time (Infinity when missing). */
export const ageDays = (iso: string | null | undefined) => (iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : Infinity);
