import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Session recordings for each friction type, through Microsoft's own Clarity MCP endpoint
 * (POST https://clarity.microsoft.com/mcp/recordings/sample), which accepts the same project
 * Data Export token. It returns playback links (clarity.microsoft.com/player/...), not video files:
 * recordings can only be watched in Clarity's player.
 */
const ENDPOINT = "https://clarity.microsoft.com/mcp/recordings/sample";
export const RECORDINGS_ENDPOINT = "clarity_recordings";

export type IssueKey = "script_errors" | "error_clicks" | "rage_clicks" | "dead_clicks" | "quick_backs" | "excessive_scroll";
export const ISSUES: { key: IssueKey; metric: string; label: string; filter: Record<string, unknown> }[] = [
  { key: "script_errors", metric: "ScriptErrorCount", label: "Script errors", filter: { javascriptErrors: [""] } },
  { key: "error_clicks", metric: "ErrorClickCount", label: "Error clicks", filter: { clickErrors: [""] } },
  { key: "rage_clicks", metric: "RageClickCount", label: "Rage clicks", filter: { rageClickPresent: true } },
  { key: "dead_clicks", metric: "DeadClickCount", label: "Dead clicks", filter: { deadClickPresent: true } },
  { key: "quick_backs", metric: "QuickbackClick", label: "Quick backs", filter: { quickbackClickPresent: true } },
  { key: "excessive_scroll", metric: "ExcessiveScroll", label: "Excessive scrolling", filter: { excessiveScrollPresent: true } },
];

export interface Recording {
  link: string; at: string | null; duration: string | null; pages: number | null; clicks: number | null;
  url: string | null; title: string | null; lcp: string | null; events: string[];
  /** every page the session visited (older stored sets only have `url`) */
  visited?: string[];
}
export interface RecordingSet { fetchedAt: string; issues: Partial<Record<IssueKey, Recording[]>>; error?: string }

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "06:15 Dead click “READ MORE”" from a timeline event. */
function eventLabel(e: unknown): string | null {
  if (typeof e === "string") return e.slice(0, 160);
  const o = (e ?? {}) as Record<string, unknown>;
  const type = str(o.eventtype) ?? str(o.type) ?? str(o.name);
  if (!type) return null;
  const text = str(o.text)?.trim();
  return [str(o.start), type, text && `“${text.slice(0, 60)}”`].filter(Boolean).join(" ");
}

function parse(item: Record<string, unknown>): Recording | null {
  const link = str(item.link);
  if (!link?.startsWith("https://clarity.microsoft.com/")) return null;
  const tl = Array.isArray(item.timeline) ? (item.timeline as Record<string, unknown>[]) : [];
  const first = tl[0] ?? {};
  const events = tl.flatMap((p) => (Array.isArray(p.timelineEvents) ? p.timelineEvents : []))
    .map(eventLabel).filter((s): s is string => Boolean(s)).slice(0, 8);
  return {
    link, at: str(item.timestamp), duration: str(item.totalDuration), pages: num(item.pagesCount), clicks: num(item.sessionClickCount),
    url: str(first.url), title: str(first.displayTitle)?.slice(0, 140) ?? null, lcp: str(first.LCP), events,
    visited: [...new Set(tl.map((p) => str(p.url)).filter((u): u is string => Boolean(u)))].slice(0, 20),
  };
}

/** One call to the recordings endpoint for the last 3 days; `filter` uses the MCP server's filter names. */
export async function sampleRecordings(token: string, filter: Record<string, unknown>, count = 8): Promise<Recording[]> {
  const end = new Date(); const start = new Date(end.getTime() - 3 * 86_400_000);
  const date = { start: start.toISOString(), end: end.toISOString() };
  const res = await fetch(ENDPOINT, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sortBy: 0, ...date, filters: { date, ...filter }, count }),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Clarity rejected the token for recordings.");
  if (!res.ok) throw new Error(`Clarity recordings error ${res.status}.`);
  const body = (await res.json()) as unknown;
  return (Array.isArray(body) ? body : []).map((x) => parse(x as Record<string, unknown>)).filter((r): r is Recording => r !== null);
}

/** History rows: each day's set is kept as "<kind>:YYYY-MM-DD" and never deleted (the "<kind>" row is only the latest). */
export const DAY_PREFIX = "day:";
export async function keepDay(admin: SupabaseClient, clientId: string, key: string, data: unknown, fetchedAt: string, rowCount: number, overwrite: boolean): Promise<void> {
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: RECORDINGS_ENDPOINT, params_hash: `${key}${fetchedAt.slice(0, 10)}`, params: { days: 3, history: true }, data, row_count: rowCount, cost: 0, fetched_at: fetchedAt },
    { onConflict: "client_id,endpoint,params_hash", ignoreDuplicates: !overwrite },
  );
}

/**
 * Fetches recordings per issue once per UTC day. "all" holds the newest set; every day's set is also
 * kept as its own history row, so older recordings stay available.
 */
export async function syncRecordings(admin: SupabaseClient, clientId: string, token: string): Promise<number> {
  // the JavaScript error messages behind the script-error counts (own once-a-day guard; never blocks recordings)
  try { const { syncErrorDetails } = await import("./errors"); await syncErrorDetails(admin, clientId, token); } catch { /* stored with its error */ }
  const today = new Date().toISOString().slice(0, 10);
  const { data: prev } = await admin.from("dfs_cache").select("data, fetched_at, row_count").eq("client_id", clientId).eq("endpoint", RECORDINGS_ENDPOINT).eq("params_hash", "all").maybeSingle();
  if (prev?.fetched_at && String(prev.fetched_at).slice(0, 10) === today) return 0;
  // a set stored before history rows existed is archived before "all" is replaced
  if (prev?.data) await keepDay(admin, clientId, DAY_PREFIX, prev.data, new Date(prev.fetched_at).toISOString(), prev.row_count ?? 0, false);
  const set: RecordingSet = { fetchedAt: new Date().toISOString(), issues: {} };
  let total = 0;
  for (const i of ISSUES) {
    try { const r = await sampleRecordings(token, i.filter); set.issues[i.key] = r; total += r.length; }
    catch (e) { set.error = (e instanceof Error ? e.message : "failed").slice(0, 200); if (/rejected/.test(set.error)) break; }
  }
  if (!total && set.error) throw new Error(set.error);
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: RECORDINGS_ENDPOINT, params_hash: "all", params: { days: 3 }, data: set, row_count: total, cost: 0, fetched_at: set.fetchedAt },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  await keepDay(admin, clientId, DAY_PREFIX, set, set.fetchedAt, total, true);
  return total;
}

/** Background top-up from the Clarity page when today's recordings aren't stored yet (e.g. a new connection). */
export async function refreshRecordingsFor(admin: SupabaseClient, clientId: string): Promise<void> {
  const { data: conn } = await admin.from("integration_connections").select("id, status").eq("client_id", clientId).eq("provider", "clarity").maybeSingle();
  if (conn?.status !== "connected") return;
  const { data: secret } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", conn.id).maybeSingle();
  if (!secret?.refresh_token_encrypted) return;
  const { decryptSecret } = await import("@/lib/crypto");
  try { await syncRecordings(admin, clientId, decryptSecret(secret.refresh_token_encrypted)); } catch { /* shown as stale; the daily sync retries */ }
}
