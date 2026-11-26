import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { platformById, platformByProvider, platformBySocial } from "@/config/platforms";
import { composio } from "@/lib/composio/client";
import { revokeGbp } from "@/lib/integrations/gbp-service";
import { TOOLKIT, entityId } from "@/lib/social/composio";
import { PLATFORMS as SOCIAL, type Platform } from "@/lib/social/platforms";
import { deleteSnapshots } from "@/lib/social/snapshots";
import { confirmationCode } from "./signatures";
import { insertRequest, logDeletion, updateRequest, type DeletionRequest, type DeletionSource } from "./store";

/**
 * The one deletion service used by Disconnect, platform webhooks, revocation detection, email requests and
 * workspace deletion.
 *
 * A connection is referenced as either
 *   - an `integration_connections` id (Google Analytics, Search Console, Business Profile, Bing, Clarity, LBM), or
 *   - `social:<clientId>:<platform>` for a social account connected through Composio.
 *
 * It deletes the Composio connected account(s) (Composio then drops the stored tokens), revokes Google grants we
 * hold directly, deletes our stored tokens/keys and every row of data received from that connection, then writes
 * an audit entry with IDs only. Running it again on a deleted connection is a no-op (idempotent).
 */
export type DeleteReason = DeletionSource;
export interface DeleteResult { ref: string; deleted: boolean; platform: string; clientId: string | null }

const INTEGRATION_TOOLKIT: Record<string, string> = { ga4: "google_analytics", gsc: "google_search_console" };
/** dfs_cache endpoints whose keys start with "<resourceId>:" (per-resource caches built from a connection) */
const RESOURCE_CACHES: Record<string, string[]> = { ga4: ["ga4x"], gsc: ["gscx"] };

export const socialRef = (clientId: string, p: Platform) => `social:${clientId}:${p}`;

async function deleteComposioAccounts(clientId: string, toolkit: string) {
  const res = await composio().connectedAccounts.list({ userIds: [entityId(clientId)], toolkitSlugs: [toolkit], limit: 50 });
  await Promise.all(res.items.map((a) => composio().connectedAccounts.delete(a.id).catch((e: unknown) => {
    // already gone at Composio is fine; anything else must surface so the caller can retry
    if (!/not.?found|404/i.test(String(e))) throw e;
  })));
  return res.items.length;
}

/** Removes stored platform account IDs and per-platform tokens for one platform key from clients.settings. */
async function forgetPlatform(admin: SupabaseClient, clientId: string, registryId: string, socialKey?: Platform) {
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  if (!data) return;
  const settings = { ...((data.settings ?? {}) as Record<string, unknown>) };
  const accounts = { ...((settings.platform_accounts ?? {}) as Record<string, unknown>) };
  const tokens = { ...((settings.social_tokens ?? {}) as Record<string, unknown>) };
  const had = registryId in accounts || (socialKey ? socialKey in tokens : false);
  if (!had) return;
  delete accounts[registryId];
  if (socialKey) delete tokens[socialKey];
  await admin.from("clients").update({ settings: { ...settings, platform_accounts: accounts, social_tokens: tokens } }).eq("id", clientId);
}

