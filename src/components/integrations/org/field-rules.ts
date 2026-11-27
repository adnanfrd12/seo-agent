import { integrationById, isRegisteredKey, KEY_OWNER, PLATFORM_ENV } from "@/lib/org/registry";

/**
 * Light checks on credential values, shared by the Configure dialog (instant feedback) and the server actions
 * (enforcement). They only catch paste mistakes; "Test connection" is the real check. Pure: no values are logged
 * or sent anywhere from here.
 */
export const MAX_VALUE = 8000;
/** same rule as the database check and credentials.ts (CUSTOM_KEY) */
export const KEY_RE = /^[A-Z][A-Z0-9_]{1,80}$/;
const GOOGLE_CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const GOOGLE_KEYS = new Set(["GOOGLE_API_KEY", "PAGESPEED_API_KEY", "YOUTUBE_API_KEY"]);

/** Trims, and drops an auth scheme pasted along with a token ("Token abc…", "Bearer abc…"). */
export function normalizeValue(key: string, value: string): string {
  const v = value.trim();
  if (key === "LOCAL_BRAND_MANAGER_API_TOKEN") return v.replace(/^Token\s+/i, "");
  if (/_TOKEN$/.test(key)) return v.replace(/^Bearer\s+/i, "");
  return v;
}

/** An error message for a registry field's (normalized, non-empty) value, or null when it looks fine. */
export function checkValue(key: string, v: string): string | null {
  if (!v) return "Enter a value.";
  if (v.length > MAX_VALUE) return "That value is too long.";
  if (/\s/.test(v)) return "Remove the spaces or line breaks: paste only the value.";
  if (v.length < 4) return "That looks too short.";
  if (key === "ANTHROPIC_API_KEY") {
    if (v.startsWith("sk-ant-admin")) return "That's an Admin API key. Create a regular API key instead.";
    if (!v.startsWith("sk-ant-")) return "Anthropic API keys start with sk-ant-.";
  }
  if (key === "DATAFORSEO_LOGIN" && !/^[^@]+@[^@]+\.[^@]+$/.test(v)) return "Use the API login from DataForSEO → API Access (an email address).";
  if (key === "GOOGLE_GBP_CLIENT_ID" && !GOOGLE_CLIENT_ID.test(v)) return "Use the OAuth client ID, which ends in .apps.googleusercontent.com.";
  if (key === "GOOGLE_GBP_REDIRECT_URI") {
    let u: URL | null = null;
    try { u = new URL(v); } catch { /* below */ }
    if (!u || (u.protocol !== "https:" && u.hostname !== "localhost")) return "Enter a full https:// address, or leave it empty.";
  }
  if (GOOGLE_KEYS.has(key) && !v.startsWith("AIza")) return "Google API keys start with AIza.";
  if (key.startsWith("COMPOSIO_AUTH_CONFIG_") && !/^ac_[A-Za-z0-9_-]+$/.test(v)) return "Composio auth config IDs start with ac_.";
  return null;
}

/** A custom variable's value: anything up to the size limit (spaces allowed). */
export function checkCustomValue(v: string): string | null {
  if (!v) return "Enter a value.";
  if (v.length > MAX_VALUE) return "That value is too long.";
  return null;
}

const RESERVED_EXTRA = ["NODE_ENV", "VERCEL"];
/** An error message for a custom variable name, or null when it can be used. */
export function checkCustomKey(key: string): string | null {
  if (!KEY_RE.test(key)) return "Use capital letters, digits and underscores, starting with a letter (e.g. MY_SETTING).";
  if (isRegisteredKey(key)) return `${key} belongs to ${integrationById(KEY_OWNER[key])?.name ?? "an integration"}: set it on that integration's card.`;
  if (PLATFORM_ENV.some((p) => p.key === key) || RESERVED_EXTRA.includes(key) || key.startsWith("VERCEL_")) return `${key} is a platform setting and stays in the hosting environment.`;
  return null;
}

/** What the name field turns typing into: MY SETTING-1 → MY_SETTING_1. */
export const toKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^[^A-Z]+/, "").slice(0, 81);
