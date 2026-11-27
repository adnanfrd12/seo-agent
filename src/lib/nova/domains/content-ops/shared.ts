import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientSpendOrZero, getSettings, orgSpendOrZero, PER_CLIENT_SHARE } from "@/lib/dataforseo/budget";
import { hostOf } from "@/lib/dataforseo/research";

/** Helpers shared by the content-ops tools (blog, social, data syncs, imports, client settings). */

/**
 * The client's website, read without side effects: the research target, else the selected Bing, Search Console or
 * Business Profile website. (resolveTarget() would also save a research target when there is none, so prepare and
 * read tools use this instead.)
 */
export async function websiteOf(admin: SupabaseClient, clientId: string): Promise<string | null> {
  const { data: t } = await admin.from("research_targets").select("domain").eq("client_id", clientId).maybeSingle();
  if (t?.domain) return String(t.domain);
  const { data: res } = await admin.from("integration_resources").select("provider, external_id, metadata").eq("client_id", clientId).eq("is_selected", true);
  const rows = (res ?? []) as { provider: string; external_id: string; metadata: Record<string, unknown> | null }[];
  const pick = (provider: string, f: (r: (typeof rows)[number]) => unknown) =>
    rows.filter((r) => r.provider === provider).map((r) => hostOf(typeof f(r) === "string" ? (f(r) as string) : null)).find(Boolean) ?? null;
  return pick("bing", (r) => r.external_id) ?? pick("gsc", (r) => r.external_id) ?? pick("gbp", (r) => r.metadata?.website);
}

/** What this client may still spend on DataForSEO today with a button click (the same caps assertBudget() checks). */
export async function dfsLeftToday(admin: SupabaseClient, clientId: string): Promise<{ left: number; cap: number }> {
  // the caps of the client's organization (its own DataForSEO account and daily limit)
  const [{ dailyBudget: cap }, total, mine] = await Promise.all([getSettings(admin, { clientId }), orgSpendOrZero(admin, { clientId }), clientSpendOrZero(admin, clientId)]);
  return { cap, left: Math.max(0, Math.min(cap - total, cap * PER_CLIENT_SHARE - mine)) };
}

/** $1.25, $0.067, $0.0003 */
export const usd = (n: number) => `$${n <= 0 ? "0" : n < 0.001 ? n.toFixed(4) : n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

/** "Nov 24, 06:07 UTC" style for Confirm cards; the model gets ISO strings. */
export const when = (iso: string | null | undefined, timeZone = "UTC") => {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  try {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
};

/** "3 hours ago", "2 days ago". */
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "unknown";
  return m < 2 ? "just now" : m < 90 ? `${m} minutes ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};

export const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Drops null, undefined and empty arrays so read outputs stay compact. */
export function compactObj<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))) as Partial<T>;
}

/** Read outputs stay under about 12,000 characters: `shrink` is called until the JSON fits (or it returns false). */
export function fit(value: unknown, shrink: () => boolean, max = 12_000): string {
  let s = JSON.stringify(value);
  while (s.length > max && shrink()) s = JSON.stringify(value);
  return s.length > max ? JSON.stringify({ truncated: "Too long: ask for fewer items or use the filters.", partial: s.slice(0, max - 200) }) : s;
}
