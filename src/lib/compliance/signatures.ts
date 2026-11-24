import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signature checks for platform notifications. Pure functions (no I/O) so they are unit-tested.
 *
 * Meta signed_request (Facebook Login, Instagram Login, Threads uninstall/delete callbacks): the POST form field
 * `signed_request` is `<base64url signature>.<base64url payload>`. The signature is HMAC-SHA256 of the still-encoded
 * payload segment with the app secret; the payload JSON carries `algorithm: "HMAC-SHA256"` and `user_id`
 * (the app-scoped user ID). See developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback.
 *
 * TikTok webhooks: header `TikTok-Signature: t=<unix seconds>,s=<hex>`, where s = HMAC-SHA256(client_secret,
 * `${t}.${rawBody}`). See developers.tiktok.com/doc/webhooks-verification.
 */

export interface MetaSignedRequest { user_id: string; algorithm: string; issued_at?: number; [k: string]: unknown }

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Verified payload, or null when the request is malformed, uses another algorithm or the signature doesn't match. */
export function parseSignedRequest(signed: string | null | undefined, secret: string | undefined): MetaSignedRequest | null {
  if (!signed || !secret) return null;
  const dot = signed.indexOf(".");
  if (dot <= 0 || dot === signed.length - 1) return null;
  const sig = signed.slice(0, dot), payload = signed.slice(dot + 1);
  let data: MetaSignedRequest;
  try { data = JSON.parse(b64url(payload).toString("utf8")); } catch { return null; }
  if (!data || typeof data !== "object" || String(data.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (!safeEqual(b64url(sig), expected)) return null;
  if (data.user_id == null || String(data.user_id) === "") return null;
  return { ...data, user_id: String(data.user_id) };
}

/** Builds a signed_request (tests and local tooling). */
export function makeSignedRequest(payload: Record<string, unknown>, secret: string): string {
  const enc = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(enc).digest("base64url");
  return `${sig}.${enc}`;
}

export const TIKTOK_TOLERANCE_S = 300;

/** True when the TikTok-Signature header matches the raw body and is no older than 5 minutes. */
export function verifyTikTokSignature(header: string | null | undefined, rawBody: string, secret: string | undefined, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; }));
  const t = Number(parts.t), s = parts.s;
  if (!Number.isFinite(t) || !s || !/^[0-9a-f]+$/i.test(s)) return false;
  if (Math.abs(nowS - t) > TIKTOK_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest();
  return safeEqual(Buffer.from(s, "hex"), expected);
}

export function signTikTok(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},s=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

/** Random URL-safe confirmation code (12 chars, unambiguous alphabet). */
export function confirmationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(12)].map((b) => alphabet[b % alphabet.length]).join("");
}

export const CODE_RE = /^[A-Z2-9]{10,12}$/;
