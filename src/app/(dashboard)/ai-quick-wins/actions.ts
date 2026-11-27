"use server";

import { after } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { revalidatePath } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { DFS_FEATURES, EFFORTS, MODELS, readSettings } from "@/lib/aiqw/settings";
import { SOURCES, type RunState, type Scope, type Source, type Status } from "@/lib/aiqw/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function admin_() {
  const { client, user } = await getSession();
  if (!client) return { error: "No client selected." } as const;
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can run or change quick wins." } as const;
  return { client, user } as const;
}

const scopeSchema = z.union([
  z.object({ kind: z.literal("site") }),
  z.object({ kind: z.literal("screen"), screen: z.string().min(1).max(60) }),
  z.object({ kind: z.literal("page"), url: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("item"), key: z.string().min(1).max(500) }),
]);

/**
 * Starts a run and returns its id at once. The run itself continues in the background (after the response), so it
 * keeps going if the user leaves the page; the page polls runStatus for the live steps.
 */
export async function startQuickWins(input: { scope: Scope; depth: "standard" | "deep"; sources: Source[] }): Promise<Result<{ runId: string }>> {
  const a = await admin_();
  if ("error" in a) return { ok: false, error: a.error! };
  const scope = scopeSchema.safeParse(input.scope);
  if (!scope.success) return { ok: false, error: "Unknown scope." };
  const sources = [...new Set(input.sources)].filter((s): s is Source => (SOURCES as string[]).includes(s));
  if (!sources.length) return { ok: false, error: "Pick at least one data source." };
  const { aiUnavailable } = await import("@/lib/ai/claude");
  const aiOff = await aiUnavailable(a.client.id);
  if (aiOff) return { ok: false, error: aiOff };
  const { newRun, executeRun } = await import("@/lib/aiqw/run");
  const { activeRun, listRuns, saveRun } = await import("@/lib/aiqw/store");
  const admin = createAdminClient();
  const running = activeRun(await listRuns(admin, a.client.id, 5));
  if (running) return { ok: true, runId: running.id };
  const run = newRun(a.client.id, { scope: scope.data, depth: input.depth === "deep" ? "deep" : "standard", sources, trigger: "manual", startedBy: a.user?.email ?? a.user?.id ?? null });
  await saveRun(admin, run);
  after(async () => { await executeRun(createAdminClient(), run); });
  return { ok: true, runId: run.id };
}

export async function runStatus(runId: string): Promise<RunState | null> {
  const { client } = await getSession();
  if (!client || !/^[a-z0-9]{10,30}$/.test(runId)) return null;
  const { loadRun } = await import("@/lib/aiqw/store");
  return loadRun(createAdminClient(), client.id, runId);
}

export async function setWinStatus(key: string, status: Status): Promise<Result> {
  const a = await admin_();
  if ("error" in a) return { ok: false, error: a.error! };
  if (!["todo", "doing", "done", "dismissed"].includes(status)) return { ok: false, error: "Unknown status." };
  const { loadItems, saveItems } = await import("@/lib/aiqw/store");
  const admin = createAdminClient();
  const items = await loadItems(admin, a.client.id);
  const w = items.find((x) => x.key === key);
  if (!w) return { ok: false, error: "That quick win is gone." };
  w.status = status; w.updated_at = new Date().toISOString();
  w.done_at = status === "done" ? (w.done_at ?? new Date().toISOString()) : null;
  if (status !== "done") w.result = null;
  await saveItems(admin, a.client.id, items);
  revalidatePath("/ai-quick-wins");
  return { ok: true };
}

export async function setWinOwner(key: string, owner: string): Promise<Result> {
  const a = await admin_();
  if ("error" in a) return { ok: false, error: a.error! };
  const { loadItems, saveItems } = await import("@/lib/aiqw/store");
  const admin = createAdminClient();
  const items = await loadItems(admin, a.client.id);
  const w = items.find((x) => x.key === key);
  if (!w) return { ok: false, error: "That quick win is gone." };
  w.owner = owner.trim().slice(0, 80) || null; w.updated_at = new Date().toISOString();
  await saveItems(admin, a.client.id, items);
  revalidatePath("/ai-quick-wins");
  return { ok: true };
}

const settingsSchema = z.object({
  model: z.enum(Object.keys(MODELS) as [keyof typeof MODELS, ...(keyof typeof MODELS)[]]),
  effort: z.enum(EFFORTS),
  monthlyBudget: z.number().min(0).max(1000),
  dfsMonthlyBudget: z.number().min(0).max(1000),
  nightly: z.boolean(),
  dfs: z.object(Object.fromEntries(Object.keys(DFS_FEATURES).map((k) => [k, z.boolean()])) as Record<keyof typeof DFS_FEATURES, z.ZodBoolean>),
  locationName: z.string().max(120),
  languageCode: z.string().max(10),
  bannedWords: z.array(z.string().max(40)).max(50),
  business: z.object({ name: z.string().max(120), services: z.string().max(1000), towns: z.string().max(500), phone: z.string().max(40), certifications: z.string().max(500), tone: z.string().max(300) }),
  emailTo: z.array(z.string().email()).max(10),
});

export async function saveAiSettings(input: z.input<typeof settingsSchema>): Promise<Result> {
  const a = await admin_();
  if ("error" in a) return { ok: false, error: a.error! };
  const p = settingsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: `Check the form: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}` };
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("settings").eq("id", a.client.id).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const { error } = await admin.from("clients").update({ settings: { ...settings, ai_qw: readSettings(p.data) } }).eq("id", a.client.id);
  if (error) return { ok: false, error: "Couldn't save the settings." };
  revalidatePath("/ai-quick-wins");
  return { ok: true };
}

