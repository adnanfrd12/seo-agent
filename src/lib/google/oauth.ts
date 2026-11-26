import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Google OAuth 2.0 (authorization code + PKCE) for Business Profile. Everything here runs on the
 * server: the client secret and tokens never reach the browser.
 */
/** httpOnly cookie holding state + PKCE verifier between connect and callback. */
export const GBP_OAUTH_COOKIE = "gbp_oauth";
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export class GoogleAuthError extends Error {}

/** The environment's (GOOGLE_GBP_*) OAuth app is configured. Owners can also save their own app (oauth-apps.ts). */
export function gbpConfigured(): boolean {
  const e = serverEnv();
  return Boolean(e.GOOGLE_GBP_CLIENT_ID && e.GOOGLE_GBP_CLIENT_SECRET && e.TOKEN_ENCRYPTION_KEY);
}

/** A Google OAuth client. `owner` is the user whose saved app it is; null = the environment's app. */
export type OAuthApp = { clientId: string; clientSecret: string; owner: string | null };

export function envApp(): OAuthApp | null {
  const e = serverEnv();
  return e.GOOGLE_GBP_CLIENT_ID && e.GOOGLE_GBP_CLIENT_SECRET
    ? { clientId: e.GOOGLE_GBP_CLIENT_ID, clientSecret: e.GOOGLE_GBP_CLIENT_SECRET, owner: null }
    : null;
}

/** The registered redirect URI; falls back to the app URL so local dev works. */
export function gbpRedirectUri(): string {
  const e = serverEnv();
  return e.GOOGLE_GBP_REDIRECT_URI ?? `${e.NEXT_PUBLIC_APP_URL}/api/integrations/gbp/callback`;
}

export function newPkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(24).toString("base64url") };
}

export function authorizationUrl(app: OAuthApp, state: string, challenge: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: gbpRedirectUri(),
    response_type: "code",
    scope: `openid email ${GBP_SCOPE}`,
    access_type: "offline", // refresh token
    prompt: "consent", // re-issue a refresh token on reconnect
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export type TokenSet = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string };

async function tokenRequest(app: OAuthApp, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      ...body,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenSet & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    // invalid_grant = refresh token revoked/expired; reconnect needed
    const msg = `${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`;
    throw new GoogleAuthError(`Google token request failed (${msg})`);
  }
  return json;
}

export const exchangeCode = (app: OAuthApp, code: string, verifier: string) =>
  tokenRequest(app, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: gbpRedirectUri() });

export const refreshAccessToken = (app: OAuthApp, refreshToken: string) =>
  tokenRequest(app, { grant_type: "refresh_token", refresh_token: refreshToken });

export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

/** Email from the id_token payload (already received over TLS from Google's token endpoint). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** Google account ID ("sub") from the id_token payload, used to match deletion requests. */
export function subFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Checks an OAuth client id/secret pair with Google without any user: a refresh with a made-up token is answered
 * "invalid_grant" when the client is valid and "invalid_client" / "unauthorized_client" when it isn't.
 */
export async function checkApp(app: Pick<OAuthApp, "clientId" | "clientSecret">): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: "check" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (json.error === "invalid_grant") return { ok: true };
    if (json.error === "invalid_client" || json.error === "unauthorized_client") {
      return { ok: false, reason: "Google rejected this client ID and secret. Copy both again from Google Cloud → APIs & Services → Credentials." };
    }
    return { ok: false, reason: `Google answered unexpectedly (${json.error ?? res.status}).` };
  } catch {
    return { ok: false, reason: "Couldn't reach Google to check the credentials. Try again." };
  }
}
