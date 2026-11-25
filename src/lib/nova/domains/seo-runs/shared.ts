import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSettings, PER_CLIENT_SHARE, spend } from "@/lib/dataforseo/budget";
import { MARKETS, marketByCode } from "@/lib/dataforseo/locations";
import { hostOf, obj, str, type Spec, type Target } from "@/lib/dataforseo/research";

/** Shared helpers for the SEO research / audit / local / toolkit tools. Everything here only reads. */

export const NOT_CONFIGURED = "DataForSEO isn't configured on the server (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD), so paid lookups can't run.";
export const NO_SITE = "The client's website isn't set yet: set it in the research settings (Backlinks or Organic Keywords page) or connect Search Console first.";

/* ------------------------------------------------------------------ formatting */
export const usd = (n: number) => `$${n.toFixed(2)}`;
/** "free", $0.0025, $0.014, $0.03, $0.13 */
export const money = (n: number) => {
  if (n <= 0) return "free";
  const s = n.toFixed(n < 0.01 ? 4 : n < 0.1 ? 3 : 2);
  return `$${s.replace(/(\.\d\d\d*?)0+$/, "$1")}`;
};
export const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
export const ageDays = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;
export const daysOld = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor(ageDays(iso))) : null);
/** "today", "yesterday", "5 days ago", "never" */
export const ago = (iso: string | null | undefined) => {
  const d = daysOld(iso);
  return d == null ? "never" : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
export const seconds = (s: number) => (s < 60 ? `about ${Math.round(s / 5) * 5 || 5} seconds` : `about ${Math.round(s / 30) / 2} minute${s >= 90 ? "s" : ""}`);
export const cut = (s: unknown, n = 160) => {
  if (typeof s !== "string") return s ?? null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
export const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));

function trim(v: unknown, arr: number, str: number): unknown {
  if (typeof v === "string") return v.length > str ? `${v.slice(0, str)}…` : v;
  if (Array.isArray(v)) {
    const out = v.slice(0, arr).map((x) => trim(x, arr, str));
    if (v.length > arr) out.push(`…and ${v.length - arr} more`);
    return out;
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, trim(x, arr, str)]));
  return v;
}
/** JSON for the model, at most `max` characters: long lists and texts are shortened step by step instead of cutting the JSON. */
export function capJson(v: unknown, max = 12_000): string {
  for (const [a, s] of [[Infinity, Infinity], [80, 400], [50, 300], [30, 220], [20, 160], [12, 120], [8, 100], [5, 80]] as const) {
    const out = JSON.stringify(trim(v, a, s));
    if (out.length <= max) return out;
  }
  return `${JSON.stringify(trim(v, 3, 60)).slice(0, max)}…(truncated)`;
}

/** Rows whose text fields contain `q` (case-insensitive). */
export function search<T extends Record<string, unknown>>(rows: T[], q?: string): T[] {
  const s = q?.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(s)));
}

/* ------------------------------------------------------------------ markets */
const ISO: Record<number, string> = {
  2840: "us", 2826: "uk", 2124: "ca", 2036: "au", 2554: "nz", 2372: "ie", 2356: "in", 2586: "pk", 2608: "ph", 2702: "sg", 2784: "ae", 2710: "za", 2276: "de", 2250: "fr", 2724: "es", 2484: "mx",
};
export const MARKET_KEYS = MARKETS.map((m) => ISO[m.code] ?? String(m.code)) as [string, ...string[]];
/** For the schema: the markets are country codes (uk = United Kingdom, ae = United Arab Emirates, ...). */
export const marketDescription = "country (Canada is English); default: the client's research market";
export const marketOf = (key: string | undefined, fallback: number) => {
  const code = key ? Number(Object.entries(ISO).find(([, k]) => k === key)?.[0] ?? key) : fallback;
  return marketByCode(code) ?? marketByCode(fallback) ?? MARKETS[0];
};
export const marketKey = (code: number) => ISO[code] ?? String(code);

