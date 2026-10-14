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
