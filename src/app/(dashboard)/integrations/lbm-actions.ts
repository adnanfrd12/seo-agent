"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { cleanToken, LbmError, listLocations } from "@/lib/lbm/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { processQueue } from "@/lib/sync/worker";

type Result = { ok: true; message: string } | { ok: false; error: string };
export type LbmLocationOption = { id: string; name: string; address: string | null; gbpId: string; enabled: boolean };

async function adminClient() {
  const { client } = await getSession();
  if (!client) throw new Error("No client");
  return { client, allowed: ["owner", "admin"].includes(client.role) };
}

async function connection(clientId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("integration_connections").select("id, status").eq("client_id", clientId).eq("provider", "lbm").maybeSingle();
  return { admin, conn: data };
}

async function storedToken(connectionId: string) {
  const { data } = await createAdminClient().from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", connectionId).maybeSingle();
  return data?.refresh_token_encrypted ? decryptSecret(data.refresh_token_encrypted) : null;
}

const refresh = () => { revalidatePath("/integrations"); revalidatePath("/business-profile"); revalidatePath("/overview"); };

/** Validates the token with a real API call, then stores it encrypted. Empty input uses LOCAL_BRAND_MANAGER_API_TOKEN. */
export async function connectLbm(input: string): Promise<Result> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can connect integrations." };
  const raw = input.trim() || process.env.LOCAL_BRAND_MANAGER_API_TOKEN || "";
  const parsed = z.string().min(10).max(500).safeParse(cleanToken(raw));
  if (!parsed.success) return { ok: false, error: "Paste the API token from app.localbrandmanager.com/api_tokens (or set LOCAL_BRAND_MANAGER_API_TOKEN)." };
  try {
    await listLocations(parsed.data);
  } catch (e) {
    return { ok: false, error: e instanceof LbmError ? e.message : "Couldn't reach Local Brand Manager. Try again." };
  }
  let encrypted: string;
  try { encrypted = encryptSecret(parsed.data); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Encryption failed." }; }
  const admin = createAdminClient();
  const { data: conn, error } = await admin.from("integration_connections").upsert(
    { client_id: client.id, provider: "lbm", auth_method: "api_token", status: "connected", last_error: null },
    { onConflict: "client_id,provider" },
  ).select("id").single();
  if (error || !conn) return { ok: false, error: "Could not save the connection (has migration 20261026000014 been applied?)." };
  await admin.from("integration_secrets").upsert({ connection_id: conn.id, refresh_token_encrypted: encrypted, updated_at: new Date().toISOString() });
  refresh();
  return { ok: true, message: "Local Brand Manager connected. Choose this client's location below." };
}

/** Every location the token can see (the agency account), for the picker. */
export async function lbmLocations(): Promise<{ ok: true; locations: LbmLocationOption[] } | { ok: false; error: string }> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can manage integrations." };
  const { conn } = await connection(client.id);
  const token = conn && (await storedToken(conn.id));
  if (!token) return { ok: false, error: "Connect Local Brand Manager first." };
  try {
    const list = await listLocations(token);
    return {
      ok: true,
      locations: list.filter((l) => l.gbp_id).map((l) => ({ id: l.id, name: l.name, address: l.address, gbpId: l.gbp_id!, enabled: l.enabled }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (e) {
    return { ok: false, error: e instanceof LbmError ? e.message : "Couldn't load locations." };
  }
}

/** Saves the chosen locations as this client's Business Profile resources and imports their data. */
export async function selectLbmLocations(picks: { id: string; gbpId: string; name: string }[]): Promise<Result> {
  const parsed = z.array(z.object({ id: z.string().min(1).max(40), gbpId: z.string().regex(/^\d+$/), name: z.string().max(300) })).max(50).safeParse(picks);
  if (!parsed.success) return { ok: false, error: "Invalid selection." };
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can manage integrations." };
  const { admin, conn } = await connection(client.id);
  if (!conn) return { ok: false, error: "Connect Local Brand Manager first." };

  await admin.from("integration_resources").update({ is_selected: false }).eq("connection_id", conn.id);
  if (parsed.data.length) {
    const { data: existing } = await admin.from("integration_resources").select("external_id, metadata")
      .eq("client_id", client.id).eq("provider", "gbp").in("external_id", parsed.data.map((p) => `locations/${p.gbpId}`));
    const meta = new Map((existing ?? []).map((r) => [r.external_id, r.metadata as Record<string, unknown>]));
    const { error } = await admin.from("integration_resources").upsert(parsed.data.map((p) => ({
      client_id: client.id, connection_id: conn.id, provider: "gbp", external_id: `locations/${p.gbpId}`, display_name: p.name,
      is_selected: true, metadata: { ...(meta.get(`locations/${p.gbpId}`) ?? {}), source: "lbm", lbm_id: p.id },
    })), { onConflict: "client_id,provider,external_id" });
    if (error) return { ok: false, error: "Could not save the selection." };
    await (await createClient()).rpc("enqueue_sync_job", { p_client_id: client.id, p_provider: "gbp", p_job_type: "initial" });
    after(() => processQueue().catch(() => {}));
  }
  refresh();
  return { ok: true, message: parsed.data.length ? "Saved. Importing performance, keywords, reviews and rankings now (about a minute)." : "Selection cleared." };
}

export async function syncLbmNow(): Promise<Result> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can sync." };
  const { data, error } = await (await createClient()).rpc("enqueue_sync_job", { p_client_id: client.id, p_provider: "gbp", p_job_type: "manual" });
  if (error) return { ok: false, error: "Could not queue a sync." };
  after(() => processQueue().catch(() => {}));
  refresh();
  return { ok: true, message: data ? "Sync started. Refresh in a minute." : "A sync is already queued or running." };
}

export async function disconnectLbm(): Promise<Result> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can disconnect integrations." };
  const { admin, conn } = await connection(client.id);
  if (conn) {
    await admin.from("integration_secrets").delete().eq("connection_id", conn.id);
    await admin.from("integration_connections").update({ status: "disconnected" }).eq("id", conn.id);
    await admin.from("integration_resources").update({ is_selected: false }).eq("connection_id", conn.id);
  }
  refresh();
  return { ok: true, message: "Local Brand Manager disconnected. Stored history is kept." };
}
