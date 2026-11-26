import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { envApp, type OAuthApp } from "./oauth";

/**
 * Google OAuth apps per agency owner ("organization"). The app has no organization table: clients are workspaces
 * and people are members of them. So an app belongs to a USER (the agency owner), and is used for every client that
 * user connects, and for clients that user owns when a teammate (admin) connects:
 *   1. the connecting user's own saved app
 *   2. else the saved app of the client's owner
 *   3. else the environment app (GOOGLE_GBP_CLIENT_ID / GOOGLE_GBP_CLIENT_SECRET)
 * The secret is AES-256-GCM encrypted (src/lib/crypto.ts) in google_oauth_apps, which only the service role reads.
 * A connection stores which owner's app made the grant, so refreshes use that same app.
 */
export const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export async function savedApp(admin: SupabaseClient, ownerUserId: string): Promise<OAuthApp | null> {
  const { data } = await admin.from("google_oauth_apps").select("google_client_id, client_secret_encrypted").eq("owner_user_id", ownerUserId).maybeSingle();
  if (!data) return null;
  return { clientId: data.google_client_id, clientSecret: decryptSecret(data.client_secret_encrypted), owner: ownerUserId };
}

/** What the UI may see: the client id (not secret) and when it was saved. Never the secret. */
export async function savedAppInfo(admin: SupabaseClient, ownerUserId: string): Promise<{ clientId: string; updatedAt: string } | null> {
  const { data, error } = await admin.from("google_oauth_apps").select("google_client_id, updated_at").eq("owner_user_id", ownerUserId).maybeSingle();
  if (error || !data) return null;
  return { clientId: data.google_client_id, updatedAt: data.updated_at };
}

export async function saveApp(admin: SupabaseClient, ownerUserId: string, clientId: string, clientSecret: string) {
  const { error } = await admin.from("google_oauth_apps").upsert(
    { owner_user_id: ownerUserId, google_client_id: clientId, client_secret_encrypted: encryptSecret(clientSecret), updated_at: new Date().toISOString() },
    { onConflict: "owner_user_id" });
  if (error) throw new Error("Could not save the Google OAuth app");
}

export async function deleteApp(admin: SupabaseClient, ownerUserId: string) {
  await admin.from("google_oauth_apps").delete().eq("owner_user_id", ownerUserId);
}

/** The owners of a client (client_members role 'owner'), oldest first. */
async function clientOwners(admin: SupabaseClient, clientId: string): Promise<string[]> {
  const { data } = await admin.from("client_members").select("user_id, created_at").eq("client_id", clientId).eq("role", "owner").order("created_at");
  return (data ?? []).map((r) => r.user_id as string);
}

/** The app a connection for this client, started by this user, should use (see the order above). */
export async function appForConnect(admin: SupabaseClient, userId: string, clientId: string): Promise<OAuthApp | null> {
  const own = await savedApp(admin, userId).catch(() => null);
  if (own) return own;
  for (const owner of await clientOwners(admin, clientId)) {
    if (owner === userId) continue;
    const app = await savedApp(admin, owner).catch(() => null);
    if (app) return app;
  }
  return envApp();
}

/** The app recorded on a connection (null owner = environment app). */
export async function appForConnection(admin: SupabaseClient, owner: string | null): Promise<OAuthApp | null> {
  return owner ? savedApp(admin, owner) : envApp();
}
