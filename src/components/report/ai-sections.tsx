import Link from "next/link";
import { Activity, Clock, MousePointerClick, ScrollText } from "lucide-react";
import type { ReportData } from "@/lib/report/data";
import { CHAPTER_COLORS, Findings, ReportTable, StatTile, Unavailable } from "./report-ui";
import { fmtInt } from "@/lib/analytics/format";

const WEEK = ["Critical fixes & quick wins", "Keyword & content optimisation", "User experience & conversion", "Measurement & next steps"];

export function ClarityBlock({ d }: { d: ReportData }) {
  if (!d.clarity) {
    return <Unavailable title="Microsoft Clarity data isn't available for this period"
      body="Connect Clarity on the Integrations page. Its API provides the last 1–3 days per call, so stored history starts from the day it is connected. Session recordings can't be retrieved through any official API; recording insights come from reviewers' logged observations." />;
  }
  const c = d.clarity;
  const span = c.from === c.to ? c.from : `${c.from} → ${c.to}`;
  const tile = (k: string, label: string) => (
    <StatTile key={k} label={label} icon={MousePointerClick} color={CHAPTER_COLORS[4]} source="Clarity" format={fmtInt} higherIsBetter={false} value={c.totals[k] ?? 0}
      hint={`Sum over ${c.days} stored day(s) (${span}). No comparison until a full previous period is stored.`} />
  );
  return (
    <>
      <p className="text-xs text-muted">
        {c.outsideRange
          ? `No Clarity data is stored for the selected period (Clarity's API only serves the last 1-3 days). Showing the latest stored days: ${span} (UTC).`
          : `${c.days} stored day(s) in this period: ${span} (UTC).`}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Sessions" icon={Activity} color={CHAPTER_COLORS[4]} source="Clarity" format={fmtInt} value={c.totals.sessions ?? 0} />
        <StatTile label="Avg scroll depth" icon={ScrollText} color={CHAPTER_COLORS[4]} source="Clarity" format={(v) => (v == null ? "—" : `${v.toFixed(1)}%`)} value={c.scrollDepth} />
        <StatTile label="Avg active time (s)" icon={Clock} color={CHAPTER_COLORS[4]} source="Clarity" format={fmtInt} value={c.activeSeconds} />
        {tile("ScriptErrorCount", "Script errors")}
        {tile("RageClickCount", "Rage clicks")}{tile("DeadClickCount", "Dead clicks")}{tile("ExcessiveScroll", "Excessive scrolling")}{tile("QuickbackClick", "Quick backs")}
      </div>
      <ReportTable<{ url: string; total: number }> title={`Pages with most friction signals (${c.days} stored day(s))`} source="Microsoft Clarity"
        empty="No page-level Clarity data in this period." rows={c.topPages}
        columns={[{ label: "Page", render: (p) => <span className="break-all">{p.url || "(unknown)"}</span> }, { label: "Signals", align: "right", render: (p) => fmtInt(p.total) }]} />
    </>
  );
}

export function AiInsightsBlock({ d, linked }: { d: ReportData; linked: boolean }) {
  const ai = d.ai;
  if (!ai?.summary) {
    return <Unavailable title="No AI analysis generated yet"
      body="Generate one on the AI SEO Insights page. Insights are built from a structured evidence package of this report's figures; every recommendation cites its evidence, and the AI never calculates or invents metrics."
      action={linked ? <Link href="/insights" className="text-sm font-medium text-accent hover:underline">Open AI SEO Insights →</Link> : undefined} />;
  }
  return (
    <>
      <div className="report-avoid-break rounded-lg bg-surface-muted p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">AI-generated summary · based on {ai.periodStart} → {ai.periodEnd}</p>
        <p className="mt-2 leading-relaxed">{ai.summary}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Findings title="Significant improvements (AI)" tone="good" items={ai.improvements.length ? ai.improvements : ["None with enough evidence."]} />
        <Findings title="Significant declines (AI)" tone="bad" items={ai.declines.length ? ai.declines : ["None with enough evidence."]} />
      </div>
      <ReportTable<(typeof ai.recommendations)[number]> title="Recommendations" source="AI analysis of API data" empty="No recommendations with valid evidence."
        rows={ai.recommendations.slice(0, 10)} columns={[
          { label: "Priority", render: (r) => <span className="font-semibold capitalize">{r.priority}</span> },
          { label: "Recommendation", render: (r) => <span><span className="font-medium">{r.title}</span><br /><span className="text-xs text-muted">{r.recommended_action}</span></span> },
          { label: "Target", render: (r) => <span className="break-all text-xs">{r.target_url ?? "—"}</span> },
          { label: "Success metric", render: (r) => <span className="text-xs">{r.success_metric}</span> },
          { label: "Status", render: (r) => <span className="capitalize">{r.implementation_status}</span> },
        ]} />
      <p className="text-xs text-muted">AI interpretation ({ai.model ?? "Claude"}) of the figures in this report. Causes are hypotheses unless stated otherwise; no ranking or revenue outcome is guaranteed.</p>
    </>
  );
}

export function StrategyBlock({ d, fallback, linked }: { d: ReportData; fallback: React.ReactNode; linked: boolean }) {
  const plan = d.ai?.plan;
  if (!plan || plan.tasks.length === 0) {
    return <>{fallback}{linked && <Link href="/strategy" className="text-sm font-medium text-accent hover:underline">Generate the full 30-day strategy →</Link>}</>;
  }
  const done = plan.tasks.filter((t) => t.status === "completed").length;
  return (
    <>
      {plan.summary && <p className="leading-relaxed">{plan.summary}</p>}
      <p className="text-sm text-muted">{done} of {plan.tasks.length} tasks completed</p>
      {[1, 2, 3, 4].map((w) => (
        <ReportTable<(typeof plan.tasks)[number]> key={w} title={`Week ${w} · ${WEEK[w - 1]}`} empty="No tasks this week."
          rows={plan.tasks.filter((t) => t.week === w)} columns={[
            { label: "Task", render: (t) => <span className="font-medium">{t.title}</span> },
            { label: "Priority", render: (t) => <span className="capitalize">{t.priority}</span> },
            { label: "Effort", render: (t) => <span className="capitalize">{t.estimated_effort}</span> },
            { label: "Success metric", render: (t) => <span className="text-xs">{t.success_metric}</span> },
            { label: "Status", render: (t) => <span className="capitalize">{t.status.replace("_", " ")}</span> },
          ]} />
      ))}
    </>
  );
}
