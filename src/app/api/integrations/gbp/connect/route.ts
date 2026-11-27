import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl, GBP_OAUTH_COOKIE, gbpAppForClient, newPkce } from "@/lib/google/oauth";
import { assertSameOrigin, errorResponse, HttpError, requireAdmin } from "@/lib/integrations/http";
import { ConfigError } from "@/lib/org/config";

/**
 * Starts Google OAuth for Business Profile with the Google Cloud OAuth client of the active client's organization
 * (Settings → Integrations → Google Cloud OAuth). State (CSRF), the PKCE verifier and which OAuth client was used
 * are kept in a short-lived httpOnly cookie bound to this client; the browser only receives Google's URL.
 * A missing setting is answered with what an owner must add, shown on the Connect button.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { user, client } = await requireAdmin();
    if (!process.env.TOKEN_ENCRYPTION_KEY) throw new HttpError(503, "TOKEN_ENCRYPTION_KEY isn't configured, so Google tokens can't be stored.");
    const app = await gbpAppForClient(client.id);
    const { verifier, challenge, state } = newPkce();
    const res = NextResponse.json({ redirectUrl: authorizationUrl(app, state, challenge) });
    res.cookies.set(GBP_OAUTH_COOKIE, JSON.stringify({ state, verifier, clientId: client.id, userId: user.id, oauthClientId: app.clientId }), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax",
      path: "/api/integrations/gbp", maxAge: 600,
    });
    return res;
  } catch (e) {
    return errorResponse(e instanceof ConfigError ? new HttpError(503, e.message) : e);
  }
}
