import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl, GBP_OAUTH_COOKIE, gbpConfigured, newPkce } from "@/lib/google/oauth";
import { assertSameOrigin, errorResponse, HttpError, requireAdmin } from "@/lib/integrations/http";

/**
 * Starts Google OAuth for Business Profile. State (CSRF) and the PKCE verifier are kept in a
 * short-lived httpOnly cookie bound to this client; the browser only receives Google's URL.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { client } = await requireAdmin();
    if (!gbpConfigured()) throw new HttpError(503, "Google Business Profile OAuth isn't configured (GOOGLE_GBP_CLIENT_ID / GOOGLE_GBP_CLIENT_SECRET / TOKEN_ENCRYPTION_KEY).");
    const { verifier, challenge, state } = newPkce();
    const res = NextResponse.json({ redirectUrl: authorizationUrl(state, challenge) });
    res.cookies.set(GBP_OAUTH_COOKIE, JSON.stringify({ state, verifier, clientId: client.id }), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax",
      path: "/api/integrations/gbp", maxAge: 600,
    });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
