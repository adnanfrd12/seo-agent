"use server";

import { after } from "next/server";
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { BingError, cleanKey, userSites } from "@/lib/bing/api";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { processQueue } from "@/lib/sync/worker";

type Result = { ok: true; message: string } | { ok: false; error: string };
export type BingSiteOption = { url: string; verified: boolean };

async function adminClient() {
  const { client } = await getSession();
  if (!client) throw new Error("No client");
  return { client, allowed: ["owner", "admin"].includes(client.role) };
}

async function connection(clientId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("integration_connections").select("id, status").eq("client_id", clientId).eq("provider", "bing").maybeSingle();
  return { admin, conn: data };
}

const refresh = () => { revalidatePath("/integrations"); revalidatePath("/bing"); revalidatePath("/overview"); };

/** Validates the key with a real API call, then stores it encrypted. Empty input uses BING_WEBMASTER_API_KEY. */
export async function connectBing(input: string): Promise<Result> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can connect integrations." };
  const parsed = z.string().min(16).max(200).safeParse(cleanKey(input.trim() || process.env.BING_WEBMASTER_API_KEY || ""));
  if (!parsed.success) return { ok: false, error: "Paste the API key from Bing Webmaster Tools → Settings → API access (or set BING_WEBMASTER_API_KEY)." };
  try {
    await userSites(parsed.data);
  } catch (e) {
    return { ok: false, error: e instanceof BingError ? e.message : "Couldn't reach Bing Webmaster Tools. Try again." };
  }
  let encrypted: string;
  try { encrypted = encryptSecret(parsed.data); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Encryption failed." }; }
  const admin = createAdminClient();
  const { data: conn, error } = await admin.from("integration_connections").upsert(
    { client_id: client.id, provider: "bing", auth_method: "api_token", status: "connected", last_error: null },
    { onConflict: "client_id,provider" },
  ).select("id").single();
  if (error || !conn) return { ok: false, error: "Could not save the connection (has migration 20261027000015 been applied?)." };
  await admin.from("integration_secrets").upsert({ connection_id: conn.id, refresh_token_encrypted: encrypted, updated_at: new Date().toISOString() });
  refresh();
  return { ok: true, message: "Bing connected. Choose this client's site below." };
}

/** Every site in the Bing account the key belongs to. */
export async function bingSites(): Promise<{ ok: true; sites: BingSiteOption[] } | { ok: false; error: string }> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can manage integrations." };
  const { admin, conn } = await connection(client.id);
  const { data: secret } = conn
    ? await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", conn.id).maybeSingle()
    : { data: null };
  if (!secret?.refresh_token_encrypted) return { ok: false, error: "Connect Bing first." };
  try {
    const sites = await userSites(decryptSecret(secret.refresh_token_encrypted));
    return { ok: true, sites: (sites ?? []).map((s) => ({ url: s.Url, verified: s.IsVerified })).sort((a, b) => a.url.localeCompare(b.url)) };
  } catch (e) {
    return { ok: false, error: e instanceof BingError ? e.message : "Couldn't load sites." };
  }
}

/** Saves the chosen site(s) for this client and imports all available history. */
export async function selectBingSites(urls: string[]): Promise<Result> {
  const parsed = z.array(z.url().max(500)).max(20).safeParse(urls);
  if (!parsed.success) return { ok: false, error: "Invalid selection." };
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can manage integrations." };
  const { admin, conn } = await connection(client.id);
  if (!conn) return { ok: false, error: "Connect Bing first." };
  await admin.from("integration_resources").update({ is_selected: false }).eq("connection_id", conn.id);
  if (parsed.data.length) {
    const { error } = await admin.from("integration_resources").upsert(parsed.data.map((url) => ({
      client_id: client.id, connection_id: conn.id, provider: "bing", external_id: url,
      display_name: url.replace(/^https?:\/\//, "").replace(/\/$/, ""), is_selected: true,
    })), { onConflict: "client_id,provider,external_id" });
    if (error) return { ok: false, error: "Could not save the selection." };
    await (await createClient()).rpc("enqueue_sync_job", { p_client_id: client.id, p_provider: "bing", p_job_type: "initial" });
    after(() => processQueue().catch(() => {}));
  }
  refresh();
  return { ok: true, message: parsed.data.length ? "Saved. Importing Bing history now (about a minute)." : "Selection cleared." };
}

export async function syncBingNow(): Promise<Result> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can sync." };
  const { data, error } = await (await createClient()).rpc("enqueue_sync_job", { p_client_id: client.id, p_provider: "bing", p_job_type: "manual" });
  if (error) return { ok: false, error: "Could not queue a sync." };
  after(() => processQueue().catch(() => {}));
  refresh();
  return { ok: true, message: data ? "Sync started. Refresh in a minute." : "A sync is already queued or running." };
}

export async function disconnectBing(): Promise<Result> {
  const { client, allowed } = await adminClient();
  if (!allowed) return { ok: false, error: "Only owners and admins can disconnect integrations." };
  const { admin, conn } = await connection(client.id);
  if (conn) {
    await admin.from("integration_secrets").delete().eq("connection_id", conn.id);
    await admin.from("integration_connections").update({ status: "disconnected" }).eq("id", conn.id);
    await admin.from("integration_resources").update({ is_selected: false }).eq("connection_id", conn.id);
  }
  refresh();
  return { ok: true, message: "Bing disconnected. Stored history is kept." };
}
