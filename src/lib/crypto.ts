import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireOptional } from "@/lib/env";

/**
 * AES-256-GCM for third-party API tokens at rest (e.g. the Clarity token).
 * TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64-encoded:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url parts).
 */
function key(): Buffer {
  const k = Buffer.from(requireOptional("TOKEN_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("Missing or invalid environment variables: TOKEN_ENCRYPTION_KEY (must be 32 bytes, base64)");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(packed: string): string {
  const [v, iv, tag, data] = packed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unreadable stored secret");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
