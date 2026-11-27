"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { refreshBundle, SX_NOT_CONFIGURED, sxConfigured } from "@/lib/seosignalx/mcp";
import { createAdminClient } from "@/lib/supabase/admin";

/** Reads the client's SEOSignalX project again through the MCP server (read-only, free). */
export async function syncSeoSignalX(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!(await sxConfigured(client.id))) return { ok: false, error: SX_NOT_CONFIGURED };
  const b = await refreshBundle(createAdminClient(), client.id);
  // every SEOSignalX tab reads the same stored bundle: refresh them all, not just the dashboard
  revalidatePath("/seosignalx", "layout");
  return b.error ? { ok: false, error: b.error } : { ok: true };
}
