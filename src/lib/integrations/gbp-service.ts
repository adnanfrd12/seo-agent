import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { listAccounts, listLocations, splitLocationName, type GbpAuth, type GbpLocation } from "@/lib/google/gbp";
import { gbpAppForClient, GoogleAuthError, refreshAccessToken, revokeToken, type OAuthApp, type TokenSet } from "@/lib/google/oauth";

/**
 * Business Profile grants belong to a client and are refreshed with the Google OAuth client of that client's
 * organization (Settings → Integrations → Google Cloud OAuth), never another organization's. Each connection
 * records which OAuth client made its grant (integration_connections.oauth_client_id, migration
 * 20261129000038; filled in on the first refresh for grants made before it), so a refresh token is never sent to
 * a different client: an organization that replaces its OAuth client is asked to reconnect instead.
 */

/** Short-lived access tokens are cached per connection for the life of the server instance. */
const cache = new Map<string, { token: string; expires: number; client: string; oauthClientId: string }>();

/** The connection's client and the OAuth client ID recorded with its grant (null: not recorded, or the column doesn't exist yet). */
async function grantOf(admin: SupabaseClient, connectionId: string): Promise<{ client: string; oauthClientId: string | null; tracked: boolean } | null> {
  const full = await admin.from("integration_connections").select("client_id, oauth_client_id").eq("id", connectionId).maybeSingle();
  if (!full.error) return full.data ? { client: full.data.client_id as string, oauthClientId: (full.data.oauth_client_id as string | null) ?? null, tracked: true } : null;
  if (!/oauth_client_id/.test(full.error.message)) throw new Error("Couldn't read the Business Profile connection.");
  const plain = await admin.from("integration_connections").select("client_id").eq("id", connectionId).maybeSingle();
  return plain.data ? { client: plain.data.client_id as string, oauthClientId: null, tracked: false } : null;
}

/**
 * A fresh access token from the stored (encrypted) refresh token, refreshed with the OAuth client of the
 * connection's organization, plus that organization's API key for request quotas. Throws ConfigError when the
 * organization's OAuth client isn't set up (or Google refuses it), GoogleAuthError when the grant is revoked or was
 * made with a different OAuth client.
 */
export async function gbpAuth(admin: SupabaseClient, connectionId: string): Promise<{ token: string; apiKey: string | null }> {
  const hit = cache.get(connectionId);
  if (hit && hit.expires > Date.now() + 60_000) {
    const app = await gbpAppForClient(hit.client); // the organization's settings still decide (and may have changed)
    if (app.clientId === hit.oauthClientId) return { token: hit.token, apiKey: app.apiKey };
  }
  const grant = await grantOf(admin, connectionId);
  if (!grant) throw new GoogleAuthError("This Business Profile connection no longer exists. Connect Business Profile again.");
  const app = await gbpAppForClient(grant.client);
  if (grant.oauthClientId && grant.oauthClientId !== app.clientId) {
    throw new GoogleAuthError("Business Profile was connected with a different Google OAuth client than the one this organization uses now. Reconnect Business Profile.");
  }
  const { data } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", connectionId).maybeSingle();
  if (!data?.refresh_token_encrypted) throw new GoogleAuthError("No Google refresh token stored. Reconnect Business Profile.");
  const t = await refreshAccessToken(app, decryptSecret(data.refresh_token_encrypted));
  cache.set(connectionId, { token: t.access_token, expires: Date.now() + t.expires_in * 1000, client: grant.client, oauthClientId: app.clientId });
  // a grant made before the OAuth client was recorded: this client just refreshed it, so it is the grant's client
  if (grant.tracked && !grant.oauthClientId) {
    await admin.from("integration_connections").update({ oauth_client_id: app.clientId }).eq("id", connectionId).is("oauth_client_id", null).then(() => undefined, () => undefined);
  }
  return { token: t.access_token, apiKey: app.apiKey };
}

/** Saves a new grant. Google only returns a refresh token on consent, so keep the old one otherwise. */
export async function storeGrant(admin: SupabaseClient, conn: { id: string; clientId: string }, tokens: TokenSet, app: OAuthApp) {
  const connectionId = conn.id;
  cache.set(connectionId, { token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000, client: conn.clientId, oauthClientId: app.clientId });
  if (!tokens.refresh_token) return;
  const { error } = await admin.from("integration_secrets").upsert(
    { connection_id: connectionId, refresh_token_encrypted: encryptSecret(tokens.refresh_token), updated_at: new Date().toISOString() },
    { onConflict: "connection_id" });
  if (error) throw new Error("Could not store the Google grant");
}

