import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { GbpApiError } from "@/lib/google/gbp";
import { emailFromIdToken, exchangeCode, GBP_OAUTH_COOKIE, GBP_SCOPE } from "@/lib/google/oauth";
import { discoverLocations, storeGrant } from "@/lib/integrations/gbp-service";
import { requireAdmin } from "@/lib/integrations/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google redirects here with ?code&state. Exchanges the code server-side and lists locations. */
export async function GET(request: NextRequest) {
  const back = (qs: string) => {
    const res = NextResponse.redirect(new URL(`/integrations?${qs}&provider=gbp`, request.url));
    res.cookies.set(GBP_OAUTH_COOKIE, "", { path: "/api/integrations/gbp", maxAge: 0 });
    return res;
  };
  const fail = (m: string) => back(`error=${encodeURIComponent(m)}`);
  const sp = request.nextUrl.searchParams;

  if (sp.get("error")) return fail(sp.get("error") === "access_denied" ? "Google access was denied on the consent screen." : `Google returned an error: ${sp.get("error")}`);

  let saved: { state: string; verifier: string; clientId: string };
  try {
    saved = JSON.parse(request.cookies.get(GBP_OAUTH_COOKIE)?.value ?? "");
  } catch {
    return fail("The sign-in session expired. Click Connect Account again.");
  }
  const code = sp.get("code");
  if (!code || !saved?.state || !same(sp.get("state") ?? "", saved.state)) return fail("Invalid OAuth state. Click Connect Account again.");

  let clientId: string;
  try {
    clientId = (await requireAdmin()).client.id;
  } catch {
    return fail("Only owners and admins can connect integrations.");
  }
  if (clientId !== saved.clientId) return fail("The active client changed during sign-in. Click Connect Account again.");

  const admin = createAdminClient();
  let tokens;
  try {
    tokens = await exchangeCode(code, saved.verifier);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not exchange the authorization code.");
  }
  if (!(tokens.scope ?? "").split(" ").includes(GBP_SCOPE)) {
    return fail("The Business Profile permission (business.manage) wasn't granted. Connect again and tick every permission.");
  }

  const { data: conn, error } = await admin.from("integration_connections").upsert(
    {
      client_id: clientId, provider: "gbp", auth_method: "direct", status: "pending", last_error: null,
      composio_connected_account_id: null, composio_entity_id: null, account_email: emailFromIdToken(tokens.id_token),
    },
    { onConflict: "client_id,provider" },
  ).select("id").single();
  if (error || !conn) return fail("Could not save the connection.");

  try {
    await storeGrant(admin, conn.id, tokens);
    const { data: secret } = await admin.from("integration_secrets").select("connection_id").eq("connection_id", conn.id).maybeSingle();
    if (!secret) throw new Error("Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.");
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Could not store the grant.";
    await admin.from("integration_connections").update({ status: "error", last_error: reason }).eq("id", conn.id);
    return fail(reason);
  }

  try {
    const found = await discoverLocations(admin, clientId, conn.id, tokens.access_token);
    await admin.from("integration_connections").update({ status: "connected", last_error: null }).eq("id", conn.id);
    if (found.locations === 0) {
      return back(`notice=${encodeURIComponent(`Connected, but this Google account manages ${found.accounts} account(s) and no locations.`)}`);
    }
    return back("connected=gbp");
  } catch (e) {
    // The grant is valid; the API call failed (often: API not enabled or access not approved).
    const reason = e instanceof GbpApiError ? e.message : `Listing locations failed: ${e instanceof Error ? e.message : "unknown error"}`;
    await admin.from("integration_connections").update({ status: "error", last_error: reason.slice(0, 500) }).eq("id", conn.id);
    return fail(reason);
  }
}
