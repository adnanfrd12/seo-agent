import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AI_MODEL, aiErrorMessage, anthropic, costUsd } from "@/lib/ai/claude";
import { todayIn } from "@/lib/analytics/range";
import { brief, briefText } from "@/lib/ai/intelligence";
import { clientSettings } from "@/lib/aiqw/run";
import { claudeMonthSpend, recordAskCost } from "@/lib/aiqw/store";
import { ensureMonth, getTasks, logChange, type Actor } from "./store";
import { addMonths, CATEGORIES, CATEGORY_KEYS, dedupeKey, lastDayOf, monthLabel, type RoadmapTask } from "./types";

/**
 * Generates (or refreshes) one month of the SEO roadmap from the client's own data. Output is schema-validated;
 * tasks that cite no evidence the dashboard holds are dropped; completed, started and manually added tasks are
 * always kept, and nothing is added twice.
 */
const level = z.enum(["high", "medium", "low"]);
const schema = z.object({
  summary: z.string().describe("3-5 sentences: where the site stands and what this month focuses on, with the key numbers"),
  objectives: z.array(z.object({ title: z.string(), detail: z.string(), metric: z.string().nullable().describe("the measurable target, from the evidence") })),
  priorities: z.array(z.string()).describe("the 3-5 most important things this month, in order"),
  expected_outcomes: z.array(z.string()).describe("testable hypotheses, never guarantees"),
  tasks: z.array(z.object({
    category: z.enum(CATEGORY_KEYS),
    title: z.string(),
    description: z.string(),
    why: z.string().describe("why this matters for THIS site, quoting the numbers from the evidence"),
    evidence_references: z.array(z.string()).describe("evidence ids exactly as written"),
    steps: z.array(z.string()).describe("concrete step-by-step instructions"),
    urls: z.array(z.string()).describe("affected pages, only URLs that appear in the evidence"),
    keywords: z.array(z.string()).describe("target keywords, only from the evidence"),
    subtasks: z.array(z.string()).describe("a short checklist, empty when not useful"),
    priority: level,
    impact: level,
    effort: z.enum(["small", "medium", "large"]),
    due_date: z.string().describe("YYYY-MM-DD within the month"),
  })),
});
type Output = z.infer<typeof schema>;

const SYSTEM = `You are a senior SEO strategist building a client's monthly SEO roadmap inside their analytics dashboard.

Rules:
- Use ONLY the evidence provided. Never invent metrics, pages, keywords, competitors or outcomes. Every task must cite evidence ids exactly as written; copy numbers, do not recalculate.
- Make it personal to THIS site: a task that would fit any website is a failure. Cross-reference sources (e.g. falling Search Console clicks with GA4 engagement, Clarity friction, competitor gains, audit issues) when the evidence supports it.
- Small numbers are noise: say so rather than drawing conclusions from a handful of clicks.
- Estimates (DataForSEO, modelled traffic) must be described as estimates. Effects are hypotheses, never guarantees.
- Categories: ${CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ")}. Only use a category when the evidence gives a reason; social only when social data exists; ai_visibility only with AI visibility evidence.
- Prefer improving existing pages over new ones. Keep steps concrete (what to change, where, how to check it worked).
- Do not repeat tasks listed as already in the roadmap or already completed, unless the evidence shows the problem is back.`;

export type GenerateResult = { ok: true; month: string; added: number; kept: number; removed: number; dropped: number; cost: number } | { ok: false; error: string };

