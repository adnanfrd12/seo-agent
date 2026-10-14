import "server-only";
import { ProviderAuthError, ProviderRateLimitError } from "@/lib/composio/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGa4 } from "./ga4";
import { GSC_TIME_ZONE, syncGsc } from "./gsc";

const DAY = 86_400_000;
const LOOKBACK_DAYS = { initial: 90, daily: 7, manual: 14 } as const;

type Job = {
  id: string;
  client_id: string;
  connection_id: string | null;
  resource_id: string | null;
  provider: "ga4" | "gsc" | "gbp";
  job_type: keyof typeof LOOKBACK_DAYS;
  range_start: string | null;
  range_end: string | null;
};

/** Today's date (YYYY-MM-DD) in an IANA time zone, falling back to UTC. */
function todayIn(timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
const shiftDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export interface QueueResult {
  processed: number;
  outcomes: Record<string, number>;
}

/**
 * Drains due jobs until the queue is empty or the time budget is spent. Safe to run from several
 * places at once: claim_next_sync_job uses SKIP LOCKED, and one active job per resource is
 * enforced by a unique index.
 */
export async function processQueue(opts: { budgetMs?: number } = {}): Promise<QueueResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const admin = createAdminClient();
  const result: QueueResult = { processed: 0, outcomes: {} };
  const tally = (k: string) => (result.outcomes[k] = (result.outcomes[k] ?? 0) + 1);

  await admin.rpc("requeue_stale_sync_jobs", { p_minutes: 15 });

  while (Date.now() < deadline) {
    const { data, error } = await admin.rpc("claim_next_sync_job");
    if (error || !data || data.length === 0) break;
    const job = data[0] as Job;
    result.processed++;

    const finish = (outcome: string, err: string | null, stats: unknown, authError = false) =>
      admin.rpc("finish_sync_job", {
        p_job_id: job.id, p_outcome: outcome, p_error: err, p_stats: stats ?? {}, p_auth_error: authError,
      });

    try {
      const { data: resource } = await admin
        .from("integration_resources")
        .select("external_id, timezone, is_selected, connection_id")
        .eq("id", job.resource_id ?? "")
        .maybeSingle();
      const { data: conn } = await admin
        .from("integration_connections")
        .select("status, composio_connected_account_id, composio_entity_id")
        .eq("id", job.connection_id ?? "")
        .maybeSingle();

      if (!resource || !resource.is_selected) {
        await finish("failed", "Resource no longer selected", {});
        tally("skipped");
        continue;
      }
      if (!conn || conn.status !== "connected" || !conn.composio_connected_account_id || !conn.composio_entity_id) {
        await finish("failed", "Connection is not active. Reconnect the integration.", {}, true);
        tally("auth");
        continue;
      }
      if (job.provider === "gbp") {
        // Honest failure instead of pretending: Business Profile import is not implemented yet.
        await finish("failed", "Google Business Profile sync is not implemented yet", {});
        tally("unsupported");
        continue;
      }

      // Each provider reports dates in its own time zone: GA4 in the property's, Search Console in Pacific.
      const end = job.range_end ?? todayIn(job.provider === "gsc" ? GSC_TIME_ZONE : resource.timezone);
      const start = job.range_start ?? shiftDays(end, -(LOOKBACK_DAYS[job.job_type] - 1));
      const ctx = { userId: conn.composio_entity_id, connectedAccountId: conn.composio_connected_account_id };
      const target = { clientId: job.client_id, resourceId: job.resource_id! };
      const run =
        job.provider === "ga4"
          ? await syncGa4(admin, ctx, { ...target, property: resource.external_id }, { start, end })
          : await syncGsc(admin, ctx, { ...target, siteUrl: resource.external_id }, { start, end });

      const stats = { range: { start, end }, written: run.written, failures: run.failures };
      const failed = Object.keys(run.failures).length;
      const ok = Object.keys(run.written).length;
      if (run.authError) {
        await finish("failed", "Google authorization failed. Reconnect the integration.", stats, true);
        tally("auth");
      } else if (failed === 0) {
        await finish("succeeded", null, stats);
        tally("succeeded");
      } else if (ok > 0) {
        await finish("partial", `${failed} report(s) failed: ${Object.keys(run.failures).join(", ")}`, stats);
        tally("partial");
      } else {
        await finish("retry", Object.values(run.failures)[0] ?? "all reports failed", stats);
        tally("retry");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      if (e instanceof ProviderAuthError) {
        await finish("failed", "Google authorization failed. Reconnect the integration.", {}, true);
        tally("auth");
      } else {
        // rate limits and transient errors back off exponentially (see finish_sync_job)
        await finish("retry", msg.slice(0, 500), {});
        tally(e instanceof ProviderRateLimitError ? "rate_limited" : "retry");
      }
    }
  }
  return result;
}
