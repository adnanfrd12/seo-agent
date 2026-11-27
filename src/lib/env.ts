import "server-only";
import { z } from "zod";

/**
 * The hosting environment. Only the platform variables (database, encryption key, cron secret, app URL) are
 * required: a new deployment boots with those alone. Integration credentials belong to each organization
 * (Settings → Integrations, read through src/lib/org/config.ts); the optional entries below are the former
 * Vercel variables, which only the first organization still falls back to until its owner imports them.
 * Features never read them from here for an organization's work.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
  CRON_SECRET: z.string().min(16),
  // platform, optional: features that need them say so when they're missing
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  CHROME_EXECUTABLE_PATH: z.string().min(1).optional(),
  // optional notifications (off until set): ops webhook for failed jobs, email for critical client alerts
  ALERT_WEBHOOK_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  // organization-level (first organization's environment fallback only): never required at boot, never validated
  // beyond being text, so a stale or odd value here can't stop the app from starting
  COMPOSIO_API_KEY: z.string().optional(),
  COMPOSIO_AUTH_CONFIG_GA4: z.string().optional(),
  COMPOSIO_AUTH_CONFIG_GSC: z.string().optional(),
  COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS: z.string().optional(),
  COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GBP_CLIENT_ID: z.string().optional(),
  GOOGLE_GBP_CLIENT_SECRET: z.string().optional(),
  GOOGLE_GBP_REDIRECT_URI: z.string().optional(),
  LOCAL_BRAND_MANAGER_API_TOKEN: z.string().optional(),
  BING_WEBMASTER_API_KEY: z.string().optional(),
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

/** Validated server env. Throws a readable error listing missing variable NAMES (never values). */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables: ${names}`);
  }
  return (cached = parsed.data);
}

/** Name of a missing optional variable as a readable error (never the value). */
export function requireOptional<K extends "ANTHROPIC_API_KEY" | "TOKEN_ENCRYPTION_KEY">(name: K): string {
  const v = serverEnv()[name];
  if (!v) throw new Error(`Missing or invalid environment variables: ${name}`);
  return v;
}
