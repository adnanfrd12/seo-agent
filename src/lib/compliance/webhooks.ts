import { SITE } from "@/config/platforms";
import { parseSignedRequest, verifyTikTokSignature } from "./signatures";

/**
 * Route handlers for platform notifications (app/api/platform-webhooks/*). The deletion work is injected so the
 * endpoints are tested without a database; production passes the real service (lazy import keeps it server-side).
 */
export interface WebhookDeps {
  /** deletes every connection matching the platform user; returns how many were deleted */
  deauthorize(platform: string, platformUserId: string): Promise<number>;
  /** records a deletion request, deletes matching connections; returns the confirmation code */
  deletionRequest(platform: string, platformUserId: string): Promise<string>;
}

async function realDeps(): Promise<WebhookDeps> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { deleteConnection, findByPlatformUser, handleDeletionRequest } = await import("./deletion");
  const admin = createAdminClient();
  return {
    async deauthorize(platform, uid) {
      const refs = await findByPlatformUser(admin, platform, uid);
      for (const ref of refs) await deleteConnection(admin, ref, "platform_webhook", { platformUserId: uid });
      return refs.length;
    },
    async deletionRequest(platform, uid) {
      return (await handleDeletionRequest(admin, { platform, platformUserId: uid, source: "platform_webhook" })).code;
    },
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
export function metaRoute(opts: { platform: string; kind: "deauthorize" | "delete"; secret: () => string | undefined; deps?: () => Promise<WebhookDeps> }) {
  return async function POST(req: Request): Promise<Response> {
    const secret = opts.secret();
    const data = parseSignedRequest(await signedRequestOf(req), secret);
    if (!secret) console.error(`[platform-webhooks] ${opts.platform}: app secret is not configured`);
    if (!data) return json({ error: "invalid signed_request" }, 400);
    const deps = await (opts.deps ?? realDeps)();
    if (opts.kind === "deauthorize") {
      try { await deps.deauthorize(opts.platform, data.user_id); }
      catch (e) { console.error(`[platform-webhooks] ${opts.platform} deauthorize failed`, e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
      return json({ success: true });
    }
    let code: string;
    try { code = await deps.deletionRequest(opts.platform, data.user_id); }
    catch (e) { console.error(`[platform-webhooks] ${opts.platform} delete failed`, e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
    return json({ url: statusUrl(code), confirmation_code: code });
  };
}

/** TikTok webhook: verifies TikTok-Signature, deletes on authorization.removed, always answers 200 once verified. */
export function tiktokRoute(opts: { secret: () => string | undefined; deps?: () => Promise<WebhookDeps>; now?: () => number }) {
  return async function POST(req: Request): Promise<Response> {
    const raw = await req.text();
    if (!verifyTikTokSignature(req.headers.get("tiktok-signature"), raw, opts.secret(), opts.now?.())) return json({ error: "invalid signature" }, 400);
    let body: { event?: string; user_openid?: string; open_id?: string } = {};
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid body" }, 400); }
    const uid = body.user_openid ?? body.open_id;
    if (body.event === "authorization.removed" && uid) {
      // TikTok wants a fast 200 and retries for 72 hours otherwise; deletion is idempotent, so a retry is harmless
      try { await (await (opts.deps ?? realDeps)()).deletionRequest("tiktok", uid); }
      catch (e) { console.error("[platform-webhooks] tiktok delete failed", e instanceof Error ? e.message : e); return json({ error: "temporarily unavailable" }, 500); }
    }
    return json({ success: true });
  };
}