export function formatAddress(l: GbpLocation): string | null {
  const a = l.storefrontAddress;
  if (!a) return null;
  return [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode].filter(Boolean).join(", ") || null;
}

/**
 * Lists every account and location the grant can see and records them as selectable resources of this
 * connection. Google resources are stored as accounts/{a}/locations/{l} (reviews and posts need the account),
 * so they never collide with Local Brand Manager's locations/{l} rows: LBM tracking is left untouched.
 */
export async function discoverLocations(admin: SupabaseClient, clientId: string, connectionId: string, auth: GbpAuth) {
  const accounts = await listAccounts(auth);
  const seen = new Set<string>();
  const rows = [];
  for (const acc of accounts) {
    for (const l of await listLocations(auth, acc.name)) {
      const { locationId } = splitLocationName(l.name);
      if (seen.has(locationId)) continue; // the same location can be visible through several accounts
      seen.add(locationId);
      rows.push({
        client_id: clientId,
        connection_id: connectionId,
        provider: "gbp",
        external_id: `${acc.name}/locations/${locationId}`,
        display_name: l.title ?? l.name,
        metadata: {
          source: "google", account: acc.name, account_name: acc.accountName ?? null, store_code: l.storeCode ?? null,
          address: formatAddress(l), website: l.websiteUri ?? null, phone: l.phoneNumbers?.primaryPhone ?? null,
          category: l.categories?.primaryCategory?.displayName ?? null, maps_uri: l.metadata?.mapsUri ?? null,
          place_id: l.metadata?.placeId ?? null, open_status: l.openInfo?.status ?? null,
        },
      });
    }
  }
  if (rows.length) {
    // keep fields written by the sync (google_location etc.); is_selected omitted so re-discovery keeps the user's choice
    const { data: existing } = await admin.from("integration_resources").select("external_id, metadata")
      .eq("client_id", clientId).eq("provider", "gbp").eq("connection_id", connectionId);
    const prev = new Map((existing ?? []).map((r) => [r.external_id as string, (r.metadata ?? {}) as Record<string, unknown>]));
    const { error } = await admin.from("integration_resources").upsert(
      rows.map((r) => ({ ...r, metadata: { ...(prev.get(r.external_id) ?? {}), ...r.metadata } })),
      { onConflict: "client_id,provider,external_id" });
    if (error) throw new Error("Could not save Business Profile locations");
  }
  return { accounts: accounts.length, locations: rows.length };
}

/** Revokes the Google grant and deletes the stored refresh token. */
export async function revokeGbp(admin: SupabaseClient, connectionId: string) {
  const { data } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", connectionId).maybeSingle();
  if (data?.refresh_token_encrypted) {
    try { await revokeToken(decryptSecret(data.refresh_token_encrypted)); } catch { /* already revoked or unreadable */ }
  }
  cache.delete(connectionId);
  await admin.from("integration_secrets").delete().eq("connection_id", connectionId);
}

/**
 * The client's direct Google connection and its resource for a Business Profile location (by numeric location id),
 * or why there is none. Used to reply to reviews, including reviews imported through Local Brand Manager
 * (their remote_id is Google's review id).
 */
export async function googleTwin(admin: SupabaseClient, clientId: string, locationId: string) {
  const { data: conn } = await admin.from("integration_connections").select("id, status, last_error").eq("client_id", clientId).eq("provider", "gbp").maybeSingle();
  if (!conn) return { ok: false as const, reason: "no_connection" as const };
  const { data: res } = await admin.from("integration_resources").select("id, external_id").eq("client_id", clientId).eq("provider", "gbp").eq("connection_id", conn.id);
  const twin = (res ?? []).find((r) => splitLocationName(r.external_id).locationId === locationId && splitLocationName(r.external_id).account);
  if (!twin) return { ok: false as const, reason: conn.status === "connected" ? "location_not_found" as const : "not_connected" as const, error: conn.last_error as string | null };
  return { ok: true as const, connectionId: conn.id as string, status: conn.status as string, lastError: conn.last_error as string | null, resourceId: twin.id as string, parent: twin.external_id as string };
}
