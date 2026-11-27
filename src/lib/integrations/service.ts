import "server-only";
import { appUrl } from "@/lib/app-url";
import type { Composio } from "@composio/core";
import { composioConfigProblem, composioFor, entityId } from "@/lib/composio/client";
import { ga4Adapter } from "@/lib/composio/ga4";
import { gscAdapter } from "@/lib/composio/gsc";
import { serverEnv } from "@/lib/env";
import { configForClient, missingMessage } from "@/lib/org/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DiscoveredResource } from "@/lib/analytics/types";
import { HttpError } from "./http";
import { PROVIDER_META, type ProviderId } from "./providers";

/**
 * Google Analytics and Search Console connect through the Composio project of the client's ORGANIZATION
 * (Settings → Integrations → Composio). Business Profile uses the organization's Google OAuth client
 * (src/lib/integrations/gbp-service.ts). Nothing here falls back to another organization's settings.
 */
const AUTH_CONFIG_KEY = { ga4: "COMPOSIO_AUTH_CONFIG_GA4", gsc: "COMPOSIO_AUTH_CONFIG_GSC" } as const;

function authConfigKey(provider: ProviderId): (typeof AUTH_CONFIG_KEY)[keyof typeof AUTH_CONFIG_KEY] {
  if (provider === "ga4" || provider === "gsc") return AUTH_CONFIG_KEY[provider];
  throw new HttpError(501, `${PROVIDER_META[provider].label} is not available through Composio`);
}

/** Composio toolkit slugs (as reported by connected accounts). */
const TOOLKIT_SLUG = { ga4: "google_analytics", gsc: "google_search_console" } as const;

export interface Readiness { ready: boolean; message: string | null }

/**
 * For the Integrations UI: whether Connect can start for each Google provider of this client, from its
 * organization's settings, and otherwise the message to show (what an owner must add, and where). It only checks
 * that the values exist; Settings → Integrations → Test connection checks that they work.
 */
export async function connectReadiness(clientId: string): Promise<Record<ProviderId, Readiness>> {
  const cfg = await configForClient(clientId);
  const need = (keys: string[]): Readiness => {
    const missing = keys.find((k) => !cfg.get(k));
    return missing ? { ready: false, message: missingMessage(missing) } : { ready: true, message: null };
  };
  const gbp = need(["GOOGLE_GBP_CLIENT_ID", "GOOGLE_GBP_CLIENT_SECRET"]);
  return {
    ga4: need(["COMPOSIO_API_KEY", AUTH_CONFIG_KEY.ga4]),
    gsc: need(["COMPOSIO_API_KEY", AUTH_CONFIG_KEY.gsc]),
    gbp: gbp.ready && !process.env.TOKEN_ENCRYPTION_KEY?.trim()
      ? { ready: false, message: "TOKEN_ENCRYPTION_KEY isn't set on the server, so Google tokens can't be stored." }
      : gbp,
  };
}

