import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateAnalysis, setInsightStatus, setTaskStatus } from "@/app/(dashboard)/ai-actions";
import { runCoach } from "@/app/(dashboard)/coach/actions";
import { AI_MODEL } from "@/lib/ai/claude";
import { COACH_MODEL, COACH_MODES, loadCoach, type CoachMode, type CoachOutput, type CoachResult } from "@/lib/ai/coach";
import type { EvidenceItem } from "@/lib/ai/evidence";
import { resolveRange } from "@/lib/analytics/range";
import { bullets, json, plural, read, ToolError, write, type NovaTool } from "../../kit";
import { ago, bulkMessage, clip, duration, eachInOrder, fitJson, median, round, usd } from "./util";

/**
 * AI SEO Insights and the 30-Day SEO Strategy (ai_analysis_runs, analytics_insights, seo_strategy_plans/tasks) and the
 * SEO Coach (stored answers in dfs_cache). Changes and generations go through the pages' own server actions.
 */

type Kind = "insights" | "strategy";
const LABEL: Record<Kind, string> = { insights: "AI SEO Insights", strategy: "30-Day SEO Strategy" };
const PATHS: Record<Kind, string> = { insights: "/insights", strategy: "/strategy" };
const INSIGHT_STATUSES = ["proposed", "approved", "implemented", "dismissed"] as const;
const TASK_STATUSES = ["planned", "in_progress", "completed", "skipped"] as const;
const WEEK_THEMES = ["Critical fixes & quick wins", "Keyword & content optimisation", "User experience & conversion", "Measurement, validation & next steps"];
const PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2 };
const COACH_TAB: Record<CoachMode, string> = { coach: "SEO Coach (where you stand, first five steps)", priorities: "First moves (the 1-2 things that drive the most traffic)", topics: "Content topics", competitors: "Competitor strategy" };
const modelName = (id: string) => id.replace(/^claude-(\w)/, (_, c: string) => `Claude ${c.toUpperCase()}`).replace(/-(\d)-(\d)$/, " $1.$2");

interface RunRow { id: string; kind: string; status: string; model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; error: string | null; created_at: string; finished_at: string | null; range_start: string | null; range_end: string | null }
interface InsightRow {
  id: string; run_id: string; category: string; title: string; summary: string; target_url: string | null; recommended_action: string; priority: string; confidence: string;
  estimated_effort: string; expected_impact_hypothesis: string; success_metric: string; implementation_status: string; evidence_references: string[];
  supporting_metrics: { ref: string; label: string; value: string }[]; status_changed_at: string | null; created_at: string;
}
interface TaskRow {
  id: string; plan_id: string; week: number; sort: number; title: string; category: string; priority: string; target_url: string | null; problem: string | null;
  evidence_references: string[]; description: string; steps: string[]; estimated_effort: string; success_metric: string; status: string; status_changed_at: string | null; completed_at: string | null;
}

const RUN_COLS = "id, kind, status, model, input_tokens, output_tokens, cost_usd, error, created_at, finished_at, range_start, range_end";
async function analysisRuns(admin: SupabaseClient, clientId: string, kind: Kind, limit = 8): Promise<RunRow[]> {
  const { data } = await admin.from("ai_analysis_runs").select(RUN_COLS).eq("client_id", clientId).eq("kind", kind).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as RunRow[];
}
/** A "running" row older than 10 minutes was cut off; the next generation marks it failed. */
const isRunning = (r: RunRow) => r.status === "running" && Date.now() - Date.parse(r.created_at) < 10 * 60_000;
const secondsOf = (r: RunRow) => (r.finished_at ? (Date.parse(r.finished_at) - Date.parse(r.created_at)) / 1000 : null);
const historyRow = (r: RunRow) => ({
  when: r.created_at, status: r.status === "running" && !isRunning(r) ? "stopped (timed out)" : r.status, period: `${r.range_start ?? "?"} → ${r.range_end ?? "?"}`,
  model: r.model, cost_usd: r.cost_usd != null ? round(Number(r.cost_usd), 3) : null, ...(r.error ? { error: clip(r.error, 160) } : {}),
});

