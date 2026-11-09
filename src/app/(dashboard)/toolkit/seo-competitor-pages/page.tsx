import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { RunTool } from "@/components/toolkit/run-tool";
import { BackToToolkit, Card, Meter, Pill, RunBar, Stat } from "@/components/toolkit/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import type { CompRun } from "@/lib/toolkit/comparison";
import { loadTool } from "@/lib/toolkit/store";

export const maxDuration = 120;

// Comparison-page planner (structure adapted from claude-seo's seo-competitor-pages skill, MIT licence: https://github.com/AgricIDaniel/claude-seo)
export default async function SeoCompetitorPagesTool() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const stored = await loadTool<CompRun>(await createClient(), client.id, "seo-competitor-pages");
  const r = stored?.data;
  const header = <TabHeader source={null} title="Comparison Pages" description={`Outlines for "${r?.brand ?? client.name} vs <competitor>" and "<competitor> alternatives" pages, built from the competitor data already stored (shared keywords, keyword gaps, their top pages).`} guide={[
    { term: "Fair comparisons", text: "Outlines never invent competitor prices or ratings: anything that needs evidence is listed under 'Proof needed' for you to verify before publishing." },
    { term: "Cost", text: "No DataForSEO call (stored data only); Claude Haiku drafts the outlines for well under a cent." },
  ]} />;
  const run = <RunTool slug="seo-competitor-pages" canEdit={canEdit} label="Plan pages" cost="under $0.01" wait="Drafting outlines from the stored competitor data. About 30 seconds." />;
  if (!stored || !r) return <><BackToToolkit />{header}<RunBar>{run}</RunBar><EmptyState title="No outlines yet" body="Plan comparison pages against the competitors tracked on the Competitors page." /></>;
  const maxT = Math.max(1, ...r.stats.map((s) => s.traffic ?? 0));
  return (
    <>
      <BackToToolkit />
      {header}
      <RunBar fetchedAt={stored.fetchedAt} cost={stored.cost}>{run}</RunBar>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Competitors" value={r.stats.length} />
        <Stat label="Page outlines" value={r.pages.length} sub={`${r.pages.filter((p) => p.kind === "vs").length} vs · ${r.pages.filter((p) => p.kind === "alternatives").length} alternatives`} />
        <Stat label="Shared keywords" value={r.stats.reduce((a, s) => a + (s.shared ?? 0), 0)} sub="across competitors" />
        <Stat label="Keyword gaps used" value={r.stats.reduce((a, s) => a + s.gapKws.length, 0)} sub="they rank, you don't" />
      </div>
      <Card title="Competitor organic traffic" right="monthly visits (DataForSEO)" className="mt-4">
        <ul className="space-y-2.5">
          {r.stats.map((s) => (
            <li key={s.domain} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_5rem]">
              <span className="truncate">{s.domain}</span><Meter value={s.traffic ?? 0} max={maxT} /><span className="text-right tabular-nums">{Math.round(s.traffic ?? 0).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {r.pages.map((p, i) => (
          <Card key={i} title={p.h1} right={p.kind === "vs" ? "vs page" : "alternatives page"}>
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-muted">Title tag</dt><dd className="break-words">{p.title_tag}</dd>
                <dt className="text-muted">URL</dt><dd className="break-all">/{p.slug.replace(/^\//, "")}</dd>
                <dt className="text-muted">Keyword</dt><dd>{p.target_keyword}</dd>
              </dl>
              <ol className="list-decimal space-y-1 pl-5">{p.sections.map((s, j) => <li key={j}><span className="font-medium">{s.heading}</span><span className="block text-secondary">{s.notes}</span></li>)}</ol>
              <div><h3 className="mb-1 text-xs font-semibold text-muted">Comparison table rows</h3><div className="flex flex-wrap gap-1.5">{p.comparison_rows.map((c) => <Pill key={c}>{c}</Pill>)}</div></div>
              {p.proof_needed.length > 0 && <div><h3 className="mb-1 text-xs font-semibold text-muted">Proof needed before publishing</h3><ul className="list-disc space-y-0.5 pl-4 text-secondary">{p.proof_needed.map((c, j) => <li key={j}>{c}</li>)}</ul></div>}
              <p><span className="text-muted">CTA: </span>{p.cta}</p>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
