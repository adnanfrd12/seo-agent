import { GenerateButton, TaskStatusSelect } from "@/components/ai/ai-controls";
import { PageHeader } from "@/components/dashboard/page-header";
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
  const done = all.filter((t) => t.status === "completed").length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="30-Day SEO Strategy" description="A prioritised, week-by-week plan generated from this period's evidence. Track progress as you go; future reports compare before and after, without claiming cause and effect." />
      <RangeSelector path="/strategy" sp={sp} range={range} showCompare={false} />
      {error ? (
        <Unavailable title="Database update needed" body="Apply migration 20261021000011 in Supabase to enable the strategy planner." />
      ) : !process.env.ANTHROPIC_API_KEY ? (
        <Unavailable title="AI isn't configured" body="Add ANTHROPIC_API_KEY to the environment (and Vercel), then redeploy." />
      ) : (
        <div className="mb-8">
          <GenerateButton kind="strategy" start={range.start} end={range.end} label={plan ? "Generate a new 30-day strategy" : "Generate 30-day strategy"}
            disabled={!canEdit} disabledReason="Owners and admins only" />
        </div>
      )}

      {plan && (
        <>
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Plan based on {plan.period_start} → {plan.period_end}</p>
            <p className="mt-2 leading-relaxed">{plan.summary}</p>
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