/** Evidence items of the given runs, by run id and evidence id. */
async function evidenceOf(admin: SupabaseClient, clientId: string, runIds: string[]): Promise<Map<string, Map<string, EvidenceItem>>> {
  const out = new Map<string, Map<string, EvidenceItem>>();
  if (!runIds.length) return out;
  const { data } = await admin.from("ai_analysis_runs").select("id, evidence").eq("client_id", clientId).in("id", runIds);
  for (const r of data ?? []) out.set(r.id as string, new Map((((r.evidence ?? {}) as { items?: EvidenceItem[] }).items ?? []).map((i) => [i.id, i])));
  return out;
}
const citeAll = (refs: string[], ev: Map<string, EvidenceItem> | undefined) => refs.map((ref) => {
  const e = ev?.get(ref);
  return e ? `${ref} · ${e.source}: ${e.label} = ${e.value}${e.detail ? ` (${clip(e.detail, 120)})` : ""}` : ref;
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = { last_month: "month", last_7_days: "7", last_30_days: "30", last_90_days: "90" } as const;
/** The analysis period: a preset like the pages' range selector (default last calendar month) or custom dates. */
function periodOf(a: { period: keyof typeof PERIODS; start?: string; end?: string }, timezone: string) {
  if (a.start || a.end) {
    if (!a.start || !a.end) throw new ToolError("Give both start and end (YYYY-MM-DD), or a period.");
    for (const d of [a.start, a.end]) if (!z.iso.date().safeParse(d).success) throw new ToolError(`${d} isn't a real date (YYYY-MM-DD).`);
    if (a.start > a.end) throw new ToolError("start must be on or before end.");
    const r = resolveRange({ start: a.start, end: a.end }, timezone, 30);
    if (r.preset !== "custom") throw new ToolError("The period must start before today and span at most two years.");
    return { start: r.start, end: r.end };
  }
  const r = resolveRange({ range: PERIODS[a.period] }, timezone, 30);
  return { start: r.start, end: r.end };
}

/** What a new generation does to what the page shows now. */
async function replaces(admin: SupabaseClient, clientId: string, kind: Kind, latest: RunRow | undefined): Promise<string> {
  if (kind === "insights") {
    if (!latest) return "Creates the first AI SEO Insights for this client.";
    const { data } = await admin.from("analytics_insights").select("implementation_status").eq("client_id", clientId).eq("run_id", latest.id);
    const by = new Map<string, number>();
    for (const r of data ?? []) by.set(r.implementation_status as string, (by.get(r.implementation_status as string) ?? 0) + 1);
    const st = [...by].map(([s, n]) => `${n} ${s}`).join(", ");
    return `The Insights page then shows the new recommendations instead of the current ${plural(data?.length ?? 0, "recommendation")}${st ? ` (${st})` : ""}; those stay in the history with their statuses, and the new analysis is told about them so it doesn't repeat them.`;
  }
  const { data: plan } = await admin.from("seo_strategy_plans").select("id, period_start, period_end").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!plan) return "Creates the first 30-day plan for this client.";
  const { data: tasks } = await admin.from("seo_strategy_tasks").select("status").eq("client_id", clientId).eq("plan_id", plan.id);
  const done = (tasks ?? []).filter((t) => t.status === "completed").length;
  return `A new plan replaces the current one on the 30-Day Strategy page (${plan.period_start} → ${plan.period_end}: ${plural(tasks?.length ?? 0, "task")}, ${done} completed); the old plan and its task statuses stay in the database but are no longer shown.`;
}

/** The coach answer's main list, which is shortened first when an answer is too long to return whole. */
const COACH_LIST: Record<CoachMode, string> = { coach: "steps", priorities: "actions", topics: "topics", competitors: "plays" };
function coachSummary(r: CoachResult) {
  const o = r.output as Record<string, unknown>;
  const text = String(o.where_you_stand ?? o.summary ?? "");
  const n = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0);
  const counts = r.mode === "coach" ? `${n("steps")} steps` : r.mode === "priorities" ? `${n("actions")} actions` : r.mode === "topics" ? `${n("topics")} topics` : `${n("competitors")} competitors, ${n("plays")} plays`;
  return { summary: clip(text, 400), contains: counts };
}

