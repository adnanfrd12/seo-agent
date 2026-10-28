import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { CoachRun } from "@/components/research/coach-run";
import { Tabs } from "@/components/research/tabs";
import { getSession } from "@/lib/analytics/client-context";
import { COACH_MODEL, loadCoach, type CoachMode, type CoachOutput, type CoachResult } from "@/lib/ai/coach";
import { createClient } from "@/lib/supabase/server";

const Refs = ({ ids }: { ids: string[] }) => (ids.length ? <p className="text-[11px] text-muted">Based on: {ids.join(", ")}</p> : null);
const Steps = ({ items }: { items: string[] }) => (items.length ? <ol className="ml-5 list-decimal space-y-0.5 text-sm">{items.map((s, i) => <li key={i}>{s}</li>)}</ol> : null);
const Card = ({ children }: { children: React.ReactNode }) => <div className="space-y-2 rounded-xl border border-border bg-surface p-4">{children}</div>;
const Meta = ({ r }: { r: CoachResult }) => <p className="text-xs text-muted">Written {r.generatedAt.slice(0, 10)} by Claude Sonnet 5.5 from {r.evidenceCount} stored data points ({r.period.start} to {r.period.end}). Suggestions are hypotheses to test, not guarantees.</p>;

function CoachView({ r }: { r: CoachResult<"coach"> }) {
  const o = r.output as CoachOutput<"coach">;
  return (
    <div className="space-y-4">
      <Card><h3 className="text-sm font-semibold">Where you stand</h3><p className="text-sm">{o.where_you_stand}</p></Card>
      <h3 className="text-sm font-semibold">Your first five steps</h3>
      <ol className="space-y-3">{o.steps.map((s, i) => (
        <li key={i}><Card><p className="font-semibold"><span className="mr-2 text-accent">{i + 1}.</span>{s.title} <span className="ml-1 text-xs font-normal text-muted">{s.time_estimate}</span></p><p className="text-sm text-muted">{s.why}</p><Steps items={s.how} /></Card></li>
      ))}</ol>
      {o.terms.length > 0 && <Card><h3 className="text-sm font-semibold">Words you will meet</h3><dl className="space-y-1 text-sm">{o.terms.map((t) => <div key={t.term}><dt className="inline font-medium">{t.term}: </dt><dd className="inline text-muted">{t.meaning}</dd></div>)}</dl></Card>}
    </div>
  );
}

function PrioritiesView({ r }: { r: CoachResult<"priorities"> }) {
  const o = r.output as CoachOutput<"priorities">;
  return (
    <div className="space-y-4">
      <p className="text-sm">{o.summary}</p>
      {o.actions.length === 0 ? <p className="text-sm text-muted">The AI couldn&apos;t back an action with the stored data. Connect more sources or run a Site Audit, then refresh.</p> : o.actions.map((a, i) => (
        <Card key={i}><p className="font-semibold"><span className="mr-2 text-accent">#{i + 1}</span>{a.title} <span className="ml-1 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-normal">{a.effort} effort</span></p>
          <p className="text-sm">{a.why_it_matters}</p><Steps items={a.steps} /><p className="text-sm text-muted"><span className="font-medium text-foreground">Possible effect: </span>{a.expected_effect_hypothesis}</p><Refs ids={a.evidence_references} /></Card>
      ))}
      {o.not_now.length > 0 && <Card><h3 className="text-sm font-semibold">Safe to ignore for now</h3><ul className="ml-5 list-disc space-y-0.5 text-sm text-muted">{o.not_now.map((n, i) => <li key={i}>{n}</li>)}</ul></Card>}
    </div>
  );
}

function TopicsView({ r }: { r: CoachResult<"topics"> }) {
  const o = r.output as CoachOutput<"topics">;
  return (
    <div className="space-y-4">
      <p className="text-sm">{o.summary}</p>
      {o.topics.map((t, i) => (
        <Card key={i}><p className="font-semibold">{t.title}</p>
          <p className="flex flex-wrap gap-1.5 text-[11px]"><span className="rounded bg-accent-soft px-1.5 py-0.5">{t.action === "new_page" ? "New page" : "Improve existing page"}</span>{t.target_keyword && <span className="rounded bg-surface-muted px-1.5 py-0.5">Keyword: {t.target_keyword}</span>}<span className="rounded bg-surface-muted px-1.5 py-0.5">Intent: {t.search_intent}</span></p>
          <p className="text-sm">{t.why}</p>{t.target_url && <p className="break-all text-xs text-muted">Page: {t.target_url}</p>}<Steps items={t.outline} /><Refs ids={t.evidence_references} /></Card>
      ))}
    </div>
  );
}

