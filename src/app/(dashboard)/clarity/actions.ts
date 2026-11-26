"use server";

import { after } from "next/server";
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { clarityInsights, ClarityError } from "@/lib/clarity/api";
import { pagePath } from "@/lib/clarity/pages";
import type { Recording } from "@/lib/clarity/recordings";
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
    // disconnect deletes the stored key and every row of data read with it (src/lib/compliance/deletion.ts)
    const { handleDeletionRequest } = await import("@/lib/compliance/deletion");
    await handleDeletionRequest(admin, { platform: "microsoft_clarity", platformUserId: null, source: "dashboard", workspaceId: client.id, refs: [conn.id] });
  }
  revalidatePath("/clarity"); revalidatePath("/integrations");
  return { ok: true, message: "Clarity disconnected. The key and the data read with it were deleted." };
}

export async function syncClarityNow(): Promise<Result> {
  const { client, allowed } = await requireAdmin();
  if (!allowed) return { ok: false, error: "Only owners and admins can sync." };
  const { data, error } = await (await createClient()).rpc("enqueue_sync_job", { p_client_id: client.id, p_provider: "clarity", p_job_type: "manual" });
  if (error) return { ok: false, error: "Could not queue a sync." };
  after(() => processQueue().catch(() => {}));
  revalidatePath("/clarity"); revalidatePath("/integrations");
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
  revalidatePath("/clarity"); revalidatePath("/integrations");
  return { ok: true, message: "Observation saved. It will be used as evidence in the next AI analysis." };
}

/**
 * All recordings (last 3 days, up to 50) that visited one page, for the page panel. Any member may load
 * them: it's read-only, cached per page per day, and capped per client per day (see lib/clarity/errors).
 */
export async function loadPageRecordings(url: string): Promise<
  { ok: true; recordings: Recording[]; fetchedAt: string } | { ok: false; error: string }> {
  const u = z.url({ protocol: /^https?$/ }).max(2000).safeParse(url);
  if (!u.success) return { ok: false, error: "Unknown page." };
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  const admin = createAdminClient();
  // only pages this client's Clarity data already contains
  const path = pagePath(u.data);
  const { data: known } = await admin.from("clarity_behavior_metrics").select("value").eq("client_id", client.id).eq("dimension", "url").eq("value", u.data).limit(1);
  if (!known?.length || pagePath(known[0].value) !== path) return { ok: false, error: "That page isn't in this site's Clarity data." };
  const { data: conn } = await admin.from("integration_connections").select("id, status").eq("client_id", client.id).eq("provider", "clarity").maybeSingle();
  if (conn?.status !== "connected") return { ok: false, error: "Clarity isn't connected." };
  const { data: secret } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", conn.id).maybeSingle();
  if (!secret?.refresh_token_encrypted) return { ok: false, error: "No Clarity token stored." };
  const { decryptSecret } = await import("@/lib/crypto");
  const { pageRecordings } = await import("@/lib/clarity/errors");
  const r = await pageRecordings(admin, client.id, decryptSecret(secret.refresh_token_encrypted), u.data);
  return "error" in r ? { ok: false, error: r.error } : { ok: true, ...r };
}
