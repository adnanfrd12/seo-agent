import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadReportData } from "@/lib/report/data";
import { AI_MODEL, aiErrorMessage, anthropic, costUsd } from "./claude";
import { buildEvidence, evidenceText } from "./evidence";
import { insightsSchema, strategySchema, type InsightsOutput, type StrategyOutput } from "./schemas";

export type RunKind = "insights" | "strategy";
export type RunResult = { ok: true; runId: string; kept: number; dropped: number } | { ok: false; error: string };

const SYSTEM = `You are a senior SEO and conversion analyst writing for a marketing agency's client report.

Rules you must follow:
- Use ONLY the evidence package provided. Never invent numbers, pages, queries, events, recordings or outcomes.
- Every claim and recommendation must cite evidence ids exactly as written in the package (the "evidence_references" field). Copy values from the evidence; do not recalculate metrics.
- Distinguish hypotheses from verified facts. Say "may", "suggests", "possible" for causes you cannot verify.
- Clicks on a call/website button are not calls or leads. Average position is an impression-weighted average, not a fixed rank. Possible cannibalization is not confirmed cannibalization.
- Never guarantee ranking, traffic or revenue results. expected_impact_hypothesis is a testable hypothesis.
- Session recordings were NOT watched by you. Only cite recording reviews as human observations.
- If evidence is thin for a question, put it under insufficient_evidence (or say so in the task problem) rather than guessing.
- Prefer improving existing pages over creating new ones unless no existing page fits the search intent.
- Data is small for many sites: low-volume changes (a handful of clicks) are noise; say so instead of drawing conclusions.`;

const TASK: Record<RunKind, string> = {
  insights: `Write the AI SEO insights for this period: an executive performance summary, significant improvements, significant declines, and 4-10 prioritised recommendations covering (where the evidence supports it) user experience problems, SEO growth opportunities, priority website changes, content opportunities and conversion optimisation.`,
  strategy: `Write a 30-day SEO strategy as exactly four weeks:
Week 1 - critical fixes and quick wins; Week 2 - keyword and on-page/content optimisation; Week 3 - user experience and conversion improvements; Week 4 - measurement, validation and next steps (including any missing tracking such as funnel key events).
Each week has 2-5 tasks. Each task: title, category, priority, target URL (or null), the problem identified, evidence ids, description, concrete implementation steps, estimated effort and the success metric that will show whether it worked.`,
};

/**
 * Generates insights or a strategy from stored data. Deterministic numbers in, interpretation out:
 * output is schema-validated, recommendations citing unknown evidence ids are discarded, and every
 * run records model, tokens and cost. One run per (client, kind) at a time.
 */
export async function runAnalysis(
  userClient: SupabaseClient, clientId: string, userId: string, range: { start: string; end: string }, kind: RunKind,
): Promise<RunResult> {
  const admin = createAdminClient();
  const data = await loadReportData(userClient, clientId, range, false); // RLS-checked read
  const evidence = await buildEvidence(admin, clientId, data);
  const known = new Set(evidence.items.map((i) => i.id));

  const { data: run, error: runErr } = await admin.from("ai_analysis_runs").insert({
    client_id: clientId, kind, status: "running", range_start: range.start, range_end: range.end,
    model: AI_MODEL, evidence, requested_by: userId,
  }).select("id").single();
  if (runErr) {
    return { ok: false, error: runErr.code === "23505" ? "An analysis of this kind is already running. Wait for it to finish." : "Could not start the analysis." };
  }
  const fail = async (error: string) => {
    await admin.from("ai_analysis_runs").update({ status: "failed", error, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { ok: false as const, error };
  };
  if (evidence.items.length < 5) return fail("Not enough connected data to analyse yet. Connect and sync GA4 or Search Console first.");

  try {
    const schema = (kind === "insights" ? insightsSchema : strategySchema) as z.ZodType<InsightsOutput | StrategyOutput>;
    const response = await anthropic().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      // on a safety decline the API retries on a fallback model automatically
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "high", format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content: `${evidenceText(evidence)}\n\nTASK:\n${TASK[kind]}` }],
    });
    const usage = response.usage;
    const tokens = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: costUsd(usage) };
    if (response.stop_reason === "refusal") return fail("The AI declined this request.");
    if (response.stop_reason === "max_tokens") return fail("The AI response was too long and got cut off. Try a shorter date range.");
    const out = response.parsed_output;
    if (!out) return fail("The AI response didn't match the expected structure.");

    const cite = (refs: string[]) => refs.filter((r) => known.has(r));
    let kept = 0, dropped = 0;

    if (kind === "insights") {
      const o = out as InsightsOutput;
      const rows = o.recommendations.flatMap((r) => {
        const refs = cite(r.evidence_references);
        if (refs.length === 0) { dropped++; return []; } // unsupported by evidence: discard
        kept++;
        return [{
          client_id: clientId, run_id: run.id, category: r.category, title: r.title, summary: r.summary,
          supporting_metrics: r.supporting_metrics.filter((m) => known.has(m.ref)), evidence_references: refs,
          target_url: r.target_url, recommended_action: r.recommended_action, priority: r.priority, confidence: r.confidence,
          estimated_effort: r.estimated_effort, expected_impact_hypothesis: r.expected_impact_hypothesis, success_metric: r.success_metric,
        }];
      });
      if (rows.length) {
        const { error } = await admin.from("analytics_insights").insert(rows);
        if (error) return fail("Could not save the insights.");
      }
      const clean = {
        ...o,
        significant_improvements: o.significant_improvements.map((x) => ({ ...x, evidence_references: cite(x.evidence_references) })).filter((x) => x.evidence_references.length),
        significant_declines: o.significant_declines.map((x) => ({ ...x, evidence_references: cite(x.evidence_references) })).filter((x) => x.evidence_references.length),
      };
      await admin.from("ai_analysis_runs").update({ status: "succeeded", output: { ...clean, dropped }, ...tokens, finished_at: new Date().toISOString() }).eq("id", run.id);
    } else {
      const o = out as StrategyOutput;
      const { data: plan, error: planErr } = await admin.from("seo_strategy_plans").insert({
        client_id: clientId, run_id: run.id, period_start: range.start, period_end: range.end, summary: o.summary,
      }).select("id").single();
      if (planErr) return fail("Could not save the strategy.");
      const tasks = o.weeks.filter((w) => w.week >= 1 && w.week <= 4).flatMap((w) => w.tasks.map((t, i) => {
        const refs = cite(t.evidence_references);
        if (refs.length) kept++; else dropped++;
        return {
          plan_id: plan.id, client_id: clientId, week: w.week, sort: i, title: t.title, category: t.category, priority: t.priority,
          target_url: t.target_url, problem: t.problem, evidence_references: refs, description: t.description, steps: t.steps,
          estimated_effort: t.estimated_effort, success_metric: t.success_metric,
        };
      }));
      // measurement / validation tasks may legitimately cite no metric; keep them but mark the gap
      if (tasks.length) {
        const { error } = await admin.from("seo_strategy_tasks").insert(tasks);
        if (error) return fail("Could not save the strategy tasks.");
      }
      await admin.from("ai_analysis_runs").update({ status: "succeeded", output: { summary: o.summary, weeks: o.weeks.map((w) => ({ week: w.week, theme: w.theme })), dropped }, ...tokens, finished_at: new Date().toISOString() }).eq("id", run.id);
    }
    return { ok: true, runId: run.id, kept, dropped };
  } catch (e) {
    return fail(aiErrorMessage(e));
  }
}
