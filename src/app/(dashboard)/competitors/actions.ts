"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { loadCompetitors, refreshCompetitorExtras } from "@/lib/dataforseo/competitors";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Link history and top pages for the tracked competitors (weekly; skipped while fresh). */
export async function refreshCompetitorExtrasNow(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can refresh competitor data." };
  const db = createAdminClient();
  const target = await resolveTarget(db, client.id);
  if (!target) return { ok: false, error: "Set the client's website first." };
  const comp = await loadCompetitors(db, client.id);
  if (!comp.tracked.length) return { ok: false, error: "No competitors are tracked yet." };
  const r = await refreshCompetitorExtras({ admin: db, clientId: client.id, source: "manual" }, target, comp.tracked);
  revalidatePath("/competitors");
  if (!r.fetched && r.errors.length) return { ok: false, error: r.errors[0] };
  return { ok: true, message: r.fetched ? `Updated ${r.fetched} competitor dataset${r.fetched > 1 ? "s" : ""} ($${r.cost.toFixed(2)}).${r.errors.length ? ` Issues: ${r.errors.join("; ")}` : ""}` : "Everything is less than a week old; nothing was fetched." };
}