/* ------------------------------------------------------------------ the client's research website (read-only) */
export interface PeekTarget extends Target {
  auto_refresh: boolean; competitors: string[]; competitors_excluded: string[]; competitor_mode: "auto" | "manual";
  /** false: not saved yet; the first run saves it (resolveTarget) from the same connected source */
  saved: boolean; source?: string;
}

/**
 * The research website like resolveTarget (saved target, else the Bing / Search Console / Business Profile site), but it
 * never writes: resolveTarget saves a derived target, which a prepare must not do.
 */
export async function peekTarget(admin: SupabaseClient, clientId: string): Promise<PeekTarget | null> {
  const full = await admin.from("research_targets").select("domain, location_code, language_code, auto_refresh, competitors, competitors_excluded, competitor_mode").eq("client_id", clientId).maybeSingle();
  const t = full.error
    ? (await admin.from("research_targets").select("domain, location_code, language_code, auto_refresh, competitors").eq("client_id", clientId).maybeSingle()).data
    : full.data;
  if (t) return { competitors_excluded: [], competitor_mode: "auto", ...t, competitors: (t.competitors as string[] | null) ?? [], saved: true } as PeekTarget;
  const { data: res } = await admin.from("integration_resources").select("provider, external_id, metadata").eq("client_id", clientId).eq("is_selected", true);
  const pick = (provider: string, f: (r: { external_id: string; metadata: unknown }) => string | null | undefined) =>
    (res ?? []).filter((r) => r.provider === provider).map((r) => hostOf(f(r as { external_id: string; metadata: unknown }))).find(Boolean);
  const found = ([["Bing", pick("bing", (r) => r.external_id)], ["Search Console", pick("gsc", (r) => r.external_id)], ["Business Profile", pick("gbp", (r) => str(obj(r.metadata).website))]] as const).find(([, d]) => d);
  if (!found) return null;
  return { domain: found[1]!, location_code: 2840, language_code: "en", auto_refresh: true, competitors: [], competitors_excluded: [], competitor_mode: "auto", saved: false, source: found[0] };
}
export const targetNote = (t: PeekTarget) => (t.saved ? null : `Website: ${t.domain} (from ${t.source}; it is saved as the research website when this runs).`);

/** A domain typed by the user, cleaned like the dashboard does (research-actions domainSchema), or null. */
export function domainOf(input: string | undefined | null): string | null {
  const h = hostOf((input ?? "").trim().toLowerCase());
  return h && /^(?!-)([a-z0-9-]+\.)+[a-z]{2,}$/.test(h) ? h : null;
}

/* ------------------------------------------------------------------ DataForSEO spending (mirrors budget.ts) */
export interface Budget { cap: number; clientCap: number; all: number | null; mine: number | null; left: number; autoRefresh: boolean }

export async function budgetNow(admin: SupabaseClient, clientId: string): Promise<Budget> {
  const [settings, all, mine] = await Promise.all([getSettings(admin), spend(admin).catch(() => null), spend(admin, clientId).catch(() => null)]);
  const cap = settings.dailyBudget, clientCap = cap * PER_CLIENT_SHARE;
  const left = all == null || mine == null ? 0 : Math.max(0, Math.min(cap - all, clientCap - mine));
  return { cap, clientCap, all, mine, left, autoRefresh: settings.autoRefresh };
}
export const spendLine = (b: Budget) => (b.all == null || b.mine == null
  ? "DataForSEO spend tracking isn't available right now."
  : `DataForSEO today: ${usd(b.all)} of the ${usd(b.cap)} daily limit spent (all clients); this client ${usd(b.mine)} of its ${usd(b.clientCap)} share, so ${money(b.left)} is left for it until midnight UTC.`);

/**
 * The same caps assertBudget applies to a button click: the run needs room for at least its first paid call (`first`);
 * `total` is the whole run (multi-call runs stop at the limit and keep what they fetched).
 */
