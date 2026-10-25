import "server-only";
import { ProviderAuthError, ProviderRateLimitError } from "@/lib/composio/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGa4 } from "./ga4";
import { GSC_TIME_ZONE, syncGsc } from "./gsc";
import { syncClarity } from "./clarity";
import { syncGbp } from "./gbp";

const DAY = 86_400_000;
const LOOKBACK_DAYS = { initial: 90, daily: 7, manual: 14, backfill: 90 } as const;

/**
 * "As much history as the API allows": after the initial import, older chunks are queued one at a
 * time (one active job per resource) until the provider's limit, or until a chunk comes back
 * empty (the property/site didn't exist yet).
 *   GSC keeps 16 months, the GBP Performance API serves 18 months, GA4 has no fixed limit.
 */
const BACKFILL = {
  gsc: { maxDays: 486, chunk: 90 },
  gbp: { maxDays: 540, chunk: 180 },
  ga4: { maxDays: 5 * 365, chunk: 90 },
} as const;

type Job = {
  id: string;
  client_id: string;
  connection_id: string | null;
  resource_id: string | null;
  provider: "ga4" | "gsc" | "gbp" | "clarity";
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
      // Clarity (API token) and Business Profile (direct Google OAuth) don't use Composio
      const viaComposio = job.provider === "ga4" || job.provider === "gsc";
      if (!conn || conn.status !== "connected" || (viaComposio && (!conn.composio_connected_account_id || !conn.composio_entity_id))) {
        await finish("failed", "Connection is not active. Reconnect the integration.", {}, true);
        tally("auth");
        continue;
      }
      // Each provider reports dates in its own time zone: GA4 in the property's, Search Console in Pacific.
      const end = job.range_end ?? todayIn(job.provider === "gsc" ? GSC_TIME_ZONE : resource.timezone);
      const start = job.range_start ?? shiftDays(end, -(LOOKBACK_DAYS[job.job_type] - 1));
      const target = { clientId: job.client_id, resourceId: job.resource_id! };
      const ctx = { userId: conn.composio_entity_id ?? "", connectedAccountId: conn.composio_connected_account_id ?? "" };
      const run =
        job.provider === "clarity"
          ? await syncClarity(admin, { ...target, connectionId: job.connection_id! })
          : job.provider === "gbp"
            ? await syncGbp(admin, { ...target, connectionId: job.connection_id!, location: resource.external_id }, { start, end })
          : job.provider === "ga4"
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
        await queueOlderChunk(admin, job, start, run.written);
      } else if (ok > 0) {
        await finish("partial", `${failed} report(s) failed: ${Object.entries(run.failures).map(([k, v]) => `${k}: ${v}`).join("; ").slice(0, 900)}`, stats);
        tally("partial");
        await queueOlderChunk(admin, job, start, run.written);
      } else if (Object.values(run.failures).some((m) => /quota 0|is not enabled|not enabled in the Google Cloud|cannot access the profile/i.test(m))) {
        // retrying can't fix missing API approval or permissions: fail once with Google's reason
        await finish("failed", Object.values(run.failures)[0]!.slice(0, 900), stats);
        tally("failed");
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

/** Chains the next-older history chunk after a successful initial/backfill import. */
async function queueOlderChunk(admin: ReturnType<typeof createAdminClient>, job: Job, start: string, written: Record<string, number>) {
  if (job.provider === "clarity" || (job.job_type !== "initial" && job.job_type !== "backfill")) return;
  // an empty older chunk means there is no earlier data
  if (job.job_type === "backfill" && Object.values(written).every((n) => !n)) return;
  const { maxDays, chunk } = BACKFILL[job.provider];
  const floor = shiftDays(todayIn("UTC"), -maxDays);
  const end = shiftDays(start, -1);
  if (end < floor) return;
  const from = shiftDays(end, -(chunk - 1));
  await admin.from("analytics_sync_jobs").insert({
    client_id: job.client_id, connection_id: job.connection_id, resource_id: job.resource_id, provider: job.provider,
    job_type: "backfill", range_start: from < floor ? floor : from, range_end: end,
  }); // a unique-index conflict just means another job is already active for this resource
}
