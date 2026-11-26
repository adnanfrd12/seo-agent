import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keepDay, RECORDINGS_ENDPOINT, sampleRecordings, type Recording } from "./recordings";
import { pagePath } from "./pages";

/**
 * What a script error actually was, from Microsoft's Clarity MCP dashboard endpoint
 * (POST https://clarity.microsoft.com/mcp/dashboard/query, same project Data Export token as the
 * recordings; this is what the official clarity-mcp-server's "query-analytics-dashboard" tool calls).
 *
 * Checked against live data (Nov 2026): it returns the error MESSAGE per page with a count
 * ({ VisitedUrl, JavaScriptErrorText, ErrorCount }) and, for click errors, the clicked element's text
 * ({ VisitedUrl, ClickedText, TotalClickErrors }). It does NOT return the script file, line/column,
 * stack trace or browser of an error, even when asked for them. The Data Export API
 * (project-live-insights) only has counts (subTotal, pagesViews, sessionsCount, percentages), and the
 * recordings endpoint has no error fields: its timeline lists clicks, not errors.
 *
 * Stored in dfs_cache under the recordings endpoint: "errors" is the latest set (refreshed once per UTC day),
 * "errors:YYYY-MM-DD" keeps every day's set. Page lookups are kept per page per day ("page:<path>@YYYY-MM-DD").
 * History rows are never deleted.
 */
const DASHBOARD = "https://clarity.microsoft.com/mcp/dashboard/query";
const ERRORS_KEY = "errors";
const PAGE_KEY = "page:";
/** recordings pulled per error message, for the top messages only (one call each) */
const MESSAGE_SAMPLES = 3;
/** on-demand page recording lookups per client per UTC day (each is one call; repeats are cached) */
export const PAGE_LOOKUPS_PER_DAY = 15;

export interface JsError { page: string | null; message: string; count: number }
export interface ClickError { page: string | null; element: string; count: number }
export interface ErrorDetails {
  fetchedAt: string;
  /** the period Clarity says it queried, e.g. "between '2026/11/24 00:00:00' and '2026/11/26 23:59:59'" */
  period: string | null;
  jsErrors: JsError[];
  clickErrors: ClickError[];
  /** recordings that hit a given error message (top messages only) */
  byMessage: Record<string, Recording[]>;
  error?: string;
}
export const ERROR_DETAILS_KEY = ERRORS_KEY;

type Row = Record<string, unknown>;
const num = (v: unknown) => { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : null; };
/** The column names come from Clarity's own query writer, so they're matched loosely. */
const pick = (r: Row, re: RegExp) => { const k = Object.keys(r).find((x) => re.test(x)); return k ? r[k] : undefined; };
const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 500) : "");

async function dashboardQuery(token: string, query: string): Promise<{ query: string | null; data: Row[] }> {
  const res = await fetch(DASHBOARD, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(45_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, timezone: "UTC" }),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Clarity rejected the token for error details.");
  if (res.status === 429) throw new Error("Clarity's request limit was reached; error details retry tomorrow.");
  if (!res.ok) throw new Error(`Clarity error-details request failed (${res.status}).`);
  const body = (await res.json()) as { query?: unknown; data?: unknown };
  return { query: typeof body.query === "string" ? body.query : null, data: Array.isArray(body.data) ? (body.data as Row[]) : [] };
}

export function parseJsErrors(data: Row[]): JsError[] {
  return data.map((r) => ({
    page: text(pick(r, /url|page/i)) || null,
    message: text(pick(r, /error.*(text|message)|message/i)),
    count: num(pick(r, /count|total/i)) ?? 0,
  })).filter((e) => e.message);
}

export function parseClickErrors(data: Row[]): ClickError[] {
  return data.map((r) => ({
    page: text(pick(r, /url|page/i)) || null,
    element: text(pick(r, /clicked|element|text/i)),
    count: num(pick(r, /count|total/i)) ?? 0,
  })).filter((e) => e.count > 0);
}

/** "between '...' and '...'" from Clarity's restated query, so the page can say which days it covers. */
const period = (q: string | null) => q?.match(/between '[^']+' and '[^']+'/)?.[0] ?? null;

