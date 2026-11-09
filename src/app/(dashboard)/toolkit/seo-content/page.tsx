import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { lhColor } from "@/components/charts/score-ring";
import { RunTool } from "@/components/toolkit/run-tool";
import { BackToToolkit, Card, Meter, Pill, RunBar, shortUrl, Stat } from "@/components/toolkit/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import type { ContentRun } from "@/lib/toolkit/content";
import { loadTool } from "@/lib/toolkit/store";

export const maxDuration = 300;

const FACTORS = [["experience", "Experience"], ["expertise", "Expertise"], ["authoritativeness", "Authority"], ["trust", "Trust"], ["ai_citation", "AI citation"]] as const;

// Content quality (E-E-A-T criteria adapted from claude-seo's seo-content skill, MIT licence: https://github.com/AgricIDaniel/claude-seo)
export default async function SeoContentTool() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const stored = await loadTool<ContentRun>(await createClient(), client.id, "seo-content");
  const r = stored?.data;
  const header = <TabHeader source={null} title="Content Quality" description="E-E-A-T, readability, thin content and AI-citation readiness for one page, or the 10 blog posts with the most Search Console clicks (last 90 days)." guide={[
    { term: "Score", text: "60% qualitative (Experience, Expertise, Authority, Trust and AI-citation readiness, each 0-10, read by Claude Haiku) and 40% measured (length up to 1,200 words, Flesch readability, question headings)." },
    { term: "Thin", text: "Under 500 words of main content." },
    { term: "Method", text: "Google's Who/How/Why test and E-E-A-T factors as described in the open-source claude-seo seo-content skill (MIT)." },
  ]} />;
  const run = <RunTool slug="seo-content" canEdit={canEdit} label="Review content" cost="about $0.005" wait="Reading the pages and scoring them. About 30-60 seconds." input={{ name: "Page URL (optional)", placeholder: "Leave empty for the top 10 blog posts, or paste a URL" }} />;
  if (!stored || !r) return <><BackToToolkit />{header}<RunBar>{run}</RunBar><EmptyState title="No content reviewed yet" body="Leave the box empty to review the 10 best-performing blog posts, or enter one page of the website." /></>;
  const ok = r.pages.filter((p) => !p.error);
  const avg = (f: (p: (typeof ok)[number]) => number) => ok.length ? Math.round(ok.reduce((a, p) => a + f(p), 0) / ok.length) : 0;
  const factorAvg = FACTORS.map(([k, label]) => ({ label, v: ok.filter((p) => p.ai).length ? Number((ok.filter((p) => p.ai).reduce((a, p) => a + (p.ai![k] as number), 0) / ok.filter((p) => p.ai).length).toFixed(1)) : 0 }));
  return (
    <>
      <BackToToolkit />
      {header}
      <RunBar fetchedAt={stored.fetchedAt} cost={stored.cost} note={r.mode === "blog" ? "Top 10 blog posts by Search Console clicks" : `Single page: ${r.pages[0]?.url}`}>{run}</RunBar>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Average score" value={avg((p) => p.score)} sub={`${ok.length} pages reviewed`} />
        <Stat label="Average words" value={avg((p) => p.words).toLocaleString()} sub={`${ok.filter((p) => p.thin).length} thin (<500)`} />
        <Stat label="Average readability" value={avg((p) => p.read.flesch)} sub="Flesch reading ease (60+ is easy)" />
        <Stat label="Question headings" value={ok.reduce((a, p) => a + p.questionHeadings, 0)} sub="help AI answers quote you" />
      </div>
      <Card title="E-E-A-T and AI citation (average, 0-10)" className="mt-4">
        <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {factorAvg.map((f) => <li key={f.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"><span>{f.label}</span><Meter value={f.v} max={10} color={lhColor(f.v * 10)} /><span className="text-right tabular-nums">{f.v}</span></li>)}
        </ul>
      </Card>
      <div className="mt-4 space-y-4">
        {r.pages.map((p) => (
          <Card key={p.url} title={p.title ?? shortUrl(p.url)} right={p.error ? p.error : `score ${p.score}`}>
            <p className="mb-3 break-all text-xs text-muted"><a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.url}</a>{p.clicks != null && ` · ${p.clicks} clicks (90 days)`}</p>
            {!p.error && (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
                  <Pill tone={p.thin ? "High" : "Low"}>{p.words} words{p.thin ? " · thin" : ""}</Pill>
                  <Pill tone={p.read.flesch < 50 ? "Medium" : "Low"}>Flesch {p.read.flesch} · grade {p.read.grade}</Pill>
                  <Pill>{p.read.avgSentence} words/sentence</Pill>
                  <Pill>{p.headings} headings · {p.questionHeadings} questions</Pill>
                  {p.ai && FACTORS.map(([k, l]) => <Pill key={k} tone={(p.ai![k] as number) < 5 ? "Medium" : "Low"}>{l} {p.ai![k] as number}/10</Pill>)}
                </div>
                {p.ai ? (
                  <div className="grid gap-4 text-sm md:grid-cols-3">
                    <div><h3 className="mb-1 text-xs font-semibold text-muted">Strengths</h3><ul className="list-disc space-y-0.5 pl-4">{p.ai.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                    <div><h3 className="mb-1 text-xs font-semibold text-muted">Issues</h3><ul className="list-disc space-y-0.5 pl-4">{p.ai.issues.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                    <div><h3 className="mb-1 text-xs font-semibold text-muted">Fixes</h3><ul className="list-disc space-y-0.5 pl-4">{p.ai.fixes.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                    <p className="text-secondary md:col-span-3"><span className="font-medium text-foreground">Who/How/Why: </span>{p.ai.who_how_why}{p.ai.citable_passage && <><br /><span className="font-medium text-foreground">Most quotable line: </span>&ldquo;{p.ai.citable_passage}&rdquo;</>}</p>
                  </div>
                ) : <p className="text-sm text-muted">AI review unavailable for this page; measured metrics only.</p>}
              </>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
