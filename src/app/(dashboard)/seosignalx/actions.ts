"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { refreshBundle, sxConfigured } from "@/lib/seosignalx/mcp";
import { createAdminClient } from "@/lib/supabase/admin";

/** Reads the client's SEOSignalX project again through the MCP server (read-only, free). */
export async function syncSeoSignalX(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!sxConfigured()) return { ok: false, error: "SEOSIGNALX_MCP_TOKEN isn't set." };
  const b = await refreshBundle(createAdminClient(), client.id);
  // every SEOSignalX tab reads the same stored bundle: refresh them all, not just the dashboard
  revalidatePath("/seosignalx", "layout");
  return b.error ? { ok: false, error: b.error } : { ok: true };
}
