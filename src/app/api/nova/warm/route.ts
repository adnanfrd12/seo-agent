import { after } from "next/server";
import { warmNova } from "@/lib/ai/intelligence";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Called when the user is about to use Nova (opening the panel, hovering the launcher): rebuilds a stale data
 * brief and caches the most-used data views in the background, so the first answer doesn't wait for them.
 * No AI calls and no cost; does nothing when everything is fresh.
 */
export async function POST() {
  const { client } = await getSession();
  if (!client) return new Response(null, { status: 401 });
  const admin = createAdminClient();
  after(() => warmNova(admin, client.id, client.timezone).catch(() => undefined));
  return new Response(null, { status: 204 });
}
