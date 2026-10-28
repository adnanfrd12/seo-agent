"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/analytics/client-context";
import { COACH_COOLDOWN_HOURS, COACH_MODES, generateCoach, type CoachMode } from "@/lib/ai/coach";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Writes one of the four analyses from the stored data (owners and admins; about 15 cents on the Anthropic key). */
export async function runCoach(mode: CoachMode, force: boolean): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can generate these analyses." };
  if (!COACH_MODES.includes(mode)) return { ok: false, error: "Unknown analysis." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY isn't set on the server." };
  const db = createAdminClient();
  if (!force) {
    const { data } = await db.from("dfs_cache").select("fetched_at").eq("client_id", client.id).eq("endpoint", `coach_${mode}`).maybeSingle();
    if (data && Date.now() - Date.parse(data.fetched_at as string) < COACH_COOLDOWN_HOURS * 3_600_000) return { ok: true, message: `Already generated in the last ${COACH_COOLDOWN_HOURS} hours; showing the saved answer.` };
  }
  const r = await generateCoach(db, client.id, client.timezone ?? "UTC", mode);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/coach");
  return { ok: true, message: `Done ($${r.result.cost.toFixed(3)}).` };
}
