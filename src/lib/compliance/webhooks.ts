import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE } from "@/config/platforms";
import { parseSignedRequest, verifyTikTokSignature, type MetaSignedRequest } from "./signatures";

/**
 * Route handlers for platform notifications (app/api/platform-webhooks/*). The deletion work is injected so the
 * endpoints are tested without a database; production passes the real service (lazy import keeps it server-side).
 *
 * Every organization uses its own Meta / Threads / TikTok app, and a notification doesn't say which organization it
 * is for. So it is verified against each organization's own app secret (Settings → Integrations), and only the
 * organizations whose secret signed it are acted on: one organization's app can never delete another's data.
 */
export interface WebhookDeps {
  /** deletes every connection matching the platform user in these organizations; returns how many were deleted */
  deauthorize(platform: string, platformUserId: string, orgIds: string[]): Promise<number>;
  /** records a deletion request, deletes matching connections in these organizations; returns the confirmation code */
  deletionRequest(platform: string, platformUserId: string, orgIds: string[]): Promise<string>;
}

/** An organization's app secret for one platform. */
export interface OrgSecret { orgId: string; secret: string }

/** Connection refs (see deletion.ts) whose client belongs to one of the organizations. */
export async function inOrganizations(admin: SupabaseClient, refs: string[], orgIds: string[]): Promise<string[]> {
  if (!refs.length || !orgIds.length) return [];
  const clientOf = new Map<string, string>();
  const connIds = refs.filter((r) => !r.startsWith("social:"));
  for (const r of refs) if (r.startsWith("social:")) clientOf.set(r, r.split(":")[1] ?? "");
  if (connIds.length) {
    const { data } = await admin.from("integration_connections").select("id, client_id").in("id", connIds);
    for (const c of data ?? []) clientOf.set(c.id as string, c.client_id as string);
  }
  const clientIds = [...new Set([...clientOf.values()].filter(Boolean))];
  if (!clientIds.length) return [];
  const { data: clients } = await admin.from("clients").select("id").in("id", clientIds).in("organization_id", orgIds);
  const allowed = new Set((clients ?? []).map((c) => c.id as string));
  return refs.filter((r) => allowed.has(clientOf.get(r) ?? ""));
}

async function realDeps(): Promise<WebhookDeps> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { deleteConnection, findByPlatformUser, handleDeletionRequest } = await import("./deletion");
  const admin = createAdminClient();
  return {
    async deauthorize(platform, uid, orgIds) {
      const refs = await inOrganizations(admin, await findByPlatformUser(admin, platform, uid), orgIds);
      for (const ref of refs) await deleteConnection(admin, ref, "platform_webhook", { platformUserId: uid });
      return refs.length;
    },
    async deletionRequest(platform, uid, orgIds) {
      const refs = await inOrganizations(admin, await findByPlatformUser(admin, platform, uid), orgIds);
      return (await handleDeletionRequest(admin, { platform, platformUserId: uid, source: "platform_webhook", refs })).code;
    },
  };
}

/**
 * Every organization's own app secret for a platform (the first of `keys` it has), to verify a notification with.
 * Read on the server from the encrypted organization credentials; never logged or returned.
 */
export function orgSecrets(keys: string[]): () => Promise<OrgSecret[]> {
  return async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { orgConfig } = await import("@/lib/org/config");
    const admin = createAdminClient();
    // organizations that saved one of the keys, and the first organization while it still reads the server environment
    const [{ data: saved }, { data: legacy }] = await Promise.all([
      admin.from("organization_credentials").select("organization_id").in("key", keys),
      admin.from("organizations").select("id").eq("uses_env_fallback", true),
    ]);
    const ids = [...new Set([...(saved ?? []).map((r) => r.organization_id as string), ...(legacy ?? []).map((r) => r.id as string)])];
    const out: OrgSecret[] = [];
    for (const orgId of ids) {
      const cfg = await orgConfig(orgId).catch(() => null);
      const secret = cfg ? keys.map((k) => cfg.get(k)).find(Boolean) : undefined;
      if (secret) out.push({ orgId, secret });
    }
    return out;
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function signedRequestOf(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) { const b = (await req.json()) as { signed_request?: unknown }; return typeof b.signed_request === "string" ? b.signed_request : null; }
    const text = await req.text();
    return new URLSearchParams(text).get("signed_request");
  } catch { return null; }
}

export const statusUrl = (code: string) => `${SITE.appUrl}/data-deletion/status?code=${encodeURIComponent(code)}`;

/** Meta deauthorize/uninstall (kind "deauthorize") or data deletion (kind "delete") callback for one Meta product. */
export function metaRoute(opts: { platform: string; kind: "deauthorize" | "delete"; secrets: () => Promise<OrgSecret[]>; deps?: () => Promise<WebhookDeps> }) {
  return async function POST(req: Request): Promise<Response> {
    const signed = await signedRequestOf(req);
    let candidates: OrgSecret[];
    try { candidates = await opts.secrets(); }
    catch (e) { console.error(`[platform-webhooks] ${opts.platform}: app secrets unavailable`, e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
    if (!candidates.length) console.error(`[platform-webhooks] ${opts.platform}: no organization has the app secret configured`);
    // the organizations whose own app secret signed this request
    let data: MetaSignedRequest | null = null;
    const orgIds: string[] = [];
    for (const c of candidates) {
      const d = parseSignedRequest(signed, c.secret);
      if (d) { data = d; orgIds.push(c.orgId); }
    }
    if (!data) return json({ error: "invalid signed_request" }, 400);
    const deps = await (opts.deps ?? realDeps)();
    if (opts.kind === "deauthorize") {
      try { await deps.deauthorize(opts.platform, data.user_id, orgIds); }
      catch (e) { console.error(`[platform-webhooks] ${opts.platform} deauthorize failed`, e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
      return json({ success: true });
    }
    let code: string;
    try { code = await deps.deletionRequest(opts.platform, data.user_id, orgIds); }
    catch (e) { console.error(`[platform-webhooks] ${opts.platform} delete failed`, e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
    return json({ url: statusUrl(code), confirmation_code: code });
  };
}

/** TikTok webhook: verifies TikTok-Signature, deletes on authorization.removed, always answers 200 once verified. */
export function tiktokRoute(opts: { secrets: () => Promise<OrgSecret[]>; deps?: () => Promise<WebhookDeps>; now?: () => number }) {
  return async function POST(req: Request): Promise<Response> {
    const raw = await req.text();
    let candidates: OrgSecret[];
    try { candidates = await opts.secrets(); }
    catch (e) { console.error("[platform-webhooks] tiktok: app secrets unavailable", e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
    const header = req.headers.get("tiktok-signature");
    // the organizations whose own TikTok app (client secret) signed this notification
    const orgIds = candidates.filter((c) => verifyTikTokSignature(header, raw, c.secret, opts.now?.())).map((c) => c.orgId);
    if (!orgIds.length) return json({ error: "invalid signature" }, 400);
    let body: { event?: string; user_openid?: string; open_id?: string } = {};
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid body" }, 400); }
    const uid = body.user_openid ?? body.open_id;
    if (body.event === "authorization.removed" && uid) {
      // TikTok wants a fast 200 and retries for 72 hours otherwise; deletion is idempotent, so a retry is harmless
      try { await (await (opts.deps ?? realDeps)()).deletionRequest("tiktok", uid, orgIds); }
      catch (e) { console.error("[platform-webhooks] tiktok delete failed", e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
    }
    return json({ success: true });
  };
}
