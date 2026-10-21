import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clarityInsights, ClarityError, flatten, type ClarityDimension } from "@/lib/clarity/api";
import { decryptSecret } from "@/lib/crypto";
import type { SyncResult } from "./types";

const CALLS: (ClarityDimension | undefined)[] = [undefined, "URL", "Device"]; // 3 of the 10 daily requests

/**
 * Imports the last 24 hours of Clarity aggregates as "yesterday (UTC)". Clarity can't return
 * older data, so history is built one day at a time by the daily sync.
 */
export async function syncClarity(
  admin: SupabaseClient, t: { clientId: string; resourceId: string; connectionId: string },
): Promise<SyncResult> {
  const written: Record<string, number> = {};
  const failures: Record<string, string> = {};
  let authError: unknown | null = null;

  // stay well inside the 10-requests/day quota: at most 3 Clarity syncs per UTC day
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await admin.from("analytics_sync_jobs").select("id", { count: "exact", head: true })
    .eq("resource_id", t.resourceId).in("status", ["succeeded", "partial"]).gte("finished_at", `${today}T00:00:00Z`);
  if ((count ?? 0) >= 3) return { written, failures: { quota: "Clarity was already synced 3 times today (API limit is 10 requests/day)." }, authError };

  const { data: secret } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", t.connectionId).maybeSingle();
  if (!secret?.refresh_token_encrypted) return { written, failures: { token: "No Clarity token stored." }, authError: new Error("no token") };
  const token = decryptSecret(secret.refresh_token_encrypted);
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  for (const dim of CALLS) {
    const name = dim ?? "total";
    try {
      const rows = flatten(await clarityInsights(token, dim), dim).map((r) => ({
        client_id: t.clientId, resource_id: t.resourceId, metric_date: day, ...r,
      }));
      const dedup = [...new Map(rows.map((r) => [`${r.dimension}|${r.value}|${r.metric}`, r])).values()];
      for (let i = 0; i < dedup.length; i += 500) {
        const { error } = await admin.from("clarity_behavior_metrics").upsert(dedup.slice(i, i + 500), { onConflict: "resource_id,metric_date,dimension,value,metric" });
        if (error) throw new Error(`clarity_behavior_metrics: ${error.message}`);
      }
      written[name] = dedup.length;
    } catch (e) {
      if (e instanceof ClarityError && e.kind === "auth") { authError = e; failures[name] = e.message; break; }
      failures[name] = (e instanceof Error ? e.message : "failed").slice(0, 300);
      if (e instanceof ClarityError && e.kind === "rate_limit") break;
    }
  }
  return { written, failures, authError };
}
