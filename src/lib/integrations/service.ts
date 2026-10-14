import "server-only";
import { composio } from "@/lib/composio/client";
import { ga4Adapter } from "@/lib/composio/ga4";
import { gscAdapter } from "@/lib/composio/gsc";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DiscoveredResource } from "@/lib/analytics/types";
import { HttpError } from "./http";
import { PROVIDER_META, type ProviderId } from "./providers";

function authConfigId(provider: ProviderId): string {
  const env = serverEnv();
  if (provider === "ga4") return env.COMPOSIO_AUTH_CONFIG_GA4;
  if (provider === "gsc") return env.COMPOSIO_AUTH_CONFIG_GSC;
  throw new HttpError(501, `${PROVIDER_META[provider].label} is not available through Composio`);
}

/** Composio "user id" for a client. One entity per client keeps tenants separated. */
const entityId = (clientId: string) => `client:${clientId}`;

/** Step 1-2: backend starts the Composio OAuth flow and records a pending connection. */
export async function startConnect(clientId: string, provider: ProviderId): Promise<string> {
  const env = serverEnv();
  const request = await composio().connectedAccounts.link(entityId(clientId), authConfigId(provider), {
    callbackUrl: `${env.NEXT_PUBLIC_APP_URL}/api/integrations/${provider}/callback`,
  });
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

export type CompleteResult = { ok: true } | { ok: false; reason: string };

/**
 * Steps 3-5 (after the user returns from Google): verify the account with Composio, then
 * discover selectable properties/sites. We never trust the callback's query string: the
 * connected-account id comes from the pending row we wrote in startConnect.
 */
export async function completeConnect(clientId: string, provider: ProviderId): Promise<CompleteResult> {
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("integration_connections")
    .select("id, composio_connected_account_id, composio_entity_id")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn?.composio_connected_account_id || !conn.composio_entity_id) {
    return { ok: false, reason: "No pending connection found" };
  }

  const account = await composio().connectedAccounts.get(conn.composio_connected_account_id);
  if (account.status !== "ACTIVE") {
    const reason = `Connection not active (${account.status})`;
    await admin
      .from("integration_connections")
      .update({ status: "error", last_error: account.statusReason ?? reason })
      .eq("id", conn.id);
    return { ok: false, reason };
  }

  let found: DiscoveredResource[];
  try {
    const adapter = provider === "ga4" ? ga4Adapter : gscAdapter;
    found = await adapter.listResources({
      userId: conn.composio_entity_id,
      connectedAccountId: conn.composio_connected_account_id,
    });
  } catch (e) {
    const reason = "Connected, but listing resources failed";
    await admin
      .from("integration_connections")
      .update({ status: "error", last_error: `${reason}: ${(e instanceof Error ? e.message : "").slice(0, 300)}` })
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
    .update({ status: "connected", last_error: null })
    .eq("id", conn.id);
  return { ok: true };
}

/** Step 6-8: save the chosen resources (RLS enforces admin) and queue the initial import. */
export async function selectResources(clientId: string, provider: ProviderId, resourceIds: string[]) {
  const supabase = await createClient();

  const { error: clearErr } = await supabase
    .from("integration_resources")
    .update({ is_selected: false })
    .eq("client_id", clientId)
    .eq("provider", provider);
  if (clearErr) throw new HttpError(403, "Not allowed to change selection");

  if (resourceIds.length > 0) {
    const { data, error } = await supabase
      .from("integration_resources")
      .update({ is_selected: true })
      .eq("client_id", clientId)
      .eq("provider", provider)
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

export async function disconnect(clientId: string, provider: ProviderId) {
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("integration_connections")
    .select("id, composio_connected_account_id")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn) return;

  if (conn.composio_connected_account_id) {
    try {
      await composio().connectedAccounts.delete(conn.composio_connected_account_id);
    } catch {
      // already gone upstream; still disconnect locally
    }
  }
  await admin
    .from("integration_connections")
    .update({ status: "disconnected", composio_connected_account_id: null, last_error: null })
    .eq("id", conn.id);
  // stop syncing; keep historical metrics
  await admin.from("integration_resources").update({ is_selected: false }).eq("connection_id", conn.id);
  await admin
    .from("analytics_sync_jobs")
    .update({ status: "failed", error: "disconnected", finished_at: new Date().toISOString() })
    .eq("connection_id", conn.id)
    .eq("status", "queued");
}
