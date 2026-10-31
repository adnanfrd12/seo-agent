import { CheckCircle2, CircleDot, XCircle } from "lucide-react";
import { GenerateButton, InsightActions } from "@/components/ai/ai-controls";
import { AutoAnalysis } from "@/components/ai/auto-analysis";
import { Donut, Heatmap } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { Fill, SplitBar, StackedColumns } from "@/components/charts/ops-charts";
import { TabHeader } from "@/components/dashboard/tab-header";
import { cat } from "@/lib/charts/colors";
import { Highlights } from "@/components/dashboard/highlights";
import { pickHighlights } from "@/lib/overview/highlights";
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
  const sources = [...new Set((latest?.evidence?.items ?? []).map((i) => i.source))];
  const evidenceById = new Map((latest?.evidence?.items ?? []).map((i) => [i.id, i]));
  const current = ((insights ?? []) as Insight[]).filter((i) => !latest || i.run_id === latest.id);

  const open = current.filter((i) => !["implemented", "dismissed"].includes(i.implementation_status));
  const done = current.filter((i) => i.implementation_status === "implemented").length;
  const highOpen = open.filter((i) => i.priority === "high");
  const count = (f: (i: Insight) => boolean) => current.filter(f).length;
  const cats = new Map<string, number>();
  for (const i of current) cats.set(i.category, (cats.get(i.category) ?? 0) + 1);
  const byCategory = [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ label: c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()).replace(/seo\b/i, "SEO"), value: n }));
  // AI spend per day and analysis type, over the runs listed in the history table
  const kinds = [...new Set(((runs ?? []) as Run[]).map((r) => r.kind))];
  const spendDays = new Map<string, Record<string, number>>();
  for (const r of [...((runs ?? []) as Run[])].reverse()) {
    if (r.cost_usd == null) continue;
    const d = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const v = spendDays.get(d) ?? {};
    v[r.kind] = (v[r.kind] ?? 0) + Number(r.cost_usd);
    spendDays.set(d, v);
  }
  const hl = pickHighlights([
    current.length > 0 && { tone: (done > 0 ? "good" : "info") as "good" | "info", title: `${done} of ${current.length} recommendations completed`, detail: `${open.length} still open.`, action: open.length ? "Work through the high-priority ones first, then mark each Done so progress is tracked." : "Generate a fresh analysis to find the next opportunities." },
    highOpen.length > 0 && { tone: "bad" as const, title: `${highOpen.length} high-priority recommendation${highOpen.length > 1 ? "s" : ""} open`, detail: highOpen[0].title, action: "Start here: strongest evidence and impact." },
    latest && { tone: "info" as const, title: "Analysis is kept up to date automatically", detail: `Latest: ${new Date(latest.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} for ${latest.range_start} → ${latest.range_end}. Active clients are refreshed weekly when the data changed.` },
  ]);

  return (
    <div>
      <TabHeader source={null} eyebrow="AI intelligence" title="AI SEO Insights" description="Evidence-based interpretation of your GA4, Search Console, Bing, Business Profile (incl. reviews and local rankings), Clarity and imported data. The numbers are calculated by the app; the AI only interprets them." guide={[
  { term: "Evidence", text: "Every recommendation cites numbers from your connected data. The AI interprets them; it never invents metrics." },
  { term: "Priority, confidence, effort", text: "Priority = expected importance, confidence = how strong the evidence is, effort = how much work it takes. Start with high priority and small effort." },
  { term: "Hypothesis vs fact", text: "The impact shown is a testable hypothesis, never a guarantee. The success metric tells you what to measure." },
  { term: "Status", text: "Mark recommendations Approved, Done or Dismissed so progress is tracked and the AI doesn't repeat finished work." },
]} />
      <RangeSelector path="/insights" sp={sp} range={range} showCompare={false} />
      {current.length > 0 && <Highlights items={hl} />}

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
          <div className="rounded-[10px] border border-border bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Executive summary · {latest.range_start} → {latest.range_end}</p>
            <p className="mt-2 max-w-[110ch] leading-relaxed">{latest.output?.executive_summary}</p>
            {sources.length > 0 && <p className="mt-3 text-xs text-muted">Data sources in this analysis: {sources.join(" · ")}</p>}
          </div>
          {/* one card, two columns: the lists rarely match in length, so a shorter one never leaves a half-empty card */}
          <div className="grid items-start gap-x-2 rounded-[10px] border border-border bg-surface md:grid-cols-2 max-md:divide-y max-md:divide-hairline">
            {[
              { t: "Significant improvements", items: latest.output?.significant_improvements ?? [], tone: "text-positive" },
              { t: "Significant declines", items: latest.output?.significant_declines ?? [], tone: "text-negative" },
            ].map((b) => (
              <div key={b.t} className="p-5">
                <p className={cn("text-sm font-semibold", b.tone)}>{b.t} <span className="font-normal text-muted">{b.items.length}</span></p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {b.items.length ? b.items.map((x, i) => <li key={i}>{x.statement}</li>) : <li className="text-muted">None with enough evidence.</li>}
                </ul>
              </div>
            ))}
          </div>
          {(latest.output?.insufficient_evidence?.length ?? 0) > 0 && (
            <div className="rounded-[10px] border border-dashed border-border bg-surface p-5 text-sm">
              <p className="font-semibold">What the data can&apos;t answer yet</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{latest.output!.insufficient_evidence!.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {current.length > 0 && (
        <section aria-label="Recommendation charts" className="mb-8 space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Fill><SplitBar title="Progress" sub="Status of this analysis' recommendations" total={`${done} of ${current.length}`} totalLabel="done" segments={[
              { label: "Done", value: done, color: "var(--positive)" }, { label: "Approved", value: count((i) => i.implementation_status === "approved"), color: "color-mix(in oklab, var(--positive) 45%, var(--surface))" },
              { label: "Open", value: count((i) => !["approved", "implemented", "dismissed"].includes(i.implementation_status)), color: "var(--cat-other)" }, { label: "Dismissed", value: count((i) => i.implementation_status === "dismissed"), color: "var(--border-strong)" },
            ]} /></Fill>
            <Fill><Donut title="By priority" sub="Expected importance" center={String(highOpen.length)} centerLabel="high, open" items={[
              { label: "High", value: count((i) => i.priority === "high"), color: "var(--negative)" }, { label: "Medium", value: count((i) => i.priority === "medium"), color: "var(--warn)" }, { label: "Low", value: count((i) => i.priority === "low"), color: "var(--cat-other)" },
            ]} /></Fill>
            <Fill className="md:col-span-2 lg:col-span-1"><BarList title="By category" valueLabel="Recommendations" items={byCategory} /></Fill>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Fill><Heatmap title="Priority and effort" sub="Recommendations in each cell · start top left (high priority, small effort)" rows={["High", "Medium", "Low"]} cols={["Small", "Medium", "Large"]}
              cells={["high", "medium", "low"].map((p) => ["small", "medium", "large"].map((e) => count((i) => i.priority === p && i.estimated_effort === e)))} /></Fill>
            <Fill><SplitBar title="Confidence" sub="How strong the evidence behind each recommendation is" segments={[
              { label: "High", value: count((i) => i.confidence === "high"), color: "var(--series)" }, { label: "Medium", value: count((i) => i.confidence === "medium"), color: "color-mix(in oklab, var(--series) 55%, var(--surface))" },
              { label: "Low", value: count((i) => i.confidence === "low"), color: "color-mix(in oklab, var(--series) 22%, var(--surface))" },
            ]} /></Fill>
          </div>
        </section>
      )}

      <section className="grid gap-4 2xl:grid-cols-2" aria-label="Recommendations">
        {current.map((r) => {
          const Icon = STATUS_ICON[r.implementation_status as keyof typeof STATUS_ICON];
          return (
            <article key={r.id} className={cn("rounded-[10px] border border-border bg-surface p-5 [overflow-wrap:anywhere]", r.implementation_status === "dismissed" && "opacity-60")}>
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
              <dl className="mt-3 grid items-start gap-x-4 gap-y-2 text-sm md:grid-cols-3">
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
        {latest && current.length === 0 && <p className="text-sm text-muted 2xl:col-span-2">The last run produced no recommendations with valid supporting evidence.</p>}
      </section>

      {(runs ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-semibold">Analysis history</h2>
          {spendDays.size > 0 && (
            <div className="mb-4">
              <StackedColumns title="AI spend per day" sub="Estimated cost of the analyses below, by type" format="usd" valueLabel="USD"
                keys={kinds.map((k, i) => ({ key: k, label: k.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()), color: cat(i) }))}
                columns={[...spendDays.entries()].map(([label, values]) => ({ label, values }))} />
            </div>
          )}
          <div className="overflow-x-auto rounded-[10px] border border-border bg-surface">
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
