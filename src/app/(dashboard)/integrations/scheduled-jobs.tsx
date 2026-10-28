import { CheckCircle2, CircleAlert, Clock } from "lucide-react";
import { lastRuns, nextRun, SCHEDULE } from "@/lib/jobs/log";
import { createAdminClient } from "@/lib/supabase/admin";

const when = (iso: string | Date | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "—");

const describe = (job: string, s: Record<string, unknown>) => {
  if (job === "sync") return `${s.processed ?? 0} jobs processed${Number(s.remaining) > 0 ? `, ${s.remaining} still queued` : ", queue empty"}`;
  if (job === "research") {
    const c = s.competitors as { analysed?: number; waiting?: number } | undefined, k = s.core as { refreshed?: number; waiting?: number } | undefined;
    if (s.skipped) return String(s.skipped);
    return `${c?.analysed ?? 0} competitor analyses (${c?.waiting ?? 0} waiting), ${k?.refreshed ?? 0} weekly refreshes (${k?.waiting ?? 0} waiting), ${s.alertsCreated ?? 0} new alerts`;
  }
  if (job === "ai") return `${s.generated ?? 0} analyses generated`;
  return "";
};

/** What runs automatically, when it last ran, when it runs next, and whether anything is backed up. Owners and admins only. */
export async function ScheduledJobs() {
  const admin = createAdminClient();
  const [runs, queued] = await Promise.all([
    lastRuns(admin).catch(() => new Map()),
    admin.from("analytics_sync_jobs").select("id", { count: "exact", head: true }).eq("status", "queued").lte("run_after", new Date().toISOString()),
  ]);
  const backlog = queued.count ?? 0;
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-5" aria-labelledby="jobs-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="jobs-title" className="text-base font-semibold">Automatic updates</h2>
          <p className="text-sm text-muted">Everything below runs on its own every day (times in your browser&apos;s locale, from UTC schedules). Nobody has to press a button for the dashboards to stay current.</p>
        </div>
        <span className={backlog > 0 ? "text-sm text-[#B7791F]" : "text-sm font-medium text-positive"}>{backlog > 0 ? `${backlog} sync jobs queued` : "Queue empty"}</span>
      </div>
      <ul className="mt-4 divide-y divide-border">
        {(Object.keys(SCHEDULE) as (keyof typeof SCHEDULE)[]).map((job) => {
          const r = runs.get(job) as { started_at: string; finished_at: string | null; ok: boolean | null; summary: Record<string, unknown>; error: string | null } | undefined;
          return (
            <li key={job} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3 text-sm">
              <span className="mt-0.5">{!r ? <Clock className="size-4 text-muted" aria-label="Not run yet" /> : r.ok === false ? <CircleAlert className="size-4 text-negative" aria-label="Failed" /> : <CheckCircle2 className="size-4 text-positive" aria-label="Succeeded" />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{SCHEDULE[job].label}</p>
                <p className="text-xs text-muted">{r ? `Last run ${when(r.started_at)}${r.ok === false ? ` failed: ${r.error ?? "unknown error"}` : `: ${describe(job, r.summary)}`}` : "No scheduled run recorded yet (runs are logged from the latest update on)."}</p>
              </div>
              <span className="text-xs text-muted">Next: {when(nextRun(job))}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">Third-party data is never real-time: Search Console is 2-3 days behind, GA4 finalises within 24-48 hours, and Business Profile a few days. Each dashboard shows when its data was last synced.</p>
    </section>
  );
}
