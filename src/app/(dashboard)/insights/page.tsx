import { CheckCircle2, CircleDot, XCircle } from "lucide-react";
import { GenerateButton, InsightActions } from "@/components/ai/ai-controls";
import { AutoAnalysis } from "@/components/ai/auto-analysis";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { Unavailable } from "@/components/report/report-ui";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { first, type SearchParams } from "@/lib/analytics/url";
import type { EvidenceItem } from "@/lib/ai/evidence";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const maxDuration = 300; // AI generation runs inside the server action

type Insight = {
  id: string; category: string; title: string; summary: string; target_url: string | null; recommended_action: string;
  priority: string; confidence: string; estimated_effort: string; expected_impact_hypothesis: string; success_metric: string;
  implementation_status: string; evidence_references: string[]; supporting_metrics: { ref: string; label: string; value: string }[];
  run_id: string; created_at: string;
};
type Run = {
  id: string; kind: string; status: string; model: string | null; input_tokens: number | null; output_tokens: number | null;
  cost_usd: number | null; error: string | null; created_at: string; range_start: string | null; range_end: string | null;
  output: { executive_summary?: string; significant_improvements?: { statement: string }[]; significant_declines?: { statement: string }[]; insufficient_evidence?: string[]; dropped?: number } | null;
  evidence: { items?: EvidenceItem[] } | null;
};

