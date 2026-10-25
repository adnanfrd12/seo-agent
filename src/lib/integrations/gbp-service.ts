import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { listAccounts, listLocations, type GbpLocation } from "@/lib/google/gbp";
import { GoogleAuthError, refreshAccessToken, revokeToken, type TokenSet } from "@/lib/google/oauth";

/** Short-lived access tokens are cached per connection for the life of the server instance. */
const cache = new Map<string, { token: string; expires: number }>();

/** A fresh access token from the stored (encrypted) refresh token. Throws GoogleAuthError when revoked. */
export async function gbpAccessToken(admin: SupabaseClient, connectionId: string): Promise<string> {
  const hit = cache.get(connectionId);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const { data } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", connectionId).maybeSingle();
  if (!data?.refresh_token_encrypted) throw new GoogleAuthError("No Google refresh token stored. Reconnect Business Profile.");
  const t = await refreshAccessToken(decryptSecret(data.refresh_token_encrypted));
  cache.set(connectionId, { token: t.access_token, expires: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

/** Saves a new grant. Google only returns a refresh token on consent, so keep the old one otherwise. */
export async function storeGrant(admin: SupabaseClient, connectionId: string, tokens: TokenSet) {
  cache.set(connectionId, { token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 });
  if (!tokens.refresh_token) return;
  const { error } = await admin.from("integration_secrets").upsert(
    { connection_id: connectionId, refresh_token_encrypted: encryptSecret(tokens.refresh_token), updated_at: new Date().toISOString() },
    { onConflict: "connection_id" });
  if (error) throw new Error("Could not store the Google grant");
}

function address(l: GbpLocation): string | null {
  const a = l.storefrontAddress;
  if (!a) return null;
  return [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode].filter(Boolean).join(", ") || null;
}

/** Lists every account and location the grant can see and records them as selectable resources. */
export async function discoverLocations(admin: SupabaseClient, clientId: string, connectionId: string, token: string) {
  const accounts = await listAccounts(token);
  const rows = [];
  for (const acc of accounts) {
    for (const l of await listLocations(token, acc.name)) {
      rows.push({
        client_id: clientId,
        connection_id: connectionId,
        provider: "gbp",
        external_id: l.name, // locations/{id}
        display_name: l.title ?? l.name,
        metadata: {
          account: acc.name, account_name: acc.accountName ?? null, store_code: l.storeCode ?? null,
          address: address(l), website: l.websiteUri ?? null, phone: l.phoneNumbers?.primaryPhone ?? null,
          category: l.categories?.primaryCategory?.displayName ?? null, maps_uri: l.metadata?.mapsUri ?? null,
          place_id: l.metadata?.placeId ?? null, open_status: l.openInfo?.status ?? null,
        },
      });
    }
  }
  if (rows.length) {
    // is_selected omitted so re-discovery keeps the user's choice
    const { error } = await admin.from("integration_resources").upsert(rows, { onConflict: "client_id,provider,external_id" });
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