export const tools: NovaTool[] = [
  read({
    name: "get_ai_insights",
    description: "AI SEO Insights (latest analysis): executive summary, improvements, declines and the recommendations with ids, priority and status. Pass ids for full details with evidence.",
    schema: z.object({
      status: z.enum(["all", "open", ...INSIGHT_STATUSES]).default("all").describe("open = not implemented or dismissed"),
      ids: z.array(z.uuid()).min(1).max(8).optional(),
    }),
    async run(ctx, a) {
      const id = ctx.client.id, ids = a.ids;
      if (ids?.length) {
        const { data } = await ctx.admin.from("analytics_insights").select("*").eq("client_id", id).in("id", ids);
        const rows = (data ?? []) as InsightRow[];
        if (!rows.length) throw new ToolError("No recommendation with those ids for this client. Read get_ai_insights first.");
        const ev = await evidenceOf(ctx.admin, id, [...new Set(rows.map((r) => r.run_id))]);
        const fullRow = (r: InsightRow) => ({
          id: r.id, title: r.title, category: r.category, priority: r.priority, confidence: r.confidence, effort: r.estimated_effort, status: r.implementation_status,
          status_changed: r.status_changed_at?.slice(0, 10) ?? null, target_url: r.target_url, summary: r.summary, recommended_action: r.recommended_action,
          hypothesis: r.expected_impact_hypothesis, success_metric: r.success_metric, supporting_metrics: (r.supporting_metrics ?? []).map((m) => `${m.label}: ${m.value}`),
          evidence: citeAll(r.evidence_references ?? [], ev.get(r.run_id)), created: r.created_at.slice(0, 10),
        });
        const missing = ids.filter((x) => !rows.some((r) => r.id === x));
        return fitJson(rows.length, (n) => ({ recommendations: rows.slice(0, n).map(fullRow), ...(missing.length ? { not_found: missing } : {}), ...(n < rows.length ? { not_shown: rows.slice(n).map((r) => r.id) } : {}) }));
      }
      const runs = await analysisRuns(ctx.admin, id, "insights");
      const latest = runs.find((r) => r.status === "succeeded"), running = runs.find(isRunning);
      const history = runs.slice(0, 5).map(historyRow);
      if (!latest) return json({ latest: null, generating_now: Boolean(running), history, note: "No AI insights yet. generate_ai_insights_or_strategy creates them." });
      const [{ data: run }, { data: recs }] = await Promise.all([
        ctx.admin.from("ai_analysis_runs").select("output").eq("client_id", id).eq("id", latest.id).maybeSingle(),
        ctx.admin.from("analytics_insights").select("id, title, category, priority, confidence, estimated_effort, implementation_status, target_url, recommended_action").eq("client_id", id).eq("run_id", latest.id),
      ]);
      const o = (run?.output ?? {}) as { executive_summary?: string; significant_improvements?: { statement: string }[]; significant_declines?: { statement: string }[]; insufficient_evidence?: string[]; dropped?: number };
      const all = ((recs ?? []) as InsightRow[]).sort((x, y) => (PRIORITY[x.priority] ?? 3) - (PRIORITY[y.priority] ?? 3) || x.title.localeCompare(y.title));
      const open = (r: InsightRow) => !["implemented", "dismissed"].includes(r.implementation_status);
      const list = all.filter((r) => a.status === "all" || (a.status === "open" ? open(r) : r.implementation_status === a.status));
      const head = {
        latest: {
          run_id: latest.id, generated: latest.created_at, period: `${latest.range_start} → ${latest.range_end}`, model: latest.model, cost_usd: latest.cost_usd != null ? round(Number(latest.cost_usd), 3) : null,
          executive_summary: clip(o.executive_summary, 1500), improvements: (o.significant_improvements ?? []).map((x) => clip(x.statement, 240)),
          declines: (o.significant_declines ?? []).map((x) => clip(x.statement, 240)), insufficient_evidence: (o.insufficient_evidence ?? []).map((x) => clip(x, 200)),
          dropped_for_no_evidence: o.dropped ?? 0,
        },
        generating_now: Boolean(running),
        progress: Object.fromEntries(INSIGHT_STATUSES.map((s) => [s, all.filter((r) => r.implementation_status === s).length])),
        matching: list.length,
      };
      return fitJson(list.length, (n) => ({
        ...head, shown: n,
        recommendations: list.slice(0, n).map((r) => ({ id: r.id, title: r.title, category: r.category, priority: r.priority, confidence: r.confidence, effort: r.estimated_effort, status: r.implementation_status, target_url: r.target_url, action: clip(r.recommended_action, 160) })),
        history,
      }));
    },
    summary: (a) => (a.ids?.length ? "Read AI insight details" : "Read AI SEO insights"),
  }),

  read({
    name: "get_30_day_strategy",
    description: "The latest 30-Day SEO Strategy (a week-by-week plan, separate from the SEO roadmap): summary, period, progress and tasks with ids and statuses. Filter by week or status; pass task_ids for full details.",
    schema: z.object({
      week: z.number().int().min(1).max(4).optional(),
      status: z.enum(["all", "open", ...TASK_STATUSES]).default("all").describe("open = planned or in progress"),
      task_ids: z.array(z.uuid()).min(1).max(8).optional(),
    }),
    async run(ctx, a) {
      const id = ctx.client.id, taskIds = a.task_ids;
      if (taskIds?.length) {
        const { data } = await ctx.admin.from("seo_strategy_tasks").select("*").eq("client_id", id).in("id", taskIds);
        const rows = ((data ?? []) as TaskRow[]).sort((x, y) => x.week - y.week || x.sort - y.sort);
        if (!rows.length) throw new ToolError("No 30-day strategy task with those ids for this client. Read get_30_day_strategy first.");
        const { data: plans } = await ctx.admin.from("seo_strategy_plans").select("id, run_id").eq("client_id", id).in("id", [...new Set(rows.map((r) => r.plan_id))]);
        const runOf = new Map((plans ?? []).map((p) => [p.id as string, p.run_id as string | null]));
        const ev = await evidenceOf(ctx.admin, id, [...new Set((plans ?? []).map((p) => p.run_id as string | null).filter((x): x is string => Boolean(x)))]);
        const fullRow = (t: TaskRow) => ({
          id: t.id, week: t.week, title: t.title, category: t.category, priority: t.priority, effort: t.estimated_effort, status: t.status, target_url: t.target_url,
          problem: t.problem, description: t.description, steps: t.steps, success_metric: t.success_metric,
          evidence: (t.evidence_references ?? []).length ? citeAll(t.evidence_references, ev.get(runOf.get(t.plan_id) ?? "")) : "none cited (setup or measurement task)",
          completed_on: t.completed_at?.slice(0, 10) ?? null, status_changed: t.status_changed_at?.slice(0, 10) ?? null,
        });
        const missing = taskIds.filter((x) => !rows.some((r) => r.id === x));
        return fitJson(rows.length, (n) => ({ tasks: rows.slice(0, n).map(fullRow), ...(missing.length ? { not_found: missing } : {}), ...(n < rows.length ? { not_shown: rows.slice(n).map((r) => r.id) } : {}) }));
      }
      const [{ data: plan }, runs] = await Promise.all([
        ctx.admin.from("seo_strategy_plans").select("id, summary, period_start, period_end, created_at, run_id").eq("client_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        analysisRuns(ctx.admin, id, "strategy", 5),
      ]);
      const running = runs.find(isRunning);
      if (!plan) return json({ plan: null, generating_now: Boolean(running), history: runs.map(historyRow), note: "No 30-day strategy yet. generate_ai_insights_or_strategy (kind strategy) creates one." });
      const [{ data: tasks }, { data: run }] = await Promise.all([
        ctx.admin.from("seo_strategy_tasks").select("id, week, sort, title, category, priority, estimated_effort, status, target_url, completed_at").eq("client_id", id).eq("plan_id", plan.id).order("week").order("sort"),
        plan.run_id ? ctx.admin.from("ai_analysis_runs").select("output, cost_usd, model").eq("client_id", id).eq("id", plan.run_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const all = (tasks ?? []) as TaskRow[];
      const themes = new Map((((run?.output ?? {}) as { weeks?: { week: number; theme: string }[] }).weeks ?? []).map((w) => [w.week, w.theme]));
      const open = (t: TaskRow) => t.status === "planned" || t.status === "in_progress";
      const list = all.filter((t) => (!a.week || t.week === a.week) && (a.status === "all" || (a.status === "open" ? open(t) : t.status === a.status)));
      const head = {
        plan: {
          id: plan.id, period: `${plan.period_start} → ${plan.period_end}`, created: plan.created_at, summary: clip(plan.summary, 1500),
          weeks: [1, 2, 3, 4].map((w) => `W${w}: ${themes.get(w) ?? WEEK_THEMES[w - 1]}`),
          progress: { completed: all.filter((t) => t.status === "completed").length, total: all.length, ...Object.fromEntries(TASK_STATUSES.map((s) => [s, all.filter((t) => t.status === s).length])) },
          focus_week: [1, 2, 3, 4].find((w) => all.some((t) => t.week === w && open(t))) ?? null,
          ...(run ? { model: run.model, cost_usd: run.cost_usd != null ? round(Number(run.cost_usd), 3) : null } : {}),
        },
        generating_now: Boolean(running), matching: list.length,
      };
      return fitJson(list.length, (n) => ({
        ...head, shown: n,
        tasks: list.slice(0, n).map((t) => ({ id: t.id, week: t.week, title: t.title, category: t.category, priority: t.priority, effort: t.estimated_effort, status: t.status, target_url: t.target_url, ...(t.completed_at ? { completed_on: t.completed_at.slice(0, 10) } : {}) })),
      }));
    },
    summary: (a) => (a.task_ids?.length ? "Read 30-day strategy tasks" : "Read the 30-day strategy"),
  }),

  read({
    name: "get_seo_coach",
    description: "SEO Coach answers stored on the Coach page: coach (beginner plan), priorities (first moves), topics (content ideas), competitors (strategy). Without mode: when each was written and its summary; with mode: the full answer.",
    schema: z.object({ mode: z.enum(COACH_MODES).optional() }),
    async run(ctx, a) {
      const stored = await loadCoach(ctx.admin, ctx.client.id);
      if (!a.mode) {
        return json({
          answers: COACH_MODES.map((m) => {
            const r = stored[m];
            return r ? { mode: m, about: COACH_TAB[m], written: r.generatedAt, period: `${r.period.start} → ${r.period.end}`, cost_usd: r.cost, ...coachSummary(r) } : { mode: m, about: COACH_TAB[m], written: null };
          }),
          note: `run_seo_coach writes or refreshes them (${modelName(COACH_MODEL)}, about $0.15 each).`,
        });
      }
      const r = stored[a.mode];
      if (!r) return json({ mode: a.mode, about: COACH_TAB[a.mode], written: null, note: "Not generated yet. run_seo_coach writes it (about $0.15)." });
      const meta = { mode: r.mode, about: COACH_TAB[r.mode], written: r.generatedAt, period: `${r.period.start} → ${r.period.end}`, data_points: r.evidenceCount, model: r.model, cost_usd: r.cost };
      const out = r.output as CoachOutput<CoachMode> & Record<string, unknown>;
      const key = COACH_LIST[r.mode], list = Array.isArray(out[key]) ? (out[key] as unknown[]) : [];
      return fitJson(list.length, (n) => ({ ...meta, answer: { ...out, [key]: list.slice(0, n) }, ...(n < list.length ? { not_shown: `${list.length - n} more ${key} (see the Coach page)` } : {}) }));
    },
    summary: (a) => (a.mode ? `Read the SEO Coach ${a.mode} answer` : "Read the SEO Coach answers"),
  }),

  write({
    name: "generate_ai_insights_or_strategy",
    description: "Generate AI SEO Insights and/or the 30-Day SEO Strategy (not the SEO roadmap) for a period with Claude Opus 5.5 (paid, about 2 minutes). Default period: last calendar month, like the pages.",
    schema: z.object({
      kind: z.enum(["insights", "strategy", "both"]),
      period: z.enum(["last_month", "last_7_days", "last_30_days", "last_90_days"]).default("last_month"),
      start: z.string().regex(DAY_RE, "use YYYY-MM-DD").optional().describe("custom period start (YYYY-MM-DD), with end"),
      end: z.string().regex(DAY_RE, "use YYYY-MM-DD").optional(),
    }),
    async prepare(ctx, a) {
      if (!process.env.ANTHROPIC_API_KEY?.trim()) return { error: "AI isn't configured on the server (ANTHROPIC_API_KEY)." };
      const p = periodOf(a, ctx.client.timezone);
      const kinds: Kind[] = a.kind === "both" ? ["insights", "strategy"] : [a.kind];
      const lines: string[] = [];
      let expect = 0;
      for (const k of kinds) {
        const runs = await analysisRuns(ctx.admin, ctx.client.id, k);
        const running = runs.find(isRunning);
        if (running) return { error: `${LABEL[k]} is already being generated (started ${ago(running.created_at)}). Wait for it to finish.` };
        const done = runs.filter((r) => r.status === "succeeded" && r.cost_usd != null).slice(0, 5);
        const costs = done.map((r) => Number(r.cost_usd));
        const secs = median(done.map(secondsOf).filter((s): s is number => s != null)) ?? 120;
        expect = Math.max(expect, secs);
        // no budget check in this run; the cost comes from this client's earlier runs (up to 16,000 output tokens otherwise)
        const cost = costs.length > 1 ? `about ${usd(median(costs)!)} (recent runs here: ${usd(Math.min(...costs))}–${usd(Math.max(...costs))})`
          : costs.length ? `about ${usd(costs[0])} (the last run here)` : "usually $0.25–0.50";
        lines.push(`${LABEL[k]}: ${modelName(AI_MODEL)} at high effort, ${cost}, ${duration(secs)}`);
        lines.push(await replaces(ctx.admin, ctx.client.id, k, runs.find((r) => r.status === "succeeded")));
      }
      lines.push("Uses the stored data for the period (nothing is fetched or synced). The card shows progress while it runs.");
      return {
        title: `Generate ${kinds.map((k) => LABEL[k]).join(" and ")} for ${p.start} → ${p.end}`,
        detail: bullets(lines),
        input: { kind: a.kind, period: a.period, start: p.start, end: p.end },
        expectSeconds: Math.round(expect),
      };
    },
    async execute(x, a) {
      const p = periodOf(a, x.client.timezone);
      const kinds: Kind[] = a.kind === "both" ? ["insights", "strategy"] : [a.kind];
      // two kinds run side by side (one generation per kind at a time)
      const results = await Promise.all(kinds.map((k) => generateAnalysis(k, p.start, p.end)));
      const parts = results.map((r, i) => `${LABEL[kinds[i]]} (${p.start} → ${p.end}): ${r.ok ? r.message : `failed: ${r.error}`}`);
      return { ok: results.some((r) => r.ok), message: parts.join(" "), paths: [...kinds.map((k) => PATHS[k]), "/overview"] };
    },
  }),

  write({
    name: "run_seo_coach",
    description: "Write SEO Coach answers from the site's stored data with Claude Sonnet 5.5 (about $0.15 each, up to a minute; several run at once): coach, priorities, topics, competitors. Replaces the stored answer.",
    schema: z.object({ modes: z.array(z.enum(COACH_MODES)).min(1).max(4) }),
    async prepare(ctx, a) {
      if (!process.env.ANTHROPIC_API_KEY?.trim()) return { error: "AI isn't configured on the server (ANTHROPIC_API_KEY)." };
      const modes = [...new Set(a.modes)];
      const stored = await loadCoach(ctx.admin, ctx.client.id);
      const each = median(Object.values(stored).filter((r): r is CoachResult => Boolean(r)).map((r) => r.cost)) ?? 0.15;
      const lines = modes.map((m) => { const r = stored[m]; return `${COACH_TAB[m]}: ${r ? `replaces the answer written ${ago(r.generatedAt)} (the old one isn't kept)` : "first answer"}`; });
      lines.push(`${modelName(COACH_MODEL)}: about ${usd(each)} each${modes.length > 1 ? `, about ${usd(each * modes.length)} in total; they run at the same time` : ""}, up to a minute`);
      lines.push("Uses the last 28 days of stored data (nothing is fetched).");
      return {
        title: modes.length === 1 ? `Write the SEO Coach answer: ${COACH_TAB[modes[0]].replace(/ \(.*\)$/, "")}` : `Write ${modes.length} SEO Coach answers`,
        detail: bullets(lines), input: { modes }, expectSeconds: modes.length > 1 ? 60 : 45,
      };
    },
    async execute(x, a) {
      const modes = [...new Set(a.modes)];
      // the user confirmed, so an answer written in the last 12 hours is replaced too (force)
      const results = await Promise.all(modes.map((m) => runCoach(m, true)));
      const parts = results.map((r, i) => `${COACH_TAB[modes[i]].replace(/ \(.*\)$/, "")}: ${r.ok ? r.message : `failed: ${r.error}`}`);
      return { ok: results.some((r) => r.ok), message: parts.join(" "), paths: ["/coach"] };
    },
  }),

  write({
    name: "set_ai_insight_status",
    description: "Set the status of AI SEO Insights recommendations by id: proposed, approved, implemented (done) or dismissed.",
    schema: z.object({ ids: z.array(z.uuid()).min(1).max(30), status: z.enum(INSIGHT_STATUSES) }),
    async prepare(ctx, a) {
      const ids = [...new Set(a.ids)];
      const { data } = await ctx.admin.from("analytics_insights").select("id, title, implementation_status").eq("client_id", ctx.client.id).in("id", ids);
      const rows = (data ?? []) as Pick<InsightRow, "id" | "title" | "implementation_status">[];
      const missing = ids.filter((x) => !rows.some((r) => r.id === x));
      if (missing.length) return { error: `${plural(missing.length, "recommendation")} not found for this client: ${missing.slice(0, 5).join(", ")}. Read get_ai_insights for the ids.` };
      const change = rows.filter((r) => r.implementation_status !== a.status);
      if (!change.length) return { error: `Nothing to change: ${rows.length === 1 ? "it is" : "they are"} already ${a.status}.` };
      return {
        title: change.length === 1 ? `Mark the recommendation "${clip(change[0].title, 70)}" ${a.status}` : `Mark ${change.length} AI insight recommendations ${a.status}`,
        detail: bullets(change.map((r) => `${clip(r.title, 100)}: ${r.implementation_status} → ${a.status}`)),
        input: { ids: change.map((r) => r.id), status: a.status },
        ...(change.length > 25 ? { expectSeconds: Math.ceil(change.length * 0.4) } : {}),
      };
    },
    async execute(x, a) {
      const r = await eachInOrder(a.ids, async (id) => { const s = await setInsightStatus(id, a.status); return s.ok ? null : `${id}: ${s.error}`; });
      return { ...bulkMessage(r.done, a.ids.length, (n) => `Marked ${plural(n, "recommendation")} ${a.status}`, r.failed), paths: ["/insights"] };
    },
  }),

  write({
    name: "set_30_day_strategy_task_status",
    description: "Set the status of 30-Day SEO Strategy tasks by id: planned, in_progress, completed or skipped. Viewers may do this too.",
    roles: ["owner", "admin", "viewer"],
    schema: z.object({ task_ids: z.array(z.uuid()).min(1).max(40), status: z.enum(TASK_STATUSES) }),
    async prepare(ctx, a) {
      const ids = [...new Set(a.task_ids)];
      const { data } = await ctx.admin.from("seo_strategy_tasks").select("id, title, week, status").eq("client_id", ctx.client.id).in("id", ids);
      const rows = (data ?? []) as Pick<TaskRow, "id" | "title" | "week" | "status">[];
      const missing = ids.filter((x) => !rows.some((r) => r.id === x));
      if (missing.length) return { error: `${plural(missing.length, "task")} not found for this client: ${missing.slice(0, 5).join(", ")}. Read get_30_day_strategy for the ids.` };
      const change = rows.filter((r) => r.status !== a.status).sort((x, y) => x.week - y.week);
      if (!change.length) return { error: `Nothing to change: ${rows.length === 1 ? "it is" : "they are"} already ${a.status.replace("_", " ")}.` };
      const label = a.status.replace("_", " ");
      return {
        title: change.length === 1 ? `Mark the 30-day strategy task "${clip(change[0].title, 70)}" ${label}` : `Mark ${change.length} 30-day strategy tasks ${label}`,
        detail: bullets(change.map((r) => `W${r.week} ${clip(r.title, 100)}: ${r.status.replace("_", " ")} → ${label}`)),
        input: { task_ids: change.map((r) => r.id), status: a.status },
        ...(change.length > 25 ? { expectSeconds: Math.ceil(change.length * 0.4) } : {}),
      };
    },
    async execute(x, a) {
      const r = await eachInOrder(a.task_ids, async (id) => { const s = await setTaskStatus(id, a.status); return s.ok ? null : `${id}: ${s.error}`; });
      return { ...bulkMessage(r.done, a.task_ids.length, (n) => `Marked ${plural(n, "task")} ${a.status.replace("_", " ")}`, r.failed), paths: ["/strategy"] };
    },
  }),
];
