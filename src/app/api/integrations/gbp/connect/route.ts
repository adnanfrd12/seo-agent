import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl, GBP_OAUTH_COOKIE, newPkce } from "@/lib/google/oauth";
import { appForConnect } from "@/lib/google/oauth-apps";
import { assertSameOrigin, errorResponse, HttpError, requireAdmin } from "@/lib/integrations/http";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Starts Google OAuth for Business Profile with the agency's own OAuth app (the user's saved app, else the client
 * owner's, else the environment app). State (CSRF), the PKCE verifier and which app was used are kept in a
 * short-lived httpOnly cookie bound to this client; the browser only receives Google's URL.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { user, client } = await requireAdmin();
    if (!process.env.TOKEN_ENCRYPTION_KEY) throw new HttpError(503, "TOKEN_ENCRYPTION_KEY isn't configured, so Google tokens can't be stored.");
    const app = await appForConnect(createAdminClient(), user.id, client.id);
    if (!app) throw new HttpError(503, "No Google OAuth app is set up. Save your Google OAuth client ID and secret under Integrations → Google Business Profile → Your Google API credentials.");
    const { verifier, challenge, state } = newPkce();
    const res = NextResponse.json({ redirectUrl: authorizationUrl(app, state, challenge) });
    res.cookies.set(GBP_OAUTH_COOKIE, JSON.stringify({ state, verifier, clientId: client.id, userId: user.id, appOwner: app.owner }), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax",
      path: "/api/integrations/gbp", maxAge: 600,
    });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