/** All of this client's Composio accounts for a toolkit, newest first. */
async function listAccounts(c: Composio, clientId: string, provider: "ga4" | "gsc") {
  const res = await c.connectedAccounts.list({
    userIds: [entityId(clientId)],
    toolkitSlugs: [TOOLKIT_SLUG[provider]],
    limit: 50,
  });
  return [...res.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Organization settings that stop a connection, as the HTTP error the Connect button shows (503, with what to fix). */
function settingsError(e: unknown, key?: string): HttpError | null {
  const problem = composioConfigProblem(e, key);
  return problem ? new HttpError(503, problem.message) : null;
}

/** Step 1-2: backend starts the Composio OAuth flow (the client organization's project) and records a pending connection. */
export async function startConnect(clientId: string, provider: ProviderId): Promise<string> {
  const env = serverEnv();
  const key = authConfigKey(provider);
  const cfg = await configForClient(clientId);
  const request = await (async () => composioFor(cfg).connectedAccounts.link(entityId(clientId), cfg.require(key), {
    callbackUrl: `${appUrl() || env.NEXT_PUBLIC_APP_URL}/api/integrations/${provider}/callback`,
  }))().catch((e: unknown) => { throw settingsError(e, key) ?? e; });
  if (!request.redirectUrl) throw new Error("Composio did not return a redirect URL");

  const admin = createAdminClient();
  const { error } = await admin.from("integration_connections").upsert(
    {
      client_id: clientId,
      provider,
      auth_method: "composio",
      composio_connected_account_id: request.id,
      composio_entity_id: entityId(clientId),
      status: "pending",
      last_error: null,
    },
    { onConflict: "client_id,provider" },
  );
  if (error) throw new Error("Could not record pending connection");
  return request.redirectUrl;
}

/**
 * `soft` means "not an error": authorization simply hasn't finished (yet). The UI shows a neutral
 * notice and the card stays on Connect instead of flipping to Error / Reconnect.
 */
export type CompleteResult = { ok: true } | { ok: false; reason: string; soft?: boolean };

/**
 * Steps 3-5 (after the user returns from Google): find the account that is actually ACTIVE, then
 * discover selectable properties/sites.
 *
 * We do NOT trust the connected-account id stored by startConnect: every click on Connect creates a
 * new link, so a double click (or a retry) leaves the stored id pointing at an unused link while the
 * account the user really authorized is a different one. Instead we list this client's accounts for
 * the toolkit and use the newest ACTIVE one.
 */
export async function completeConnect(clientId: string, provider: ProviderId): Promise<CompleteResult> {
  if (provider === "gbp") return { ok: false, reason: "Business Profile is not available through Composio" };
  const admin = createAdminClient();
  const entity = entityId(clientId);

  const { data: conn } = await admin
    .from("integration_connections")
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn) return { ok: false, reason: "No connection in progress. Click Connect Account to start." };

  // the client organization's Composio project (the one startConnect opened the login in)
  let c: Composio;
  let accounts: Awaited<ReturnType<typeof listAccounts>>;
  try {
    c = composioFor(await configForClient(clientId));
    accounts = await listAccounts(c, clientId, provider);
  } catch (e) {
    const problem = composioConfigProblem(e);
    if (!problem) throw e;
    await admin.from("integration_connections").update({ last_error: problem.message }).eq("id", conn.id);
    return { ok: false, reason: problem.message };
  }
  let active = accounts.find((a) => a.status === "ACTIVE");

  if (!active) {
    // The redirect can beat Composio's own status update; give an in-flight authorization a moment.
    const inflight = accounts.find((a) => a.status === "INITIALIZING" || a.status === "INITIATED");
    if (inflight) {
      try {
        await c.connectedAccounts.waitForConnection(inflight.id, 20_000);
      } catch {
        // still not active; handled below
      }
      accounts = await listAccounts(c, clientId, provider);
      active = accounts.find((a) => a.status === "ACTIVE");
    }
  }

  if (!active) {
    const stillGoing = accounts.some((a) => a.status === "INITIALIZING" || a.status === "INITIATED");
    if (stillGoing) {
      await admin.from("integration_connections").update({ status: "pending", last_error: null }).eq("id", conn.id);
      return {
        ok: false,
        soft: true,
        reason: "Google authorization is still in progress. Finish the Google consent screen, then click Connect Account again.",
      };
    }
    const reason = "Google authorization wasn't completed or has expired. Click Reconnect and finish the Google consent screen.";
    await admin.from("integration_connections").update({ status: "error", last_error: reason }).eq("id", conn.id);
    return { ok: false, reason };
  }

  let found: DiscoveredResource[];
  try {
    const adapter = provider === "ga4" ? ga4Adapter : gscAdapter;
    found = await adapter.listResources({ userId: entity, connectedAccountId: active.id });
  } catch (e) {
    const reason = "Connected, but listing resources failed";
    await admin
      .from("integration_connections")
      .update({
        composio_connected_account_id: active.id,
        status: "error",
        last_error: `${reason}: ${(e instanceof Error ? e.message : "").slice(0, 300)}`,
      })
      .eq("id", conn.id);
    return { ok: false, reason };
  }

  if (found.length > 0) {
    // is_selected is deliberately omitted so re-discovery never clears the user's choice
    const { error } = await admin.from("integration_resources").upsert(
      found.map((r) => ({
        client_id: clientId,
        connection_id: conn.id,
        provider,
        external_id: r.externalId,
        display_name: r.displayName,
        timezone: r.timezone ?? null,
        metadata: r.metadata ?? {},
      })),
      { onConflict: "client_id,provider,external_id" },
    );
    if (error) throw new Error("Could not save discovered resources");
  }

  await admin
    .from("integration_connections")
    .update({
      composio_connected_account_id: active.id,
      composio_entity_id: entity,
      status: "connected",
      last_error: null,
    })
    .eq("id", conn.id);

  // remember the Composio account with the client so deletion requests can be matched to it
  {
    const { recordPlatformAccount } = await import("@/lib/compliance/deletion");
    await recordPlatformAccount(admin, clientId, PROVIDER_PLATFORM[provider] ?? provider, { connected_account: active.id }, active.id).catch(() => undefined);
  }

  // Revoke superseded/expired duplicates so no unused live OAuth grants are left behind.
  await Promise.allSettled(
    accounts.filter((a) => a.id !== active.id).map((a) => c.connectedAccounts.delete(a.id)),
  );
  return { ok: true };
}

/** Step 6-8: save the chosen resources (RLS enforces admin) and queue the initial import. */
export async function selectResources(clientId: string, provider: ProviderId, resourceIds: string[]) {
  const supabase = await createClient();
  // Only this provider's own connection: Business Profile locations added through Local Brand Manager are also
  // stored as "gbp" resources (on the LBM connection), and saving the Google selection must not untrack them.
  // (integration_connections isn't readable by signed-in users because it holds account references, so the
  // service role looks it up; callers have already checked the user is an owner/admin of this client)
  const { data: conn } = await createAdminClient().from("integration_connections").select("id").eq("client_id", clientId).eq("provider", provider).maybeSingle();
  if (!conn) {
    if (resourceIds.length) throw new HttpError(400, "One or more resources were not found");
    return { selected: 0, queued: 0 };
  }
  const scoped = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) => q.eq("connection_id", conn.id);

  const { error: clearErr } = await scoped(supabase
    .from("integration_resources")
    .update({ is_selected: false })
    .eq("client_id", clientId)
    .eq("provider", provider));
  if (clearErr) throw new HttpError(403, "Not allowed to change selection");

  if (resourceIds.length > 0) {
    const { data, error } = await scoped(supabase
      .from("integration_resources")
      .update({ is_selected: true })
      .eq("client_id", clientId)
      .eq("provider", provider))
      .in("id", resourceIds)
      .select("id");
    if (error || (data?.length ?? 0) !== resourceIds.length) {
      throw new HttpError(400, "One or more resources were not found");
    }
  }

  let queued = 0;
  if (resourceIds.length > 0) {
    const { data, error } = await supabase.rpc("enqueue_sync_job", {
      p_client_id: clientId,
      p_provider: provider,
      p_job_type: "initial",
    });
    if (error) throw new Error("Could not queue initial import");
    queued = data ?? 0;
  }
  return { selected: resourceIds.length, queued };
}

export async function enqueueSync(clientId: string, provider: ProviderId) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enqueue_sync_job", {
    p_client_id: clientId,
    p_provider: provider,
    p_job_type: "manual",
  });
  if (error) throw new HttpError(error.code === "42501" ? 403 : 500, "Could not queue sync");
  return data ?? 0;
}

/**
 * Disconnect = delete: removes the Composio account (and its tokens) or revokes the direct Google grant, deletes the
 * stored tokens and every row of data received from this connection, and records an audit entry
 * (src/lib/compliance/deletion.ts). The Privacy Policy and Data Deletion page promise this.
 */
export async function disconnect(clientId: string, provider: ProviderId) {
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("integration_connections")
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn) return;
  const { handleDeletionRequest } = await import("@/lib/compliance/deletion");
  await handleDeletionRequest(admin, { platform: PROVIDER_PLATFORM[provider] ?? provider, platformUserId: null, source: "dashboard", workspaceId: clientId, refs: [conn.id] });
}

const PROVIDER_PLATFORM: Partial<Record<ProviderId, string>> = { ga4: "google_analytics", gsc: "google_search_console", gbp: "google_business_profile" };