export async function deleteConnection(admin: SupabaseClient, ref: string, reason: DeleteReason, extra: { platformUserId?: string | null } = {}): Promise<DeleteResult> {
  const at = new Date().toISOString();

  if (ref.startsWith("social:")) {
    const [, clientId, raw] = ref.split(":");
    if (!clientId || !(SOCIAL as readonly string[]).includes(raw)) throw new Error("Unknown social connection");
    const p = raw as Platform;
    const reg = platformBySocial(p);
    const registryId = reg?.id ?? p;
    const removed = await deleteComposioAccounts(clientId, TOOLKIT[p]);
    const { data: rows } = await admin.from("dfs_cache").delete().eq("client_id", clientId).eq("endpoint", "social").eq("params_hash", p).select("id");
    // the daily snapshots read from the account are its data too
    const snaps = await deleteSnapshots(admin, clientId, p).catch(() => 0);
    await forgetPlatform(admin, clientId, registryId, p);
    const deleted = removed > 0 || (rows?.length ?? 0) > 0 || snaps > 0;
    if (deleted) await logDeletion(admin, { at, action: "connection_deleted", platform: registryId, reason, connection_ref: ref, workspace_id: clientId, platform_user_id: extra.platformUserId ?? null, detail: { composio_accounts: removed, data_rows: rows?.length ?? 0, snapshot_rows: snaps } });
    return { ref, deleted, platform: registryId, clientId };
  }

  const { data: conn } = await admin.from("integration_connections").select("id, client_id, provider").eq("id", ref).maybeSingle();
  if (!conn) return { ref, deleted: false, platform: "unknown", clientId: null };
  const provider = String(conn.provider);
  const registryId = platformByProvider(provider)?.id ?? provider;
  let composioAccounts = 0;
  if (INTEGRATION_TOOLKIT[provider]) composioAccounts = await deleteComposioAccounts(conn.client_id, INTEGRATION_TOOLKIT[provider]);
  if (provider === "gbp") await revokeGbp(admin, conn.id); // Google token revoke + stored refresh token
  const { data: resources } = await admin.from("integration_resources").select("id").eq("connection_id", conn.id);
  const caches = RESOURCE_CACHES[provider] ?? [];
  for (const r of resources ?? []) {
    for (const endpoint of caches) await admin.from("dfs_cache").delete().eq("client_id", conn.client_id).eq("endpoint", endpoint).like("params_hash", `${r.id}:%`);
  }
  // cascades: integration_secrets (tokens/keys), integration_resources and every metrics table, sync jobs
  const { error } = await admin.from("integration_connections").delete().eq("id", conn.id);
  if (error) throw new Error(`Couldn't delete the connection: ${error.message}`);
  await forgetPlatform(admin, conn.client_id, registryId);
  await logDeletion(admin, { at, action: "connection_deleted", platform: registryId, reason, connection_ref: conn.id, workspace_id: conn.client_id, platform_user_id: extra.platformUserId ?? null, detail: { provider, composio_accounts: composioAccounts, resources: resources?.length ?? 0 } });
  return { ref, deleted: true, platform: registryId, clientId: conn.client_id };
}

/* ---------------------------------------------------------------- platform account IDs */

export interface PlatformAccount { user_id: string | null; ids: Record<string, string>; composio_account_id: string | null; recorded_at: string }

/** Stores the platform's account IDs with the client so notifications and requests can be matched later. */
export async function recordPlatformAccount(admin: SupabaseClient, clientId: string, registryId: string, ids: Record<string, string>, composioAccountId: string | null) {
  const clean = Object.fromEntries(Object.entries(ids).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!Object.keys(clean).length) return;
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  if (!data) return;
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const accounts = { ...((settings.platform_accounts ?? {}) as Record<string, PlatformAccount>) };
  const prev = accounts[registryId];
  const next: PlatformAccount = { user_id: clean.user_id ?? prev?.user_id ?? null, ids: { ...(prev?.ids ?? {}), ...clean }, composio_account_id: composioAccountId ?? prev?.composio_account_id ?? null, recorded_at: prev?.recorded_at ?? new Date().toISOString() };
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  accounts[registryId] = next;
  await admin.from("clients").update({ settings: { ...settings, platform_accounts: accounts } }).eq("id", clientId);
}

/** Connections (as deleteConnection refs) whose stored platform account IDs include `platformUserId`. */
export async function findByPlatformUser(admin: SupabaseClient, registryId: string, platformUserId: string): Promise<string[]> {
  const { data } = await admin.from("clients").select("id, settings").not(`settings->platform_accounts->${registryId}`, "is", null);
  const refs: string[] = [];
  for (const c of data ?? []) {
    const acc = ((c.settings ?? {}) as { platform_accounts?: Record<string, PlatformAccount> }).platform_accounts?.[registryId];
    if (!acc || !(acc.user_id === platformUserId || Object.values(acc.ids ?? {}).includes(platformUserId))) continue;
    const reg = platformById(registryId);
    if (reg?.socialKey) refs.push(socialRef(c.id, reg.socialKey as Platform));
    else if (reg?.providerKey) {
      const { data: conn } = await admin.from("integration_connections").select("id").eq("client_id", c.id).eq("provider", reg.providerKey).maybeSingle();
      if (conn) refs.push(conn.id);
    }
  }
  return refs;
}

