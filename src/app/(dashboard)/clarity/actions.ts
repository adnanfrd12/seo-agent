"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { clarityInsights, ClarityError } from "@/lib/clarity/api";
import { encryptSecret } from "@/lib/crypto";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { processQueue } from "@/lib/sync/worker";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function requireAdmin() {
  const { user, client } = await getSession();
  if (!client) throw new Error("No client");
  return { user, client, allowed: ["owner", "admin"].includes(client.role) };
}

/** Validates the token with one real API call (uses 1 of Clarity's 10 daily requests), then stores it encrypted. */
export async function connectClarity(token: string): Promise<Result> {
  const t = z.string().trim().min(20).max(4000).safeParse(token);
  if (!t.success) return { ok: false, error: "Paste the full API token from Clarity → Settings → Data Export." };
  const { client, allowed } = await requireAdmin();
  if (!allowed) return { ok: false, error: "Only owners and admins can connect integrations." };
  try {
    await clarityInsights(t.data);
  } catch (e) {
    return { ok: false, error: e instanceof ClarityError ? e.message : "Couldn't reach Clarity. Try again." };
  }
  let encrypted: string;
  try { encrypted = encryptSecret(t.data); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Encryption failed." }; }

  const admin = createAdminClient();
  const { data: conn, error } = await admin.from("integration_connections").upsert(
    { client_id: client.id, provider: "clarity", auth_method: "api_token", status: "connected", last_error: null },
    { onConflict: "client_id,provider" },
  ).select("id").single();
  if (error || !conn) return { ok: false, error: "Could not save the connection (has migration 20261021000011 been applied?)." };
  await admin.from("integration_secrets").upsert({ connection_id: conn.id, refresh_token_encrypted: encrypted, updated_at: new Date().toISOString() });
  await admin.from("integration_resources").upsert(
    { client_id: client.id, connection_id: conn.id, provider: "clarity", external_id: "clarity-project", display_name: "Clarity project", is_selected: true },
    { onConflict: "client_id,provider,external_id" },
  );
  await (await createClient()).rpc("enqueue_sync_job", { p_client_id: client.id, p_provider: "clarity", p_job_type: "initial" });
  after(() => processQueue().catch(() => {}));
  revalidatePath("/clarity"); revalidatePath("/integrations");
  return { ok: true, message: "Clarity connected. The first day of data is importing now; history builds up daily." };
}

export async function disconnectClarity(): Promise<Result> {
  const { client, allowed } = await requireAdmin();
  if (!allowed) return { ok: false, error: "Only owners and admins can disconnect integrations." };
  const admin = createAdminClient();
  const { data: conn } = await admin.from("integration_connections").select("id").eq("client_id", client.id).eq("provider", "clarity").maybeSingle();
  if (conn) {
    await admin.from("integration_secrets").delete().eq("connection_id", conn.id);
    await admin.from("integration_connections").update({ status: "disconnected" }).eq("id", conn.id);
    await admin.from("integration_resources").update({ is_selected: false }).eq("connection_id", conn.id);
  }
  revalidatePath("/clarity"); revalidatePath("/integrations");
  return { ok: true, message: "Clarity disconnected. Stored history is kept." };
}

export async function syncClarityNow(): Promise<Result> {
  const { client, allowed } = await requireAdmin();
  if (!allowed) return { ok: false, error: "Only owners and admins can sync." };
  const { data, error } = await (await createClient()).rpc("enqueue_sync_job", { p_client_id: client.id, p_provider: "clarity", p_job_type: "manual" });
  if (error) return { ok: false, error: "Could not queue a sync." };
  after(() => processQueue().catch(() => {}));
  revalidatePath("/clarity");
  return { ok: true, message: data ? "Sync queued." : "A sync is already queued or running." };
}

const reviewSchema = z.object({
  page_url: z.string().trim().min(1).max(2000),
  recording_url: z.string().trim().max(2000).optional().transform((v) => v || null),
  device: z.enum(["desktop", "mobile", "tablet", "unknown"]),
  observed_on: z.iso.date().optional().or(z.literal("")).transform((v) => v || null),
  friction_type: z.enum(["rage_clicks", "dead_clicks", "non_interactive_click", "form_friction", "confusing_navigation",
    "missed_cta", "excessive_scroll", "abandonment", "mobile_usability", "broken_cta", "error", "other"]),
  severity: z.enum(["low", "medium", "high"]),
  observation: z.string().trim().min(3).max(4000),
});

/** A reviewer's observation from watching a recording in Clarity. Any member may add one. */
export async function addRecordingReview(input: z.input<typeof reviewSchema>): Promise<Result> {
  const p = reviewSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the form." };
  if (p.data.recording_url && !/^https:\/\//.test(p.data.recording_url)) return { ok: false, error: "Recording link must be an https URL." };
  const { user, client } = await requireAdmin();
  const { error } = await createAdminClient().from("clarity_recording_reviews").insert({ ...p.data, client_id: client.id, reviewer: user.id });
  if (error) return { ok: false, error: "Could not save the review." };
  revalidatePath("/clarity");
  return { ok: true, message: "Observation saved. It will be used as evidence in the next AI analysis." };
}
