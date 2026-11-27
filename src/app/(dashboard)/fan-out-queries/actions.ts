"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { budgetMessage, claudeBudget } from "@/lib/ai/usage";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError } from "@/lib/dataforseo/client";
import { resolveTarget } from "@/lib/dataforseo/research";
import { fanoutError, fanoutReady, runFanout } from "@/lib/fanout/run";
import { estimate, MAX_KEYWORDS, MAX_PAGES, parseKeywords, usd, type FanoutMode } from "@/lib/fanout/shared";
import { EST_PER_ASK, LIVE_PLATFORMS, MAX_LIVE_ASKS, MAX_LIVE_KEYWORDS, PLATFORM_LABEL, platformReady, runLive, savePasted } from "@/lib/fanout/live";
import { configForClient } from "@/lib/org/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownUrl } from "@/lib/toolkit/store";

type Result = { ok: true; message: string; runId: string } | { ok: false; error: string };

/** Owner/admin: fans out keywords (one or a pasted list) or pages of the client's site, and stores the run. */
export async function runFanoutAction(input: { kind: "keywords" | "pages"; items: string[]; mode: FanoutMode; volume: boolean }): Promise<Result> {
  const { user, client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run fan-out queries." };
  const kind = input.kind === "pages" ? "pages" : "keywords";
  const mode: FanoutMode = input.mode === "ai_overview" ? "ai_overview" : "ai_mode";
  const admin = createAdminClient();
  const target = await resolveTarget(admin, client.id);
  if (!target) return { ok: false, error: "Set the client's website first." };

  let items: string[];
  if (kind === "keywords") {
    items = parseKeywords((input.items ?? []).join("\n"));
    if (!items.length) return { ok: false, error: "Enter at least one keyword." };
    if (items.length > MAX_KEYWORDS) return { ok: false, error: `At most ${MAX_KEYWORDS} keywords per run (you entered ${items.length}).` };
  } else {
    const urls = (input.items ?? []).map((u) => ownUrl(String(u).slice(0, 500), target.domain));
    if (urls.some((u) => !u)) return { ok: false, error: `Only pages on ${target.domain} can be read.` };
    items = [...new Set(urls as string[])];
    if (!items.length) return { ok: false, error: "Pick at least one page." };
    if (items.length > MAX_PAGES) return { ok: false, error: `At most ${MAX_PAGES} pages per run.` };
  }

  if (!(await fanoutReady(admin))) return { ok: false, error: "Fan-out storage isn't set up yet (apply migration 20261128000034)." };
  const est = estimate(kind, items.length, mode, false);
  const b = await claudeBudget(admin, client.id);
  if (b.left <= 0) return { ok: false, error: budgetMessage(b.budget) };
  if (est.ai > b.left) return { ok: false, error: `This run needs about ${usd(est.ai)} of Claude budget, but only ${usd(b.left)} is left this month. Run fewer ${kind}.` };

  try {
    const r = await runFanout(admin, client.id, target, client.name, { kind, inputs: items, mode, withVolume: Boolean(input.volume), userId: user?.id ?? null });
    revalidatePath("/fan-out-queries");
    const parts = [`${r.queries} fan-out queries from ${items.length - r.failed} ${kind === "keywords" ? "keyword" : "page"}${items.length - r.failed === 1 ? "" : "s"}`, `AI ${usd(r.aiCost)}`];
    if (input.volume) parts.push(r.volumeNote ?? `volumes ${usd(r.volumeCost)}`);
    if (r.failed) parts.push(`${r.failed} failed (see the run)`);
    return { ok: true, message: `${parts.join(" · ")}.`, runId: r.runId };
  } catch (e) {
    if (e instanceof BudgetError || e instanceof DfsError) return { ok: false, error: e.message };
    return { ok: false, error: fanoutError(e) };
  }
}

/* ------------------------------------------------------------------ real AI search queries (added; the above is unchanged) */
type LiveResult = { ok: true; message: string; batchId: string } | { ok: false; error: string };

/** Owner/admin: asks the chosen AI platforms each keyword with web search on and stores the searches they ran. */
export async function runLiveFanoutAction(input: { keywords: string[]; platforms: string[]; runs: number }): Promise<LiveResult> {
  const { user, client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run fan-out queries." };
  const admin = createAdminClient();
  const target = await resolveTarget(admin, client.id);
  if (!target) return { ok: false, error: "Set the client's website first." };
  const keywords = parseKeywords((input.keywords ?? []).join("\n"));
  if (!keywords.length) return { ok: false, error: "Enter at least one keyword." };
  if (keywords.length > MAX_LIVE_KEYWORDS) return { ok: false, error: `At most ${MAX_LIVE_KEYWORDS} keywords per run.` };
  const platforms = LIVE_PLATFORMS.filter((p) => (input.platforms ?? []).includes(p));
  if (!platforms.length) return { ok: false, error: "Pick at least one platform." };
  const runs = Math.min(3, Math.max(1, Math.round(Number(input.runs) || 1)));
  if (keywords.length * platforms.length * runs > MAX_LIVE_ASKS) return { ok: false, error: `That's ${keywords.length * platforms.length * runs} questions; at most ${MAX_LIVE_ASKS} per run. Use fewer keywords, platforms or repeats.` };
  const ready = platformReady(await configForClient(client.id));
  const missing = platforms.filter((p) => !ready[p]);
  if (missing.length) return { ok: false, error: `Not set up for this organization: ${missing.map((p) => PLATFORM_LABEL[p]).join(", ")}. Add the API key in Settings → Organization → Integrations.` };
  if (platforms.includes("claude")) {
    const b = await claudeBudget(admin, client.id);
    const need = keywords.length * runs * EST_PER_ASK.claude;
    if (b.left <= 0) return { ok: false, error: budgetMessage(b.budget) };
    if (need > b.left) return { ok: false, error: `Claude needs about ${usd(need)} of the monthly budget, but only ${usd(b.left)} is left. Use fewer keywords or untick Claude.` };
  }
  try {
    const r = await runLive(admin, client.id, { keywords, platforms, runs, userId: user?.id ?? null, domain: target.domain });
    revalidatePath("/fan-out-queries");
    return { ok: true, batchId: r.batchId, message: `${r.queries} real search queries from ${r.asked - r.failed} of ${r.asked} answers · about ${usd(r.cost)}${r.failed ? ` · ${r.failed} failed (see below)` : ""}.` };
  } catch (e) {
    return { ok: false, error: fanoutError(e) };
  }
}

/** Owner/admin: stores the searches pasted from ChatGPT's network tab for a keyword (free, no API key). */
export async function importPastedFanoutAction(input: { keyword: string; text: string }): Promise<LiveResult> {
  const { user, client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can import fan-out queries." };
  const keyword = String(input.keyword ?? "").trim().slice(0, 200);
  const text = String(input.text ?? "");
  if (!keyword) return { ok: false, error: "Enter the keyword (the prompt you asked ChatGPT)." };
  if (!text.trim()) return { ok: false, error: "Paste the Response from ChatGPT's network tab." };
  if (text.length > 3_000_000) return { ok: false, error: "That's too much text: paste only the conversation request's Response." };
  const admin = createAdminClient();
  const target = await resolveTarget(admin, client.id);
  try {
    const r = await savePasted(admin, client.id, { keyword, text, userId: user?.id ?? null, domain: target?.domain ?? "" });
    revalidatePath("/fan-out-queries");
    return { ok: true, batchId: r.batchId, message: `${r.queries} ChatGPT search ${r.queries === 1 ? "query" : "queries"} imported for “${keyword}”.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't import." };
  }
}
