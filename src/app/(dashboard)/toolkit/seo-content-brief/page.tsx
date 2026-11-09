import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { RunTool } from "@/components/toolkit/run-tool";
import { BackToToolkit, Card, Meter, Pill, RunBar, shortUrl, Stat } from "@/components/toolkit/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { defaultBriefKeyword, type BriefRun } from "@/lib/toolkit/brief";
import { loadTool } from "@/lib/toolkit/store";

export const maxDuration = 300;

// Content brief (structure adapted from claude-seo's seo-content-brief skill, MIT licence: https://github.com/AgricIDaniel/claude-seo)
export default async function SeoBriefTool() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const [stored, suggested] = await Promise.all([
    loadTool<BriefRun>(await createClient(), client.id, "seo-content-brief"),
    canEdit ? defaultBriefKeyword(createAdminClient(), client.id).catch(() => null) : null,
  ]);
  const r = stored?.data;
  const header = <TabHeader source={null} title="Content Brief" description="A writer-ready brief built from what Google ranks today for a keyword: the top results are read and scored, then Claude Sonnet plans sections, word counts, keyword placement and the questions to answer." guide={[
    { term: "Default keyword", text: "The keyword with the most demand where the site ranks between positions 5 and 30 (Search Console and DataForSEO), the easiest to push onto page one." },
    { term: "Competitor score", text: "0-100 from length (up to 2,000 words), heading depth, question headings and whether the keyword is in the title and H1." },
    { term: "Cost", text: "One Google search via DataForSEO (about $0.002, reused when another tool searched it in the last 14 days) plus Claude Sonnet (about $0.03)." },
  ]} />;
  const run = <RunTool slug="seo-content-brief" canEdit={canEdit} label="Build brief" cost="about $0.04" wait="Searching Google, reading the top pages and writing the brief. About 60 seconds." input={{ name: "Keyword", placeholder: suggested ?? "keyword", defaultValue: suggested ?? r?.keyword ?? "" }} />;
  if (!stored || !r) return <><BackToToolkit />{header}<RunBar>{run}</RunBar><EmptyState title="No brief yet" body={`Build a brief for ${suggested ? `"${suggested}" (suggested from your rankings)` : "any keyword"}.`} /></>;
  const b = r.brief;
  const total = b.sections.reduce((a, s) => a + s.words, 0);
  const avgComp = r.competitors.length ? Math.round(r.competitors.reduce((a, c) => a + c.words, 0) / r.competitors.length) : 0;
  return (
    <>
      <BackToToolkit />
      {header}
      <RunBar fetchedAt={stored.fetchedAt} cost={stored.cost} note={`Keyword: ${r.keyword} · SERP $${r.cost.serp.toFixed(4)} · AI $${r.cost.ai.toFixed(4)}`}>{run}</RunBar>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Target length" value={b.target_words.toLocaleString()} sub={`top results average ${avgComp.toLocaleString()} words`} />
        <Stat label="Page type" value={<span className="text-lg">{b.page_type}</span>} sub={b.search_intent} />
        <Stat label="Sections" value={b.sections.length} sub={`${total.toLocaleString()} words planned`} />
        <Stat label="Questions to answer" value={b.questions.length} sub={`${r.serps[0]?.paa.length ?? 0} from People Also Ask`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Page setup">
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Title tag</dt><dd className="break-words font-medium">{b.title_tag}</dd>
            <dt className="text-muted">Meta</dt><dd className="break-words">{b.meta_description}</dd>
            <dt className="text-muted">H1</dt><dd className="break-words">{b.h1}</dd>
            <dt className="text-muted">URL</dt><dd className="break-all">/{b.url_slug.replace(/^\//, "")}</dd>
            <dt className="text-muted">Schema</dt><dd>{b.schema_types.join(", ")}</dd>
          </dl>
        </Card>
        <Card title="Keyword placement">
          <ul className="space-y-1.5 text-sm">{b.keyword_placement.map((k, i) => <li key={i} className="flex justify-between gap-3"><span className="text-muted">{k.where}</span><span className="text-right font-medium">{k.phrase}</span></li>)}</ul>
          <p className="mt-3 text-xs text-muted">Secondary: {b.secondary_keywords.join(", ")}</p>
        </Card>
      </div>
      <Card title="Outline" right={`${total.toLocaleString()} words`} className="mt-4">
        <ol className="space-y-2.5">
          {b.sections.map((s, i) => (
            <li key={i} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-4" style={{ paddingLeft: `${Math.max(0, s.level - 2) * 16}px` }}>
              <div className="min-w-0 text-sm"><p className="font-medium"><span className="mr-1.5 text-xs text-muted">H{s.level}</span>{s.heading}</p><p className="text-secondary">{s.notes}</p></div>
              <div className="flex items-center gap-2 text-xs text-muted"><Meter value={s.words} max={Math.max(...b.sections.map((x) => x.words))} /><span className="w-12 shrink-0 text-right tabular-nums">{s.words}</span></div>
            </li>
          ))}
        </ol>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Questions to answer"><ul className="list-disc space-y-1 pl-4 text-sm">{b.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></Card>
        <Card title="Entities and differentiators"><div className="flex flex-wrap gap-1.5">{b.entities.map((e) => <Pill key={e}>{e}</Pill>)}</div><ul className="mt-3 list-disc space-y-1 pl-4 text-sm">{b.differentiators.map((d, i) => <li key={i}>{d}</li>)}</ul></Card>
        <Card title="Internal links"><ul className="space-y-1 text-sm">{b.internal_links.map((l) => <li key={l} className="truncate"><a href={l} target="_blank" rel="noreferrer" className="hover:underline">{shortUrl(l)}</a></li>)}</ul></Card>
      </div>
      <Card title="Competitor scoring (top results)" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-2 font-medium">#</th><th className="pr-2 font-medium">Page</th><th className="px-2 text-right font-medium">Words</th><th className="px-2 text-right font-medium">Headings</th><th className="px-2 text-center font-medium">KW in title / H1</th><th className="w-32 pl-2 font-medium">Score</th></tr></thead>
            <tbody>{r.competitors.map((c) => (
              <tr key={c.url} className="border-t border-border">
                <td className="py-1.5 pr-2 tabular-nums">{c.position}</td>
                <td className="max-w-[16rem] truncate pr-2"><a href={c.url} target="_blank" rel="noreferrer" className="hover:underline" title={c.title}>{c.domain}</a><span className="block truncate text-xs text-muted">{c.title}</span></td>
                <td className="px-2 text-right tabular-nums">{c.words.toLocaleString()}</td><td className="px-2 text-right tabular-nums">{c.headings}</td>
                <td className="px-2 text-center">{c.kwInTitle ? "yes" : "no"} / {c.kwInH1 ? "yes" : "no"}</td>
                <td className="pl-2"><div className="flex items-center gap-2"><Meter value={c.score} /><span className="w-7 text-right tabular-nums">{c.score}</span></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
