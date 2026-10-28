import "server-only";
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  COMPOSIO_API_KEY: z.string().min(1),
  COMPOSIO_AUTH_CONFIG_GA4: z.string().min(1),
  COMPOSIO_AUTH_CONFIG_GSC: z.string().min(1),
  COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS: z.string().optional(),
  COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.url(),
  CRON_SECRET: z.string().min(16),
  // optional features: each is disabled with a clear message when its variable is missing
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  CHROME_EXECUTABLE_PATH: z.string().min(1).optional(),
  // Google Business Profile uses its own Google OAuth client (Composio has no GBP toolkit)
  GOOGLE_GBP_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_GBP_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_GBP_REDIRECT_URI: z.url().optional(),
  LOCAL_BRAND_MANAGER_API_TOKEN: z.string().optional(),
  BING_WEBMASTER_API_KEY: z.string().optional(),
  // DataForSEO (backlinks, organic keywords, keyword research) and its spending guard
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
export function requireOptional<
  K extends "ANTHROPIC_API_KEY" | "TOKEN_ENCRYPTION_KEY" | "GOOGLE_GBP_CLIENT_ID" | "GOOGLE_GBP_CLIENT_SECRET",
>(name: K): string {
  const v = serverEnv()[name];
  if (!v) throw new Error(`Missing or invalid environment variables: ${name}`);
  return v;
}
