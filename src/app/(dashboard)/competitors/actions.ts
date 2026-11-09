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

const bareDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/**
 * Removes a competitor: it leaves the tracked list and goes on competitors_excluded, so automatic picks
 * never bring it back and its stored data is hidden. Nothing is deleted, so it can be restored.
 */
export async function removeCompetitor(domain: string): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can remove competitors." };
  const d = bareDomain(domain);
  if (d.length < 4) return { ok: false, error: "Invalid domain." };
  const db = createAdminClient();
  const { data: t } = await db.from("research_targets").select("competitors, competitors_excluded").eq("client_id", client.id).maybeSingle();
  if (!t) return { ok: false, error: "Set the client's website first." };
  const competitors = ((t.competitors ?? []) as string[]).filter((c) => bareDomain(c) !== d);
  const excluded = [...new Set([...((t.competitors_excluded ?? []) as string[]).map(bareDomain), d])].slice(-50);
  const { error } = await db.from("research_targets").update({ competitors, competitors_excluded: excluded }).eq("client_id", client.id);
  if (error) return { ok: false, error: "Could not save; try again." };
  revalidatePath("/competitors");
  revalidatePath("/overview");
  return { ok: true, message: `${d} removed. It won't be tracked or shown again unless you restore it.` };
}

/** Undo a removal: takes it off competitors_excluded and tracks it again (as a manual pick). */
export async function restoreCompetitor(domain: string): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can restore competitors." };
  const d = bareDomain(domain);
  const db = createAdminClient();
  const { data: t } = await db.from("research_targets").select("competitors, competitors_excluded").eq("client_id", client.id).maybeSingle();
  if (!t) return { ok: false, error: "Set the client's website first." };
  const excluded = ((t.competitors_excluded ?? []) as string[]).filter((c) => bareDomain(c) !== d);
  const competitors = [...new Set([...((t.competitors ?? []) as string[]), d])].slice(0, 8);
  const { error } = await db.from("research_targets").update({ competitors, competitors_excluded: excluded }).eq("client_id", client.id);
  if (error) return { ok: false, error: "Could not save; try again." };
  revalidatePath("/competitors");
  revalidatePath("/overview");
  return { ok: true, message: `${d} restored. Its data reappears now; new data comes with the next daily analysis.` };
}
