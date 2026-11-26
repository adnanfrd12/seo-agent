"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { budgetMessage, claudeBudget } from "@/lib/ai/usage";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError } from "@/lib/dataforseo/client";
import { resolveTarget } from "@/lib/dataforseo/research";
import { fanoutError, fanoutReady, runFanout } from "@/lib/fanout/run";
import { estimate, MAX_KEYWORDS, MAX_PAGES, parseKeywords, usd, type FanoutMode } from "@/lib/fanout/shared";
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
