import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAILY_METRICS, fetchDailyMetrics, fetchMonthlyKeywords, GbpApiError } from "@/lib/google/gbp";
import { GoogleAuthError } from "@/lib/google/oauth";
import { gbpAccessToken } from "@/lib/integrations/gbp-service";
import type { SyncResult } from "./types";

const COLUMNS = Object.values(DAILY_METRICS);

/** First day of every month overlapping [start, end] (YYYY-MM-01). */
function months(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Imports Performance API daily metrics and monthly search keywords for one location.
 * Upserts are keyed on (resource, date) and (resource, month, keyword), so re-running a range
 * is idempotent and late-arriving Google data simply overwrites earlier values.
 */
export async function syncGbp(
  admin: SupabaseClient,
  t: { clientId: string; resourceId: string; connectionId: string; location: string },
  range: { start: string; end: string },
): Promise<SyncResult> {
  const written: Record<string, number> = {};
  const failures: Record<string, string> = {};
  let token: string;
  try {
    token = await gbpAccessToken(admin, t.connectionId);
  } catch (e) {
    return { written, failures: { auth: e instanceof Error ? e.message : "token refresh failed" }, authError: e };
  }
  const isAuth = (e: unknown) => e instanceof GoogleAuthError || (e instanceof GbpApiError && e.kind === "auth");
  // These can't be fixed by retrying: stop and surface the message instead of burning quota.
  const fatal = (e: unknown) => e instanceof GbpApiError && ["not_approved", "api_disabled", "permission"].includes(e.kind);

  try {
    const byDate = await fetchDailyMetrics(token, t.location, range.start, range.end);
    const present = new Set([...byDate.values()].flatMap((v) => Object.keys(v)));
    const rows = [...byDate].map(([metric_date, values]) => ({
      client_id: t.clientId, resource_id: t.resourceId, metric_date,
      // a metric Google returned for no date in the range stays null ("not reported"), not 0
      ...Object.fromEntries(COLUMNS.map((c) => [c, values[c] ?? (present.has(c) ? 0 : null)])),
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("gbp_daily_metrics").upsert(rows.slice(i, i + 500), { onConflict: "resource_id,metric_date" });
      if (error) throw new Error(`gbp_daily_metrics: ${error.message}`);
    }
    written.daily = rows.length;
  } catch (e) {
    if (isAuth(e)) return { written, failures: { daily: (e as Error).message }, authError: e };
    failures.daily = (e instanceof Error ? e.message : "failed").slice(0, 400);
    if (fatal(e)) return { written, failures, authError: null };
  }

  // keywords: month by month (a multi-month request returns one summed value per keyword)
  const [ey, em] = range.end.split("-").map(Number);
  const prevMonth = em === 1 ? `${ey - 1}-12-01` : `${ey}-${String(em - 1).padStart(2, "0")}-01`;
  const from = range.start < prevMonth ? range.start : prevMonth; // last month's keywords land a few days late
  let kw = 0;
  for (const month of months(from, range.end)) {
    try {
      const list = await fetchMonthlyKeywords(token, t.location, month);
      const rows = [...new Map(list.map((k) => [k.keyword, k])).values()].map((k) => ({
        client_id: t.clientId, resource_id: t.resourceId, month, keyword: k.keyword,
        impressions: k.impressions, impressions_threshold: k.threshold, updated_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("gbp_keyword_metrics").upsert(rows.slice(i, i + 500), { onConflict: "resource_id,month,keyword" });
        if (error) throw new Error(`gbp_keyword_metrics: ${error.message}`);
      }
      kw += rows.length;
    } catch (e) {
      if (isAuth(e)) return { written, failures: { ...failures, keywords: (e as Error).message }, authError: e };
      failures[`keywords ${month.slice(0, 7)}`] = (e instanceof Error ? e.message : "failed").slice(0, 300);
      if (fatal(e) || (e instanceof GbpApiError && e.kind === "rate_limit")) break;
    }
  }
  written.keywords = kw;
  return { written, failures, authError: null };
}