export async function budgetCheck(admin: SupabaseClient, clientId: string, total: number, first = total): Promise<{ error: string } | { lines: string[] }> {
  const b = await budgetNow(admin, clientId);
  if (b.all == null || b.mine == null) return { error: "DataForSEO spend tracking isn't available, so no paid lookups can run right now." };
  if (first > b.left + 1e-9) {
    return { error: `Today's DataForSEO limit doesn't leave room for this (needs about ${money(first)}; ${money(b.left)} left for this client: ${usd(b.all)} of ${usd(b.cap)} spent today across all clients, one client may use ${usd(b.clientCap)}). It resets at midnight UTC, or an owner/admin can raise the daily limit.` };
  }
  const lines = [spendLine(b)];
  if (total > b.left + 1e-9) lines.push(`Only ${money(b.left)} is left today, so the run may stop part-way; everything fetched before that is kept.`);
  return { lines };
}

/* ------------------------------------------------------------------ which stored answers a run would reuse (mirrors ensure()) */
const sha1 = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex");
export interface PlannedCall { label: string; est: number; fresh: boolean; fetchedAt: string | null }

/**
 * For each call of a run: is its stored answer still fresh (then ensure() reuses it for free)? Uses ensure()'s own cache
 * key (sha1 of the request body), so bodies that change daily (dated ranges) count as due, exactly as the run will.
 */
export async function planCalls(admin: SupabaseClient, clientId: string, target: Target, calls: { label: string; spec: Spec; extra?: string }[], force: boolean): Promise<PlannedCall[]> {
  if (!calls.length) return [];
  const keyed = calls.map((c) => ({ ...c, hash: sha1(c.spec.body(target, c.extra)) }));
  const { data } = await admin.from("dfs_cache").select("endpoint, params_hash, fetched_at").eq("client_id", clientId)
    .in("endpoint", [...new Set(keyed.map((k) => k.spec.key))]).in("params_hash", [...new Set(keyed.map((k) => k.hash))]);
  return keyed.map((k) => {
    const row = (data ?? []).find((r) => r.endpoint === k.spec.key && r.params_hash === k.hash);
    return { label: k.label, est: k.spec.est, fresh: !force && Boolean(row) && ageDays(row!.fetched_at as string) < k.spec.ttlDays, fetchedAt: (row?.fetched_at as string | undefined) ?? null };
  });
}

/* ------------------------------------------------------------------ keyword research (dfs_keyword_cache) */
/** The seed check of researchKeywords (research-actions.ts). */
export const seedSchema = z.string().trim().min(2).max(80).regex(/^[^<>{}\\]+$/, "Remove special characters");
/** How keywordResearch normalises a seed. */
export const normSeed = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** keywordResearch's budget estimate per search (lib/dataforseo/research.ts KW_EST, not exported). */
export const KW_EST: Record<"ideas" | "suggestions" | "related", number> = { ideas: 0.03, suggestions: 0.03, related: 0.02 };

/**
 * The newest stored search for these settings. The keyword cache is shared by all clients (keyword data isn't
 * client-specific: the dashboard returns another client's stored search for free too), so it is matched on the exact
 * request (seed, market) and never listed.
 */
export async function storedSearch(admin: SupabaseClient, kind: string, term: string, location_code: number, language_code: string, withData: boolean) {
  const params = kind === "ideas" ? { keywords: [term], location_code, language_code } : { keyword: term, location_code, language_code };
  const { data } = await admin.from("dfs_keyword_cache").select(withData ? "data, fetched_at, row_count" : "fetched_at, row_count")
    .eq("endpoint", `keywords_${kind}`).contains("params", params).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  return data as unknown as { data?: { rows: Record<string, unknown>[]; total: number }; fetched_at: string; row_count: number | null } | null;
}

/** Newest stored row of an endpoint for this client. */
export async function latest<T = unknown>(admin: SupabaseClient, clientId: string, endpoint: string, key?: string): Promise<{ data: T; fetchedAt: string; params: Record<string, unknown>; cost: number } | null> {
  let q = admin.from("dfs_cache").select("data, fetched_at, params, cost").eq("client_id", clientId).eq("endpoint", endpoint);
  if (key) q = q.eq("params_hash", key);
  const { data } = await q.order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { data: data.data as T, fetchedAt: data.fetched_at as string, params: (data.params ?? {}) as Record<string, unknown>, cost: Number(data.cost ?? 0) } : null;
}
