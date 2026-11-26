"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGscx } from "@/lib/gscx/sync";
import { aiErrorMessage } from "@/lib/ai/claude";
import { budgetMessage, claudeBudget, recordClaudeUse } from "@/lib/ai/usage";
import { diagnosePage, INDEX_AI_ENDPOINT, saveDiagnosis, type IndexDiagnosis } from "@/lib/gscx/indexing-ai";

type Result = { ok: boolean; message: string };
async function owner() {
  const { client } = await getSession();
  return client && ["owner", "admin"].includes(client.role) ? client : null;
}

/** Reads Search Console again now (performance, sitemaps, crawl and a round of URL inspections). */
export async function syncGscxNow(): Promise<Result> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can sync." };
  try {
    const meta = await syncGscx(createAdminClient(), c.id, null, { inspectBudget: 60 });
    revalidatePath("/search-console", "layout");
    if (!meta) return { ok: false, message: "Search Console isn't connected for this client." };
    const failed = Object.keys(meta.errors);
    return { ok: true, message: failed.length ? `Synced. ${failed.length} report(s) failed: ${failed.join(", ")}.` : "Synced just now." };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : "Search Console couldn't be read.").slice(0, 200) };
  }
}

/** Brand terms, competitors, cities and services (one per line each); an empty list goes back to automatic. */
export async function saveGscSettings(input: { brand: string; competitors: string; cities: string; services: string }): Promise<Result> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can change settings." };
  const list = (t: string) => [...new Set(t.split(/[\n,]/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("settings").eq("id", c.id).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  await admin.from("clients").update({ settings: { ...settings, gsc_settings: { brand: list(input.brand), competitors: list(input.competitors), cities: list(input.cities), services: list(input.services) } } }).eq("id", c.id);
  revalidatePath("/search-console", "layout");
  return { ok: true, message: "Saved. Every Search Console screen now uses these lists." };
}

export type DiagnoseResult = { ok: boolean; message: string; diagnosis?: IndexDiagnosis; stop?: boolean };
/**
 * Claude's likely reason and fix for one page Google hasn't indexed (owners and admins). A stored diagnosis is
 * returned without a new call unless `again` is set. Checks the monthly Claude budget first and logs the cost after.
 */
export async function diagnoseIndexPage(url: string, again = false): Promise<DiagnoseResult> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can run a diagnosis.", stop: true };
  if (typeof url !== "string" || !/^https?:\/\//.test(url) || url.length > 2000) return { ok: false, message: "Not a page URL." };
  const admin = createAdminClient();
  if (!again) {
    const { data } = await admin.from("dfs_cache").select("data").eq("client_id", c.id).eq("endpoint", INDEX_AI_ENDPOINT).eq("params_hash", url).maybeSingle();
    if (data?.data) return { ok: true, message: "Already diagnosed.", diagnosis: data.data as IndexDiagnosis };
  }
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Claude isn't set up (ANTHROPIC_API_KEY is missing).", stop: true };
  const b = await claudeBudget(admin, c.id);
  if (b.left <= 0) return { ok: false, message: budgetMessage(b.budget), stop: true };
  try {
    // diagnosePage checks the URL is in this client's inventory and not indexed (no arbitrary fetches)
    const d = await diagnosePage(admin, c.id, url);
    await saveDiagnosis(admin, c.id, d);
    await recordClaudeUse(admin, c.id, "gsc_indexing", d.model, d.cost);
    return { ok: true, message: `Diagnosed ($${d.cost.toFixed(3)}).`, diagnosis: d };
  } catch (e) {
    const m = aiErrorMessage(e);
    // out of credit / bad key / budget: stop a batch instead of failing page after page
    return { ok: false, message: m, stop: /out of credit|credit balance|API key was rejected/i.test(m) };
  }
}
