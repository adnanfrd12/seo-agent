"use server";

import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { runAnalysis, type RunKind } from "@/lib/ai/run";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; message: string } | { ok: false; error: string };
const iso = z.iso.date();

async function admin() {
  const { user, client } = await getSession();
  if (!client) throw new Error("No client");
  return { user, client, canEdit: ["owner", "admin"].includes(client.role) };
}

/** Generate (or regenerate) AI insights or the 30-day strategy for a period. Admins only. */
export async function generateAnalysis(kind: RunKind, start: string, end: string): Promise<Result> {
  if (!["insights", "strategy"].includes(kind) || !iso.safeParse(start).success || !iso.safeParse(end).success) {
    return { ok: false, error: "Invalid request." };
  }
  const { user, client, canEdit } = await admin();
  if (!canEdit) return { ok: false, error: "Only owners and admins can run AI analysis." };
  const r = await runAnalysis(await createClient(), client.id, user.id, { start, end }, kind);
  revalidatePath("/insights"); revalidatePath("/strategy"); revalidatePath("/overview");
  if (!r.ok) return r;
  return {
    ok: true,
    message: `Done. ${r.kept} item(s) saved${r.dropped ? `, ${r.dropped} discarded for citing no valid evidence` : ""}.`,
  };
}

const insightStatus = z.enum(["proposed", "approved", "implemented", "dismissed"]);
export async function setInsightStatus(id: string, status: string): Promise<Result> {
  const p = z.object({ id: z.uuid(), status: insightStatus }).safeParse({ id, status });
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { client, canEdit } = await admin();
  if (!canEdit) return { ok: false, error: "Only owners and admins can change recommendations." };
  const { error } = await createAdminClient().from("analytics_insights")
    .update({ implementation_status: p.data.status, status_changed_at: new Date().toISOString() })
    .eq("id", p.data.id).eq("client_id", client.id);
  if (error) return { ok: false, error: "Could not update." };
  revalidatePath("/insights");
  return { ok: true, message: "Updated." };
}

const taskStatus = z.enum(["planned", "in_progress", "completed", "skipped"]);
export async function setTaskStatus(id: string, status: string): Promise<Result> {
  const p = z.object({ id: z.uuid(), status: taskStatus }).safeParse({ id, status });
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { client } = await admin(); // any member of the client may track progress
  const now = new Date().toISOString();
  const { error } = await createAdminClient().from("seo_strategy_tasks")
    .update({ status: p.data.status, status_changed_at: now, completed_at: p.data.status === "completed" ? now : null })
    .eq("id", p.data.id).eq("client_id", client.id);
  if (error) return { ok: false, error: "Could not update." };
  revalidatePath("/strategy");
  return { ok: true, message: "Updated." };
}
