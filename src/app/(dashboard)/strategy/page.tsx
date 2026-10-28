import { GenerateButton, TaskStatusSelect } from "@/components/ai/ai-controls";
import { AutoAnalysis } from "@/components/ai/auto-analysis";
import { TabHeader } from "@/components/dashboard/tab-header";
import { Highlights } from "@/components/dashboard/highlights";
import { pickHighlights } from "@/lib/overview/highlights";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { Unavailable } from "@/components/report/report-ui";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { first, type SearchParams } from "@/lib/analytics/url";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const maxDuration = 300;

type Task = {
  id: string; week: number; sort: number; title: string; category: string; priority: string; target_url: string | null;
  problem: string | null; evidence_references: string[]; description: string; steps: string[]; estimated_effort: string;
  success_metric: string; status: string; completed_at: string | null;
};
const WEEKS = ["Critical fixes & quick wins", "Keyword & content optimisation", "User experience & conversion", "Measurement, validation & next steps"];

export default async function StrategyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp.range) ?? (first(sp.start) ? undefined : "month"), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays);
  const canEdit = ["owner", "admin"].includes(client.role);
  const supabase = await createClient();
  const { data: plan, error } = await supabase.from("seo_strategy_plans").select("id, summary, period_start, period_end, created_at, run_id")
    .eq("client_id", client.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: tasks } = plan
    ? await supabase.from("seo_strategy_tasks").select("*").eq("plan_id", plan.id).order("week").order("sort")
    : { data: [] as Task[] };
  const all = (tasks ?? []) as Task[];
  const { data: planRun } = plan?.run_id
    ? await supabase.from("ai_analysis_runs").select("evidence").eq("id", plan.run_id).maybeSingle()
    : { data: null };
  const sources = [...new Set((((planRun?.evidence ?? {}) as { items?: { source: string }[] }).items ?? []).map((i) => i.source))];
  const { data: runningRow } = await supabase.from("ai_analysis_runs").select("id").eq("client_id", client.id).eq("kind", "strategy").eq("status", "running").limit(1);
  const running = (runningRow ?? []).length > 0;
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  const autoStart = configured && canEdit && !error && !plan && !running;
  const done = all.filter((t) => t.status === "completed").length;

  const focusWeek = [1, 2, 3, 4].find((w) => all.some((t) => t.week === w && !["completed", "skipped"].includes(t.status)));
  const openInFocus = focusWeek ? all.filter((t) => t.week === focusWeek && !["completed", "skipped"].includes(t.status)) : [];
  const hl = pickHighlights([
    all.length > 0 && { tone: (done > 0 ? "good" : "info") as "good" | "info", title: `${done} of ${all.length} tasks completed`, detail: all.length - done > 0 ? `${all.length - done} remaining across the four weeks.` : "The plan is complete.", action: all.length - done > 0 ? "Mark tasks as you finish them so the next plan builds on real progress." : "Generate a new plan from fresh data." },
    Boolean(focusWeek) && openInFocus.length > 0 && { tone: "bad" as const, title: `Focus now: week ${focusWeek}`, detail: `${openInFocus.length} open task${openInFocus.length > 1 ? "s" : ""}, starting with “${openInFocus[0].title}”.`, action: "Finish the current week before starting the next." },
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <TabHeader source={null} eyebrow="AI intelligence" title="30-Day SEO Strategy" description="A prioritised, week-by-week plan generated from this period's evidence. Track progress as you go; future reports compare before and after, without claiming cause and effect." guide={[
  { term: "Weekly plan", text: "Week 1 fixes and quick wins, week 2 keyword and content work, week 3 user experience and conversion, week 4 measurement and next steps." },
  { term: "Evidence", text: "Each task cites the data behind it. Tasks without evidence are setup or measurement steps." },
  { term: "Success metric", text: "What to check later to know whether the task worked. Results are compared before and after, without claiming cause and effect." },
]} />
      <RangeSelector path="/strategy" sp={sp} range={range} showCompare={false} />
      {plan && <Highlights items={hl} />}
      {error ? (
        <Unavailable title="Database update needed" body="Apply migration 20261021000011 in Supabase to enable the strategy planner." />
      ) : !process.env.ANTHROPIC_API_KEY ? (
        <Unavailable title="AI isn't configured" body="Add ANTHROPIC_API_KEY to the environment (and Vercel), then redeploy." />
      ) : (
        <div className="mb-8 space-y-2">
          <AutoAnalysis kind="strategy" start={range.start} end={range.end} autoStart={autoStart} running={running} />
          <GenerateButton kind="strategy" start={range.start} end={range.end}
            label={plan ? `Generate latest strategy (${range.start} → ${range.end})` : "Generate 30-day strategy"}
            disabled={!canEdit || running} disabledReason={running ? "A strategy is already being generated" : "Owners and admins only"} />
          {plan && <p className="text-xs text-muted">A new plan is prepared automatically after each month closes. Generating a new one keeps earlier plans and their task history.</p>}
        </div>
      )}

      {plan && (
        <>
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Plan based on {plan.period_start} → {plan.period_end}</p>
            <p className="mt-2 leading-relaxed">{plan.summary}</p>
            {sources.length > 0 && <p className="mt-2 text-xs text-muted">Data sources in this plan: {sources.join(" · ")}</p>}
            <p className="mt-3 text-sm text-muted">{done} of {all.length} tasks completed</p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-positive" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} /></div>
          </div>
          <div className="space-y-8">
            {[1, 2, 3, 4].map((w) => (
              <section key={w} aria-labelledby={`week-${w}`}>
                <h2 id={`week-${w}`} className="mb-3 flex items-baseline gap-3">
                  <span className="text-3xl font-extrabold text-accent">W{w}</span>
                  <span className="text-lg font-semibold">{WEEKS[w - 1]}</span>
                </h2>
                <div className="space-y-3">
                  {all.filter((t) => t.week === w).map((t) => (
                    <article key={t.id} className={cn("rounded-xl border border-border bg-surface p-5", t.status === "skipped" && "opacity-60", t.status === "completed" && "border-positive/40")}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {t.priority} priority · {t.category.replace(/_/g, " ")} · {t.estimated_effort} effort
                          </p>
                          <h3 className="mt-1 font-semibold">{t.title}</h3>
                          {t.target_url && <p className="break-all text-xs text-muted">{t.target_url}</p>}
                        </div>
                        <TaskStatusSelect id={t.id} status={t.status} />
                      </div>
                      {t.problem && <p className="mt-2 text-sm"><span className="font-semibold">Problem: </span>{t.problem}</p>}
                      <p className="mt-1 text-sm">{t.description}</p>
                      {t.steps.length > 0 && <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
                      <p className="mt-2 text-sm"><span className="font-semibold">Success metric: </span>{t.success_metric}</p>
                      <p className="mt-1 text-xs text-muted">
                        Evidence: {t.evidence_references.length ? t.evidence_references.join(", ") : "none cited (measurement or setup task)"}
                        {t.completed_at && ` · completed ${new Date(t.completed_at).toLocaleDateString()}`}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
