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

/** Composio toolkit slugs (as reported by connected accounts). */
const TOOLKIT_SLUG = { ga4: "google_analytics", gsc: "google_search_console" } as const;

/** Composio "user id" for a client. One entity per client keeps tenants separated. */
const entityId = (clientId: string) => `client:${clientId}`;

/** All of this client's Composio accounts for a toolkit, newest first. */
async function listAccounts(clientId: string, provider: "ga4" | "gsc") {
  const res = await composio().connectedAccounts.list({
    userIds: [entityId(clientId)],
    toolkitSlugs: [TOOLKIT_SLUG[provider]],
    limit: 50,
  });
  return [...res.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

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

  let accounts = await listAccounts(clientId, provider);
  let active = accounts.find((a) => a.status === "ACTIVE");

  if (!active) {
    // The redirect can beat Composio's own status update; give an in-flight authorization a moment.
    const inflight = accounts.find((a) => a.status === "INITIALIZING" || a.status === "INITIATED");
    if (inflight) {
      try {
        await composio().connectedAccounts.waitForConnection(inflight.id, 20_000);
      } catch {
        // still not active; handled below
      }
      accounts = await listAccounts(clientId, provider);
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

  // Revoke superseded/expired duplicates so no unused live OAuth grants are left behind.
  await Promise.allSettled(
    accounts.filter((a) => a.id !== active.id).map((a) => composio().connectedAccounts.delete(a.id)),
  );
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
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn) return;

  // Revoke every Composio account for this client+toolkit, not just the stored one.
  if (provider !== "gbp") {
    try {
      const accounts = await listAccounts(clientId, provider);
      await Promise.allSettled(accounts.map((a) => composio().connectedAccounts.delete(a.id)));
    } catch {
      // upstream already gone or unreachable; still disconnect locally
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