export async function generateMonth(admin: SupabaseClient, clientId: string, timezone: string, month: string, actor: Actor, opts: { focus?: string | null } = {}): Promise<GenerateResult> {
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { ok: false, error: "Invalid month." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "AI isn't configured (ANTHROPIC_API_KEY)." };

  // one generation per client and month at a time
  const lockKey = `roadmap_lock:${month}`;
  const { data: lock } = await admin.from("dfs_cache").select("fetched_at").eq("client_id", clientId).eq("endpoint", "roadmap_lock").eq("params_hash", lockKey).maybeSingle();
  if (lock && Date.now() - Date.parse(lock.fetched_at) < 8 * 60_000) return { ok: false, error: "This month's strategy is already being generated. It takes a minute or two." };
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: "roadmap_lock", params_hash: lockKey, params: {}, data: {}, row_count: 0, cost: 0, fetched_at: new Date().toISOString() }, { onConflict: "client_id,endpoint,params_hash" });
  const unlock = () => admin.from("dfs_cache").delete().eq("client_id", clientId).eq("endpoint", "roadmap_lock").eq("params_hash", lockKey);

  try {
    const { settings } = await clientSettings(admin, clientId);
    if ((await claudeMonthSpend(admin, clientId)) >= settings.monthlyBudget) return { ok: false, error: `The monthly Claude budget ($${settings.monthlyBudget}) is used up. Raise it in AI Quick Wins → Settings.` };

    const b = await brief(admin, clientId, timezone);
    if (b.items.length < 5) return { ok: false, error: "Not enough connected data yet. Connect and sync Search Console or Google Analytics first." };
    const m = await ensureMonth(admin, clientId, month, actor);
    const existing = await getTasks(admin, clientId, m.id);
    const { data: prevMonth } = await admin.from("roadmap_months").select("id").eq("client_id", clientId).eq("month", addMonths(month, -1)).maybeSingle();
    const prevTasks = prevMonth ? await getTasks(admin, clientId, prevMonth.id) : [];
    const focus = (opts.focus ?? m.focus ?? "").trim();

    // a month planned part-way through starts its due dates today, never in the past
    const today = todayIn(timezone), from = today > month && today <= lastDayOf(month) ? today : month;
    const context = [
      `MONTH: ${monthLabel(month)} (${month} to ${lastDayOf(month)}). Today is ${today}. Due dates must fall between ${from} and ${lastDayOf(month)}, most urgent first.`,
      focus ? `REQUESTED FOCUS: ${focus}` : "",
      existing.length ? `ALREADY IN THIS MONTH'S ROADMAP (keep, do not duplicate):\n${existing.map((t) => `- [${t.category}] ${t.title} (${t.status})`).join("\n")}` : "",
      prevTasks.length ? `LAST MONTH'S TASKS (build on them; unfinished ones may carry over if still relevant):\n${prevTasks.map((t) => `- [${t.category}] ${t.title} (${t.status})`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    const task = `Write this month's roadmap: a summary, 3-5 objectives with measurable metrics, 3-5 priorities, 3-5 expected outcomes, and 10-20 tasks spread over the categories the evidence supports (high-impact work first, a realistic amount for one month). Each task: category, title, description, why (with numbers), evidence ids, step-by-step instructions, affected URLs and keywords from the evidence, a short checklist where useful, priority, impact, effort and a due date this month.`;

    const res = await anthropic().beta.messages.parse({
      model: AI_MODEL, max_tokens: 20000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: SYSTEM, output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content: `${briefText(b)}\n\n${context}\n\nTASK:\n${task}` }],
    });
    const cost = Number(costUsd(res.usage).toFixed(4));
    await recordAskCost(admin, clientId, cost).catch(() => undefined);
    if (res.stop_reason === "refusal") return { ok: false, error: "The AI declined this request." };
    if (res.stop_reason === "max_tokens") return { ok: false, error: "The strategy was too long and got cut off. Try again." };
    const out = res.parsed_output as Output | null;
    if (!out) return { ok: false, error: "The AI answer didn't match the expected structure. Try again." };

    const byId = new Map(b.items.map((i) => [i.id, i]));
    let dropped = 0;
    const grounded = out.tasks.flatMap((t) => {
      const refs = t.evidence_references.filter((r) => byId.has(r));
      if (!refs.length) { dropped++; return []; }
      return [{ ...t, refs }];
    });

    // refresh: open, untouched AI tasks are replaced; completed, started, manual and Nova tasks stay
    const replaceable = existing.filter((t) => t.source === "ai" && t.status === "todo" && !t.subtasks.some((s) => s.done));
    const kept = existing.filter((t) => !replaceable.includes(t));
    const keptKeys = new Set(kept.map((t) => dedupeKey(t.category, t.title)));
    if (replaceable.length) await admin.from("roadmap_tasks").delete().in("id", replaceable.map((t) => t.id)).eq("client_id", clientId);

    const inMonth = (d: string) => (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > lastDayOf(month) ? lastDayOf(month) : d < from ? from : d);
    const seen = new Set(keptKeys);
    const rows = grounded.flatMap((t, i) => {
      const key = dedupeKey(t.category, t.title);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        client_id: clientId, month_id: m.id, category: t.category, title: t.title.slice(0, 300), description: t.description, why: t.why,
        evidence: t.refs.map((r) => { const e = byId.get(r)!; return { ref: r, source: e.source, label: e.label, value: e.value }; }),
        steps: t.steps.slice(0, 15), urls: t.urls.slice(0, 15), keywords: t.keywords.slice(0, 20),
        subtasks: t.subtasks.slice(0, 20).map((s, j) => ({ id: `${i}-${j}-${Math.random().toString(36).slice(2, 7)}`, text: s, done: false })),
        priority: t.priority, impact: t.impact, effort: t.effort, due_date: inMonth(t.due_date), source: "ai", dedupe_key: key, sort: i,
        created_by: actor.userId, updated_by: null,
      }];
    });
    if (rows.length) {
      const { error } = await admin.from("roadmap_tasks").insert(rows);
      if (error) return { ok: false, error: "Could not save the roadmap tasks." };
    }
    const after = {
      summary: out.summary, objectives: out.objectives.slice(0, 6), priorities: out.priorities.slice(0, 6), expected_outcomes: out.expected_outcomes.slice(0, 6),
      focus: focus || null, sources: b.connected, generated_by: actor.kind === "schedule" ? "schedule" : actor.kind === "nova" ? "nova" : "ai",
      model: AI_MODEL, cost_usd: cost, generated_at: new Date().toISOString(),
    };
    await admin.from("roadmap_months").update(after).eq("id", m.id);
    await logChange(admin, clientId, actor, {
      action: "month.generate", monthId: m.id,
      summary: `${existing.length ? "Refreshed" : "Generated"} the ${monthLabel(month)} strategy: ${rows.length} tasks added, ${kept.length} kept, ${replaceable.length} open AI tasks replaced`,
      before: { summary: m.summary, objectives: m.objectives, replaced: replaceable.map((t: RoadmapTask) => t.title) }, after: { ...after, tasks: rows.map((r) => r.title) },
    });
    return { ok: true, month, added: rows.length, kept: kept.length, removed: replaceable.length, dropped, cost };
  } catch (e) {
    return { ok: false, error: aiErrorMessage(e) };
  } finally {
    await unlock();
  }
}
