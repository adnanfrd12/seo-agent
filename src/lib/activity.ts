import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ACTIVE_DAYS = 14;

/** Records that someone opened this client (at most once an hour). Never blocks or breaks a page. */
export async function touchClient(admin: SupabaseClient, clientId: string) {
  try {
    const { data } = await admin.from("client_activity").select("last_seen_at").eq("client_id", clientId).maybeSingle();
    if (data && Date.now() - Date.parse(data.last_seen_at) < 3_600_000) return;
    await admin.from("client_activity").upsert({ client_id: clientId, last_seen_at: new Date().toISOString() }, { onConflict: "client_id" });
  } catch {
    // migration not applied yet, or a transient error: activity tracking is best-effort
  }
}

/** Clients opened within the last ACTIVE_DAYS days: the ones that get daily competitor analysis. */
export async function activeClientIds(admin: SupabaseClient): Promise<Set<string>> {
  const since = new Date(Date.now() - ACTIVE_DAYS * 86_400_000).toISOString();
  const { data } = await admin.from("client_activity").select("client_id").gte("last_seen_at", since).limit(5000);
  return new Set((data ?? []).map((r) => r.client_id as string));
}
