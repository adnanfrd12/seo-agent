import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyOps } from "@/lib/notify";

/**
 * Wraps a scheduled job so every run is recorded in cron_runs (start, finish, outcome, error).
 * The record is best-effort: if the table isn't there yet the job still runs. A failure inside the
 * job is logged and rethrown, so the caller can return a proper error response.
 */
export async function loggedRun<T extends Record<string, unknown>>(admin: SupabaseClient, job: string, fn: () => Promise<T>): Promise<T> {
  const { data } = await admin.from("cron_runs").insert({ job }).select("id").maybeSingle();
  try {
    const summary = await fn();
    if (data) await admin.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: true, summary }).eq("id", data.id);
    return summary;
  } catch (e) {
    const message = (e instanceof Error ? e.message : "failed").slice(0, 500);
    if (data) await admin.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: false, error: message }).eq("id", data.id);
    await notifyOps(`Scheduled job "${job}" failed`, message); // optional webhook; never throws
    throw e;
  }
}

/** Latest run per job, for the Integrations "scheduled jobs" panel and the data-status menu. */
export async function lastRuns(admin: SupabaseClient) {
  const { data } = await admin.from("cron_runs").select("job, started_at, finished_at, ok, summary, error").order("started_at", { ascending: false }).limit(60);
  const latest = new Map<string, NonNullable<typeof data>[number]>();
  for (const r of data ?? []) if (!latest.has(r.job)) latest.set(r.job, r);
  return latest;
}

/** The UTC schedule in vercel.json, so the UI can say when the next run happens. */
export const SCHEDULE: Record<string, { hourUtc: number; minute: number; label: string }> = {
  sync: { hourUtc: 6, minute: 0, label: "Data sync (GA4, Search Console, Business Profile, Bing, Clarity)" },
  research: { hourUtc: 7, minute: 30, label: "Competitor analysis and SEO research (DataForSEO)" },
  extras: { hourUtc: 8, minute: 15, label: "AI visibility, map grids, Lighthouse, competitor profiles and deep dive" },
  ai: { hourUtc: 9, minute: 0, label: "AI insights and strategy" },
};

export function nextRun(job: keyof typeof SCHEDULE, now = new Date()): Date {
  const s = SCHEDULE[job];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.hourUtc, s.minute));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
