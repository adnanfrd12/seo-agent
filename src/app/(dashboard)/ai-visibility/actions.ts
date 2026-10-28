"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/analytics/client-context";
import { MAX_PROMPTS, PROMPT_EST, runAiChecks } from "@/lib/ai/visibility";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function guard() {
  const { client } = await getSession();
  if (!client) return { error: "No client selected." } as const;
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can change AI visibility settings." } as const;
  return { client, db: createAdminClient() } as const;
}

/** Adds questions customers might ask an AI assistant (one per line). */
export async function addAiPrompts(input: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const list = [...new Set(input.split(/\n+/).map((p) => p.trim().replace(/\s+/g, " ")).filter((p) => p.length >= 8 && p.length <= 300))];
  if (!list.length) return { ok: false, error: "Enter at least one question of 8 or more characters, one per line." };
  const { count, error: cErr } = await g.db.from("ai_prompts").select("id", { count: "exact", head: true }).eq("client_id", g.client.id);
  if (cErr) return { ok: false, error: "AI visibility isn't set up yet: apply the latest database migration (20261030000020)." };
  const room = MAX_PROMPTS - (count ?? 0);
  if (room <= 0) return { ok: false, error: `You can track up to ${MAX_PROMPTS} questions. Remove some first.` };
  const rows = list.slice(0, room).map((prompt) => ({ client_id: g.client.id, prompt }));
  const { error } = await g.db.from("ai_prompts").upsert(rows, { onConflict: "client_id,prompt", ignoreDuplicates: true });
  if (error) return { ok: false, error: "Could not save the questions." };
  revalidatePath("/ai-visibility");
  return { ok: true, message: `Added ${rows.length} question${rows.length > 1 ? "s" : ""}. Use "Check now" to run them (about $${(rows.length * PROMPT_EST).toFixed(2)}).` };
}

export async function removeAiPrompt(id: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const { error } = await g.db.from("ai_prompts").delete().eq("id", id).eq("client_id", g.client.id);
  if (error) return { ok: false, error: "Could not remove the question." };
  revalidatePath("/ai-visibility");
  return { ok: true, message: "Removed." };
}

/** Whether checks use live web search (more realistic, about 5 cents a question) or Claude's own knowledge (under 1 cent). */
export async function setAiSearch(on: boolean): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const { data } = await g.db.from("clients").select("settings").eq("id", g.client.id).maybeSingle();
  const { error } = await g.db.from("clients").update({ settings: { ...((data?.settings as Record<string, unknown>) ?? {}), ai_search: on } }).eq("id", g.client.id);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath("/ai-visibility");
  return { ok: true, message: on ? "Live web search is on." : "Live web search is off (cheaper, uses Claude's own knowledge)." };
}

export async function runAiVisibilityNow(force: boolean): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY isn't set on the server." };
  const target = await resolveTarget(g.db, g.client.id);
  if (!target) return { ok: false, error: "Set the client's website first (connect Search Console, Bing or Business Profile)." };
  const { data } = await g.db.from("clients").select("settings").eq("id", g.client.id).maybeSingle();
  const search = (data?.settings as { ai_search?: boolean } | null)?.ai_search !== false;
  const r = await runAiChecks(g.db, g.client.id, target.domain, { force, search, deadline: Date.now() + 50_000 });
  revalidatePath("/ai-visibility");
  if (r.checked === 0 && r.errors.length) return { ok: false, error: r.errors[0] };
  const bits = [r.checked ? `Checked ${r.checked} question${r.checked > 1 ? "s" : ""} ($${r.cost.toFixed(2)})` : "Nothing needed checking", r.skipped ? `${r.skipped} already checked this week` : "", r.stopped === "time" ? "ran out of time; press again to continue" : ""].filter(Boolean);
  return { ok: true, message: `${bits.join(". ")}.` };
}