export interface ConnTest { name: string; ok: boolean; detail: string }

/** Green/red for every data source and Claude (a tiny request that must answer "ok"). */
export async function testConnections(): Promise<Result<{ tests: ConnTest[] }>> {
  const a = await admin_();
  if ("error" in a) return { ok: false, error: a.error! };
  const admin = createAdminClient();
  const { sourceStatus } = await import("@/lib/aiqw/platforms");
  const { SOURCE_LABEL } = await import("@/lib/aiqw/types");
  const st = await sourceStatus(admin, a.client.id);
  const tests: ConnTest[] = SOURCES.map((s) => ({ name: SOURCE_LABEL[s], ok: st[s].ok, detail: st[s].note }));
  // DataForSEO: the account answers (balance call, free)
  try {
    const { DFS_NOT_CONFIGURED, dfsBalance, dfsConfigured } = await import("@/lib/dataforseo/client");
    if (!(await dfsConfigured(a.client.id))) tests.push({ name: "DataForSEO API", ok: false, detail: DFS_NOT_CONFIGURED });
    else { const b = await dfsBalance(a.client.id); tests.push({ name: "DataForSEO API", ok: b != null, detail: b != null ? `Login works · balance $${b.toFixed(2)}` : "No answer" }); }
  } catch (e) { tests.push({ name: "DataForSEO API", ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : "failed" }); }
  // Claude
  try {
    const { clientSettings } = await import("@/lib/aiqw/run");
    const { pingClaude } = await import("@/lib/aiqw/claude");
    const { anthropicFor } = await import("@/lib/ai/claude");
    const [{ settings }, ai] = await Promise.all([clientSettings(admin, a.client.id), anthropicFor(a.client.id)]);
    const t0 = Date.now();
    const text = await pingClaude(ai, settings);
    tests.push({ name: `Claude API (${settings.model})`, ok: /\bok\b/i.test(text), detail: `Answered "${text.slice(0, 20)}" in ${((Date.now() - t0) / 1000).toFixed(1)} s` });
  } catch (e) {
    const { aiErrorMessage } = await import("@/lib/ai/claude");
    tests.push({ name: "Claude API", ok: false, detail: aiErrorMessage(e) });
  }
  return { ok: true, tests };
}

/** Keywords screen: DataForSEO volume, difficulty, intent and SERP features for the top Search Console queries. */
export async function fetchKeywordData(): Promise<Result<{ message: string }>> {
  const a = await admin_();
  if ("error" in a) return { ok: false, error: a.error! };
  const admin = createAdminClient();
  const { clientSettings } = await import("@/lib/aiqw/run");
  const { dfsMonthSpend, refreshKw } = await import("@/lib/aiqw/dfs");
  const { gscWinsFor } = await import("@/lib/gscx/load");
  const { settings } = await clientSettings(admin, a.client.id);
  if (!settings.dfs.volume) return { ok: false, error: "Search volume is switched off in AI quick wins → Settings." };
  const spent = await dfsMonthSpend(admin, a.client.id, true);
  if (spent >= settings.dfsMonthlyBudget) return { ok: false, error: `DataForSEO monthly budget used ($${spent.toFixed(2)} of $${settings.dfsMonthlyBudget}).` };
  const gsc = await gscWinsFor(admin, a.client.id);
  if (!gsc) return { ok: false, error: "Connect Search Console first." };
  const top = [...gsc.g.queries()].sort((x, y) => y[1].impressions - x[1].impressions).slice(0, 300).map(([q]) => q);
  try {
    const r = await refreshKw(admin, a.client.id, settings, top);
    revalidatePath("/ai-quick-wins/keywords");
    return { ok: true, message: r.fetched ? `DataForSEO data for ${r.fetched} keywords ($${r.cost.toFixed(3)}).` : "Everything is already fresh (less than 24 hours old)." };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "DataForSEO failed." }; }
}

/** Settings → Import data: re-sync Search Console and GA4 now (the next quick-wins run uses the fresh data). */
export async function importAllData(): Promise<Result<{ message: string }>> {
  const a = await admin_();
  if ("error" in a) return { ok: false, error: a.error! };
  const admin = createAdminClient();
  const { gscxTarget, syncGscx } = await import("@/lib/gscx/sync");
  const { ga4xTarget, syncGa4x } = await import("@/lib/ga4x/sync");
  const done: string[] = [];
  const [g, ga] = await Promise.all([gscxTarget(admin, a.client.id, null), ga4xTarget(admin, a.client.id, null)]);
  await Promise.all([
    g?.ctx ? syncGscx(admin, a.client.id, g.resource.id).then(() => done.push("Search Console"), () => undefined) : null,
    ga?.ctx ? syncGa4x(admin, a.client.id, ga.resource.id).then(() => done.push("GA4"), () => undefined) : null,
  ]);
  // Bing, Clarity and Business Profile sync through the job queue (as the user, so the queue's access check applies)
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const queued: string[] = [];
  for (const [p, label] of [["bing", "Bing"], ["clarity", "Clarity"], ["gbp", "Business Profile"]] as const) {
    const { data, error } = await supabase.rpc("enqueue_sync_job", { p_client_id: a.client.id, p_provider: p, p_job_type: "manual" });
    if (!error && (data ?? 0) > 0) queued.push(label);
  }
  if (queued.length) done.push(`${queued.join(", ")} queued`);
  revalidatePath("/ai-quick-wins");
  return { ok: true, message: done.length ? `Re-synced: ${done.join(", ")}. Generate quick wins to use it.` : "Nothing to sync: no connected sources." };
}