/**
 * Handles one platform notification or request end to end: records a deletion request (with a confirmation code),
 * deletes every matching connection and marks the request completed (or not_found when nothing matched).
 */
export async function handleDeletionRequest(admin: SupabaseClient, input: { platform: string; platformUserId: string | null; source: DeleteReason; workspaceId?: string | null; refs?: string[] }) {
  const code = confirmationCode();
  const created_at = new Date().toISOString();
  const record: DeletionRequest = { platform: input.platform, platform_user_id: input.platformUserId, workspace_id: input.workspaceId ?? null, source: input.source, confirmation_code: code, status: "received", created_at, completed_at: null };
  await insertRequest(admin, record);
  const refs = input.refs ?? (input.platformUserId ? await findByPlatformUser(admin, input.platform, input.platformUserId) : []);
  const results: DeleteResult[] = [];
  for (const ref of refs) results.push(await deleteConnection(admin, ref, input.source, { platformUserId: input.platformUserId }));
  await updateRequest(admin, code, { status: refs.length ? "completed" : "not_found", completed_at: new Date().toISOString(), workspace_id: input.workspaceId ?? results.find((r) => r.clientId)?.clientId ?? null }, record);
  return { code, results };
}

/* ---------------------------------------------------------------- revocation detection */

/** Auth errors that mean access was revoked (not a transient failure), seen after the provider's own token refresh. */
const REVOKED_RE = /invalid_grant|OAuthException[^]{0,80}\b190\b|"code"\s*:\s*190\b|error(_|\s)?code[^0-9]{0,5}190\b|access_token_invalid|token (has been |was )?revoked|deauthori[sz]ed|user has not authorized|app.*(removed|uninstalled)/i;
export const isRevocation = (message: string) => REVOKED_RE.test(message);

/** Called by sync jobs when a platform rejects our access as revoked: deletes it and tells the workspace admins. */
export async function onRevocationDetected(admin: SupabaseClient, ref: string, clientId: string, platformLabel: string) {
  const r = await handleDeletionRequest(admin, { platform: ref.startsWith("social:") ? platformBySocial(ref.split(":")[2])?.id ?? ref.split(":")[2] : "integration", platformUserId: null, source: "revocation_detected", workspaceId: clientId, refs: [ref] });
  await admin.from("client_alerts").insert({
    client_id: clientId, severity: "warning", kind: "connection_revoked", dedupe_key: `revoked:${ref}:${new Date().toISOString().slice(0, 10)}`,
    title: `${platformLabel} access was removed`,
    body: `${platformLabel} reported that SEO Insights' access was revoked, so the connection and the data received from it were deleted. Connect it again on the Integrations or Social page to resume reporting.`,
  }).then(() => undefined, () => undefined);
  return r;
}

/* ---------------------------------------------------------------- workspace deletion */

/** Deletes a whole workspace: every connection through deleteConnection, then the client row (cascades all its data) and its members' logins that belong to no other workspace. */
export async function deleteWorkspace(admin: SupabaseClient, clientId: string, reason: DeleteReason) {
  const { data: conns } = await admin.from("integration_connections").select("id").eq("client_id", clientId);
  for (const c of conns ?? []) await deleteConnection(admin, c.id, reason);
  for (const p of SOCIAL) await deleteConnection(admin, socialRef(clientId, p), reason).catch(() => undefined);
  const { data: members } = await admin.from("client_members").select("user_id").eq("client_id", clientId);
  const { error } = await admin.from("clients").delete().eq("id", clientId);
  if (error) throw new Error(`Couldn't delete the workspace: ${error.message}`);
  let users = 0;
  for (const m of members ?? []) {
    const { count } = await admin.from("client_members").select("client_id", { count: "exact", head: true }).eq("user_id", m.user_id);
    if (!count) { const { error: e } = await admin.auth.admin.deleteUser(m.user_id); if (!e) users++; }
  }
  await logDeletion(admin, { at: new Date().toISOString(), action: "workspace_deleted", platform: "workspace", reason, connection_ref: null, workspace_id: clientId, platform_user_id: null, detail: { connections: conns?.length ?? 0, users_deleted: users } });
  return { connections: conns?.length ?? 0, users };
}