function CompetitorsView({ r }: { r: CoachResult<"competitors"> }) {
  const o = r.output as CoachOutput<"competitors">;
  return (
    <div className="space-y-4">
      <p className="text-sm">{o.summary}</p>
      <div className="grid gap-3 lg:grid-cols-2">{o.competitors.map((c) => (
        <Card key={c.domain}><p className="break-all font-semibold">{c.domain}</p>
          <p className="text-sm"><span className="font-medium">Does well: </span>{c.what_they_do_well}</p><p className="text-sm"><span className="font-medium">Beats you on: </span>{c.where_they_beat_you}</p><p className="text-sm"><span className="font-medium text-positive">Where you can win: </span>{c.where_you_can_win}</p><Refs ids={c.evidence_references} /></Card>
      ))}</div>
      {o.plays.length > 0 && <><h3 className="text-sm font-semibold">Plays to run</h3>{o.plays.map((p, i) => <Card key={i}><p className="font-semibold">{p.title}</p><Steps items={p.steps} /><Refs ids={p.evidence_references} /></Card>)}</>}
    </div>
  );
}

const MODES: { key: CoachMode; tab: string; command: string; title: string; blurb: string; label: string }[] = [
  { key: "coach", tab: "SEO Coach", command: "/seo-coach", title: "Learn how to start with SEO", blurb: "A plain-language walkthrough of where this site stands and what a beginner should do first, in order.", label: "the coach" },
  { key: "priorities", tab: "First moves", command: "/seo-audit", title: "What 1-2 things will drive more traffic?", blurb: "The one or two actions with the best mix of impact and effort, backed by this site's own data, plus what to ignore for now.", label: "first moves" },
  { key: "topics", tab: "Content topics", command: "/keyword-research", title: "Find topics worth writing about", blurb: "Pages to write or improve, found in the site's search data, keyword gaps, rankings and AI-answer gaps.", label: "content topics" },
  { key: "competitors", tab: "Competitor strategy", command: "/competitor-analysis", title: "Understand your competitors' strategy", blurb: "What the main competitors do well, where they beat this site, where it can win, and the moves to make.", label: "competitor strategy" },
];

export default async function CoachPage() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const header = <TabHeader source={null} title="SEO Coach" description="Guided answers written from this site's own stored data: where to start, what to do first, what to write about, and how competitors win." />;
  if (!process.env.ANTHROPIC_API_KEY) return <>{header}<EmptyState title="AI isn't configured" body="Add ANTHROPIC_API_KEY to the environment (and Vercel), then redeploy." /></>;
  const stored = await loadCoach(await createClient(), client.id);
  const view = (m: CoachMode) => {
    const r = stored[m];
    if (!r) return null;
    if (m === "coach") return <CoachView r={r as CoachResult<"coach">} />;
    if (m === "priorities") return <PrioritiesView r={r as CoachResult<"priorities">} />;
    if (m === "topics") return <TopicsView r={r as CoachResult<"topics">} />;
    return <CompetitorsView r={r as CoachResult<"competitors">} />;
  };
  return (
    <>
      {header}
      <p className="mb-4 text-xs text-muted">Uses your Anthropic key with {COACH_MODEL.replace("claude-", "Claude ").replace("sonnet-5-5", "Sonnet 5.5")}. Each analysis costs about 15 cents, is stored, and opening this page never spends anything.</p>
      <Tabs label="Coach analyses" items={MODES.map((m) => ({
        key: m.key, label: m.tab,
        content: (
          <div className="space-y-4">
            <div><h2 className="text-base font-semibold">{m.title}</h2><p className="text-sm text-muted">{m.blurb}</p></div>
            <CoachRun mode={m.key} canEdit={canEdit} generatedAt={stored[m.key]?.generatedAt ?? null} label={m.label} />
            {stored[m.key] ? <><Meta r={stored[m.key] as CoachResult} />{view(m.key)}</> : <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">Not generated yet.</p>}
          </div>
        ),
      }))} />
    </>
  );
}
