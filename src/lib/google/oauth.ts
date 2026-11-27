import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { ConfigError, configForClient, type OrgConfig } from "@/lib/org/config";

/**
 * Google OAuth 2.0 (authorization code + PKCE) for Business Profile, with the Google Cloud OAuth client of the
 * ORGANIZATION the client belongs to (Settings → Integrations → Google Cloud OAuth: GOOGLE_GBP_CLIENT_ID,
 * GOOGLE_GBP_CLIENT_SECRET, optional GOOGLE_GBP_REDIRECT_URI, and GOOGLE_API_KEY for request quotas). Connecting,
 * the callback and every token refresh use that same organization's client; a missing value is a ConfigError,
 * never another organization's client. Everything here runs on the server: the client secret and tokens never
 * reach the browser.
 */
/** httpOnly cookie holding state + PKCE verifier between connect and callback. */
export const GBP_OAUTH_COOKIE = "gbp_oauth";
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";
/** this deployment's callback path (the redirect URI's default) */
export const GBP_CALLBACK_PATH = "/api/integrations/gbp/callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export class GoogleAuthError extends Error {}

/** An organization's Google Cloud OAuth client. */
export type OAuthApp = {
  orgId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** the organization's GOOGLE_API_KEY (same Cloud project), sent with Business Profile calls when set */
  apiKey: string | null;
};

const validRedirect = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.hostname === "localhost";
  } catch {
    return false;
  }
};

/**
 * The redirect URI to register on the organization's OAuth client: its override when it has one, else this
 * deployment's callback. Without a configuration, the deployment's callback.
 */
export function gbpRedirectUri(cfg?: OrgConfig): string {
  const override = cfg?.get("GOOGLE_GBP_REDIRECT_URI");
  if (override) {
    if (!validRedirect(override)) {
      throw new ConfigError("google_oauth", ["GOOGLE_GBP_REDIRECT_URI"], "The redirect URI override saved for this organization isn't a full https:// address. An owner can fix it or leave it empty in Settings → Integrations → Google Cloud OAuth.");
    }
    return override;
  }
  return `${serverEnv().NEXT_PUBLIC_APP_URL}${GBP_CALLBACK_PATH}`;
}

/** The organization's OAuth client, or a ConfigError saying what an owner must add in Settings → Integrations. */
export function gbpApp(cfg: OrgConfig): OAuthApp {
  return {
    orgId: cfg.orgId,
    clientId: cfg.require("GOOGLE_GBP_CLIENT_ID"),
    clientSecret: cfg.require("GOOGLE_GBP_CLIENT_SECRET"),
    redirectUri: gbpRedirectUri(cfg),
    apiKey: cfg.get("GOOGLE_API_KEY") ?? null,
  };
}

/** The OAuth client of the organization this client belongs to. */
export async function gbpAppForClient(clientId: string): Promise<OAuthApp> {
  return gbpApp(await configForClient(clientId));
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
    redirect_uri: app.redirectUri,
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
    // the organization's client ID or secret is wrong (or the client was deleted): its settings, not the grant
    if (json.error === "invalid_client") {
      throw new ConfigError("google_oauth", ["GOOGLE_GBP_CLIENT_ID", "GOOGLE_GBP_CLIENT_SECRET"], "Google rejected this organization's OAuth client ID or secret. An owner can copy both again from Google Cloud → APIs & Services → Credentials into Settings → Integrations → Google Cloud OAuth.");
    }
    // invalid_grant = refresh token revoked/expired; reconnect needed
    const msg = `${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`;
    throw new GoogleAuthError(`Google token request failed (${msg})`);
  }
  return json;
}

export const exchangeCode = (app: OAuthApp, code: string, verifier: string) =>
  tokenRequest(app, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: app.redirectUri });

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