/** 2 dashboard queries + up to 3 recording samples, once per UTC day. Returns the number of error rows. */
export async function syncErrorDetails(admin: SupabaseClient, clientId: string, token: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: prev } = await admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", RECORDINGS_ENDPOINT).eq("params_hash", ERRORS_KEY).maybeSingle();
  if (prev?.fetched_at && String(prev.fetched_at).slice(0, 10) === today) return 0;

  const set: ErrorDetails = { fetchedAt: new Date().toISOString(), period: null, jsErrors: [], clickErrors: [], byMessage: {} };
  try {
    const js = await dashboardQuery(token, "Top 50 JavaScript errors grouped by page URL and error text in the last 3 days");
    set.jsErrors = parseJsErrors(js.data); set.period = period(js.query);
    const clicks = await dashboardQuery(token, "Top 50 click errors grouped by page URL and clicked element in the last 3 days");
    set.clickErrors = parseClickErrors(clicks.data);
  } catch (e) { set.error = (e instanceof Error ? e.message : "failed").slice(0, 200); }

  const totals = new Map<string, number>();
  for (const e of set.jsErrors) totals.set(e.message, (totals.get(e.message) ?? 0) + e.count);
  for (const [message] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, MESSAGE_SAMPLES)) {
    try { set.byMessage[message] = await sampleRecordings(token, { javascriptErrors: [message] }, 6); }
    catch (e) { set.error ??= (e instanceof Error ? e.message : "failed").slice(0, 200); break; }
  }
  if (set.error && !set.jsErrors.length && !set.clickErrors.length && prev?.data) {
    // a failed day keeps the last good set (marked with the error) and isn't retried until tomorrow
    await admin.from("dfs_cache").update({ data: { ...(prev.data as ErrorDetails), error: set.error }, fetched_at: set.fetchedAt })
      .eq("client_id", clientId).eq("endpoint", RECORDINGS_ENDPOINT).eq("params_hash", ERRORS_KEY);
    return 0;
  }
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: RECORDINGS_ENDPOINT, params_hash: ERRORS_KEY, params: { days: 3 }, data: set, row_count: set.jsErrors.length + set.clickErrors.length, cost: 0, fetched_at: set.fetchedAt },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  await keepDay(admin, clientId, `${ERRORS_KEY}:`, set, set.fetchedAt, set.jsErrors.length + set.clickErrors.length, true);
  return set.jsErrors.length + set.clickErrors.length;
}

/**
 * Recordings from the last 3 days that visited one page (up to 50; the home page from the newest 150), fetched on demand and cached
 * for the UTC day. `url` is a full page URL the client's Clarity data already contains.
 */
export async function pageRecordings(admin: SupabaseClient, clientId: string, token: string, url: string):
  Promise<{ recordings: Recording[]; fetchedAt: string } | { error: string }> {
  const path = pagePath(url);
  const base = `${PAGE_KEY}${path}`.slice(0, 480);
  const today = new Date().toISOString().slice(0, 10);
  // every day's lookup is its own row ("page:<path>@YYYY-MM-DD"), so earlier recordings of the page stay available
  const { data: hist } = await admin.from("dfs_cache").select("params_hash, data, fetched_at").eq("client_id", clientId).eq("endpoint", RECORDINGS_ENDPOINT)
    .like("params_hash", `${base.replace(/[%_\\]/g, "\\$&")}@%`).order("fetched_at", { ascending: false }).limit(120);
  const rows = (hist ?? []) as { params_hash: string; data: { recordings?: Recording[] }; fetched_at: string }[];
  const merge = (fresh: Recording[]) => {
    const seen = new Set<string>(); const out: Recording[] = [];
    for (const r of [...fresh, ...rows.flatMap((h) => h.data?.recordings ?? [])]) if (!seen.has(r.link)) { seen.add(r.link); out.push(r); }
    return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  };
  const todays = rows.find((h) => h.params_hash === `${base}@${today}`);
  if (todays) return { recordings: merge([]), fetchedAt: todays.fetched_at };

  const { count } = await admin.from("dfs_cache").select("id", { count: "exact", head: true }).eq("client_id", clientId)
    .eq("endpoint", RECORDINGS_ENDPOINT).like("params_hash", `${PAGE_KEY}%`).gte("fetched_at", `${today}T00:00:00Z`);
  if ((count ?? 0) >= PAGE_LOOKUPS_PER_DAY) {
    if (rows.length) return { recordings: merge([]), fetchedAt: rows[0].fetched_at };
    return { error: `Clarity allows only a few lookups a day; ${PAGE_LOOKUPS_PER_DAY} pages were already loaded today. Try again tomorrow.` };
  }

  // "contains" is the URL operator Clarity honours (tested: matchesRegex returned nothing, isExactly didn't
  // narrow). "/" is in every URL, so for the home page the newest sessions are sampled and filtered below.
  const filter = path === "/" ? {} : { visitedUrls: [{ url: path, operator: "contains" }] };
  let recs: Recording[];
  try { recs = await sampleRecordings(token, filter, path === "/" ? 150 : 50); }
  catch (e) { return rows.length ? { recordings: merge([]), fetchedAt: rows[0].fetched_at } : { error: e instanceof Error ? e.message : "Clarity didn't respond." }; }
  // the filter is a pattern: keep only sessions that really opened this page
  recs = recs.filter((r) => (r.visited ?? [r.url]).some((u) => pagePath(u) === path));
  const fetchedAt = new Date().toISOString();
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: RECORDINGS_ENDPOINT, params_hash: `${base}@${today}`, params: { days: 3, page: path }, data: { recordings: recs }, row_count: recs.length, cost: 0, fetched_at: fetchedAt },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  return { recordings: merge(recs), fetchedAt };
}
