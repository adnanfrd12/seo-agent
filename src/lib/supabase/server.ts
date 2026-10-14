import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Per-request Supabase client acting as the signed-in user (RLS applies).
 * `headers` are forwarded to PostgREST; the dashboard uses x-resource-<provider> to scope RPCs
 * to one property/site (see migration 20261014000009).
 */
export async function createClient(headers?: Record<string, string>) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(headers && Object.keys(headers).length > 0 ? { global: { headers } } : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a Server Component; the proxy refreshes the session instead
          }
        },
      },
    },
  );
}