const PRIORITY = { high: "bg-negative/10 text-negative", medium: "bg-accent-soft text-accent", low: "bg-surface-muted text-muted" } as const;
const STATUS_ICON = { approved: CircleDot, implemented: CheckCircle2, dismissed: XCircle } as const;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp.range) ?? (first(sp.start) ? undefined : "month"), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays);
  const canEdit = ["owner", "admin"].includes(client.role);
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);

  const supabase = await createClient();
  const [{ data: runs, error: runsErr }, { data: insights }] = await Promise.all([
    supabase.from("ai_analysis_runs").select("id, kind, status, model, input_tokens, output_tokens, cost_usd, error, created_at, range_start, range_end, output, evidence")
      .eq("client_id", client.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("analytics_insights").select("*").eq("client_id", client.id).order("created_at", { ascending: false }).limit(60),
  ]);
  const migrationMissing = Boolean(runsErr);
  const latest = ((runs ?? []) as Run[]).find((r) => r.kind === "insights" && r.status === "succeeded");
  const running = ((runs ?? []) as Run[]).some((r) => r.kind === "insights" && r.status === "running");
  // first visit with nothing generated yet: admins get one started automatically
  const autoStart = configured && canEdit && !migrationMissing && !latest && !running;
  const evidenceById = new Map((latest?.evidence?.items ?? []).map((i) => [i.id, i]));
  const current = ((insights ?? []) as Insight[]).filter((i) => !latest || i.run_id === latest.id);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="AI SEO Insights" description="Evidence-based interpretation of your GA4, Search Console, Clarity and imported data. The numbers are calculated by the app; the AI only interprets them." />
      <RangeSelector path="/insights" sp={sp} range={range} showCompare={false} />

      {migrationMissing ? (
        <Unavailable title="Database update needed" body="Apply migration 20261021000011 in Supabase to enable AI insights." />
      ) : !configured ? (
        <Unavailable title="AI isn't configured" body="Add ANTHROPIC_API_KEY to the environment (and Vercel), then redeploy." />
      ) : (
        <div className="mb-8 space-y-2">
          <AutoAnalysis kind="insights" start={range.start} end={range.end} autoStart={autoStart} running={running} />
          <GenerateButton kind="insights" start={range.start} end={range.end}
            label={latest ? `Generate latest analysis (${range.start} → ${range.end})` : "Generate AI analysis"}
            disabled={!canEdit || running} disabledReason={running ? "An analysis is already running" : "Owners and admins only"} />
          {latest && <p className="text-xs text-muted">Showing the analysis generated {new Date(latest.created_at).toLocaleString()} for {latest.range_start} → {latest.range_end}. A new one is prepared automatically after each month closes.</p>}
        </div>
      )}

      {latest && (
        <section className="mb-8 space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Executive summary · {latest.range_start} → {latest.range_end}</p>
            <p className="mt-2 leading-relaxed">{latest.output?.executive_summary}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { t: "Significant improvements", items: latest.output?.significant_improvements ?? [], tone: "text-positive" },
              { t: "Significant declines", items: latest.output?.significant_declines ?? [], tone: "text-negative" },
            ].map((b) => (
              <div key={b.t} className="rounded-xl border border-border bg-surface p-5">
                <p className={cn("text-sm font-semibold", b.tone)}>{b.t}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {b.items.length ? b.items.map((x, i) => <li key={i}>{x.statement}</li>) : <li className="text-muted">None with enough evidence.</li>}
                </ul>
              </div>
            ))}
          </div>
          {(latest.output?.insufficient_evidence?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-sm">
              <p className="font-semibold">What the data can&apos;t answer yet</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{latest.output!.insufficient_evidence!.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <section className="space-y-4" aria-label="Recommendations">
        {current.map((r) => {
          const Icon = STATUS_ICON[r.implementation_status as keyof typeof STATUS_ICON];
          return (
            <article key={r.id} className={cn("rounded-xl border border-border bg-surface p-5", r.implementation_status === "dismissed" && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
                    <span className={cn("rounded px-1.5 py-0.5", PRIORITY[r.priority as keyof typeof PRIORITY])}>{r.priority} priority</span>
                    <span className="text-muted">{r.category.replace(/_/g, " ")}</span>
                    <span className="text-muted">· {r.confidence} confidence · {r.estimated_effort} effort</span>
                    {Icon && <span className="inline-flex items-center gap-1 text-positive"><Icon className="size-3.5" /> {r.implementation_status}</span>}
                  </div>
                  <h2 className="mt-1.5 text-lg font-semibold">{r.title}</h2>
                  {r.target_url && <p className="break-all text-xs text-muted">{r.target_url}</p>}
                </div>
                <InsightActions id={r.id} status={r.implementation_status} canEdit={canEdit} />
              </div>
              <p className="mt-2 text-sm">{r.summary}</p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-semibold text-muted">Recommended change</dt><dd>{r.recommended_action}</dd></div>
                <div><dt className="text-xs font-semibold text-muted">Hypothesis (not a guarantee)</dt><dd>{r.expected_impact_hypothesis}</dd></div>
                <div><dt className="text-xs font-semibold text-muted">Success metric</dt><dd>{r.success_metric}</dd></div>
              </dl>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-medium text-accent">View supporting evidence ({r.evidence_references.length})</summary>
                <ul className="mt-2 space-y-1 rounded-lg bg-surface-muted p-3 text-xs">
                  {r.evidence_references.map((ref) => {
                    const e = evidenceById.get(ref);
                    return <li key={ref}><span className="font-mono text-muted">{ref}</span>{e ? ` · ${e.source}: ${e.label} = ${e.value}${e.detail ? ` (${e.detail})` : ""}` : ""}</li>;
                  })}
                </ul>
              </details>
            </article>
          );
        })}
        {latest && current.length === 0 && <p className="text-sm text-muted">The last run produced no recommendations with valid supporting evidence.</p>}
      </section>

      {(runs ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-semibold">Analysis history</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[40rem] text-sm">
              <thead><tr className="text-left text-xs text-muted">{["When", "Type", "Period", "Status", "Model", "Tokens in/out", "Est. cost"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {((runs ?? []) as Run[]).map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 capitalize">{r.kind.replace("_", " ")}</td>
                    <td className="px-3 py-2">{r.range_start ?? "—"} → {r.range_end ?? "—"}</td>
                    <td className="px-3 py-2" title={r.error ?? undefined}><span className={r.status === "failed" ? "text-negative" : r.status === "running" ? "text-muted" : "text-positive"}>{r.status}</span>{r.error ? `: ${r.error.slice(0, 60)}` : ""}</td>
                    <td className="px-3 py-2">{r.model ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{r.input_tokens ?? "—"} / {r.output_tokens ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(3)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
