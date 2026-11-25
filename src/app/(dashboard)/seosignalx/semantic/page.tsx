import type { ReactNode } from "react";
import { Card, NoAudit, ScoreRing, statusMeta, SxHeader } from "@/components/seosignalx/ui";
import { audit, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

type Sem = {
  _reportAnalyzedAt?: string; url?: string; seoScore?: number; semanticScore?: number; performanceScore?: number; summaryAlert?: string; targetKeyword?: string; targetCountry?: string;
  wordCount?: number; relevantWordCount?: number; plainText?: string;
  keywordCloud?: { word: string; size: number }[]; keywordOccurrences?: { term: string; percent: number; color?: string }[];
  seoAnalysis?: { criterion: string; value: string; status?: string; note?: string }[];
  headingHierarchy?: { tag: string; text: string }[];
  relevantKeywords?: { keyword: string; count: number; density: string; inTitle?: boolean; inMeta?: boolean; inH1?: boolean; inH2?: boolean; inH3?: boolean; inUrl?: boolean; inAlt?: boolean }[];
  entities?: { entity: string; type?: string; description?: string; confidence?: number; wikiUrl?: string; correspondingTerm?: string }[];
  hyperlinks?: { link: string; httpCode?: string; category?: string; anchor?: string; relAttr?: string }[];
  imageAlts?: { source: string; alt?: string; titleAttr?: string; dimensions?: string }[];
  languageEncoding?: { criterion: string; value: string }[];
  performance?: { metric: string; explanation?: string; value: string; status?: string }[];
  competitorAnalysis?: { keyword?: string; source?: string; yourPage?: { seoScore?: number; semanticScore?: number; totalWords?: number; relevantWords?: number }; pages?: { url?: string; title?: string; seoScore?: number; semanticScore?: number; totalWords?: number }[] };
};

const TABS = [["summary", "Summary"], ["seo", "SEO Analysis"], ["page-map", "Page Map"], ["keywords", "Keywords"], ["entities", "Entities"], ["links", "Outbound Links"], ["images", "Images"], ["language", "Language"], ["performance", "Performance"], ["competitors", "Competitors"], ["plain-text", "Plain Text"]] as const;
const yes = (b?: boolean) => (b ? <span className="text-emerald-500">✓</span> : <span className="text-faint">—</span>);
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted";
const td = "px-3 py-2 align-top";
function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-hairline"><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody className="divide-y divide-hairline">{children}</tbody></table></div>;
}
function Result({ status }: { status?: string }) {
  const m = statusMeta(status);
  return <span className="inline-flex items-center gap-1">{m.icon}<span className="text-xs text-muted">{m.label}</span></span>;
}

export default async function SemanticPage() {
  const v = await sxPage();
  if (!v) return null;
  const a = audit<Sem>(v.bundle, "semantic");
  const header = <SxHeader title="Semantic Audit" description="Semantic and on-page analysis of the home page." project={v.bundle?.project?.name} analyzedAt={a?.result._reportAnalyzedAt ?? a?.updatedAt} />;
  if (!a) return <>{header}<NoAudit label="Semantic" reason={v.bundle?.project ? null : "This client has no SEOSignalX project."} /></>;
  const r = a.result;
  const maxCloud = Math.max(1, ...(r.keywordCloud ?? []).map((k) => k.size));

  return (
    <>
      {header}
      <section className="grid grid-cols-3 gap-3">
        {([["SEO Score", r.seoScore], ["Semantic", r.semanticScore], ["Performance", r.performanceScore]] as const).map(([l, val]) => (
          <div key={l} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:gap-4">
            <ScoreRing value={val ?? null} size={64} />
            <div className="text-center sm:text-left"><p className="text-2xl font-bold tabular-nums">{val ?? "—"}<span className="text-sm font-normal text-muted"> / 100</span></p><p className="text-xs text-muted">{l}</p></div>
          </div>
        ))}
      </section>

      <nav aria-label="Sections" className="sticky top-0 z-10 -mx-1 mt-5 flex gap-1 overflow-x-auto bg-background/90 px-1 py-2 backdrop-blur">
        {TABS.map(([id, l]) => <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-surface-muted">{l}</a>)}
      </nav>

      <div className="mt-3 space-y-4 [&>section]:scroll-mt-16">
        <Card title={<span id="summary">Summary overview</span>}>
          <div className="grid gap-6 p-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Page optimized for</p>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {(r.keywordCloud ?? []).map((k) => <span key={k.word} className="font-semibold text-blue-600 dark:text-blue-400" style={{ fontSize: `${12 + (k.size / maxCloud) * 14}px` }}>{k.word}</span>)}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Keyword occurrences</p>
              <div className="mb-2 flex h-3 overflow-hidden rounded-full">{(r.keywordOccurrences ?? []).map((k) => <span key={k.term} title={`${k.term} ${k.percent}%`} style={{ width: `${k.percent}%`, background: k.color ?? "#94a3b8" }} />)}</div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{(r.keywordOccurrences ?? []).map((k) => <li key={k.term} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: k.color ?? "#94a3b8" }} />{k.term} ({k.percent}%)</li>)}</ul>
            </div>
          </div>
          {r.summaryAlert && <p className="border-t border-hairline px-4 py-3 text-sm">{r.summaryAlert}</p>}
        </Card>

        <Card title={<span id="seo">SEO analysis of the page</span>}>
          <Table head={["Criterion", "Value", "Result"]}>
            {(r.seoAnalysis ?? []).map((c) => <tr key={c.criterion}><td className={`${td} font-medium`}>{c.criterion}</td><td className={`${td} max-w-xl break-words text-secondary`}>{c.value}{c.note && <p className="text-xs text-muted">{c.note}</p>}</td><td className={td}><Result status={c.status} /></td></tr>)}
          </Table>
        </Card>

        <Card title={<span id="page-map">Page title hierarchy</span>} sub={`${r.headingHierarchy?.length ?? 0} headings`}>
          <ul className="max-h-[32rem] divide-y divide-hairline overflow-y-auto text-sm">
            {(r.headingHierarchy ?? []).map((h, i) => <li key={i} className="flex gap-3 px-4 py-1.5" style={{ paddingLeft: `${16 + (Number(h.tag.slice(1)) - 1) * 14}px` }}><span className="w-7 shrink-0 font-mono text-xs uppercase text-blue-600 dark:text-blue-400">{h.tag}</span><span>{h.text}</span></li>)}
          </ul>
        </Card>

        <Card title={<span id="keywords">Relevant keywords</span>} sub={`Target keyword: ${r.targetKeyword ?? "—"} · ${r.relevantWordCount ?? 0} relevant of ${r.wordCount ?? 0} words`}>
          <Table head={["Keyword", "Count", "Density", "Title", "Meta", "H1", "H2", "H3", "URL", "Alt"]}>
            {(r.relevantKeywords ?? []).map((k) => <tr key={k.keyword}><td className={`${td} font-medium`}>{k.keyword}</td><td className={`${td} tabular-nums`}>{k.count}</td><td className={td}>{k.density}</td><td className={td}>{yes(k.inTitle)}</td><td className={td}>{yes(k.inMeta)}</td><td className={td}>{yes(k.inH1)}</td><td className={td}>{yes(k.inH2)}</td><td className={td}>{yes(k.inH3)}</td><td className={td}>{yes(k.inUrl)}</td><td className={td}>{yes(k.inAlt)}</td></tr>)}
          </Table>
        </Card>

        <Card title={<span id="entities">Entities</span>} sub="Named entities found on the page">
          <Table head={["Entity", "Term", "Type", "Confidence", "Description"]}>
            {(r.entities ?? []).map((e, i) => <tr key={i}><td className={`${td} font-medium`}>{e.wikiUrl ? <a href={e.wikiUrl} target="_blank" rel="noreferrer" className="text-accent underline">{e.entity}</a> : e.entity}</td><td className={td}>{e.correspondingTerm}</td><td className={td}>{e.type}</td><td className={`${td} tabular-nums`}>{e.confidence != null ? `${e.confidence}%` : "—"}</td><td className={`${td} text-xs text-muted`}>{e.description}</td></tr>)}
          </Table>
        </Card>

        <Card title={<span id="links">Outbound links</span>} sub={`${r.hyperlinks?.length ?? 0} links`}>
          <div className="max-h-[32rem] overflow-y-auto">
            <Table head={["Link", "Anchor", "Type", "Rel", "HTTP"]}>
              {(r.hyperlinks ?? []).map((l, i) => <tr key={i}><td className={`${td} max-w-xs break-all`}><a href={l.link} target="_blank" rel="noreferrer" className="text-accent underline">{l.link}</a></td><td className={td}>{l.anchor}</td><td className={td}>{l.category}</td><td className={td}>{l.relAttr}</td><td className={`${td} text-xs text-muted`}>{l.httpCode}</td></tr>)}
            </Table>
          </div>
        </Card>

        <Card title={<span id="images">Images</span>} sub={`${r.imageAlts?.length ?? 0} images · ${(r.imageAlts ?? []).filter((x) => !x.alt).length} without alt text`}>
          <div className="max-h-[32rem] overflow-y-auto">
            <Table head={["Image", "Alt text", "Title", "Size"]}>
              {(r.imageAlts ?? []).map((m, i) => <tr key={i}><td className={`${td} max-w-xs break-all`}><a href={m.source} target="_blank" rel="noreferrer" className="text-accent underline">{m.source.split("/").pop()}</a></td><td className={td}>{m.alt || <span className="text-rose-500">Missing</span>}</td><td className={td}>{m.titleAttr || "—"}</td><td className={`${td} text-xs text-muted`}>{m.dimensions}</td></tr>)}
            </Table>
          </div>
        </Card>

        <Card title={<span id="language">Language & encoding</span>} sub={`Target country: ${r.targetCountry ?? "—"}`}>
          <Table head={["Criterion", "Value"]}>
            {(r.languageEncoding ?? []).map((c) => <tr key={c.criterion}><td className={`${td} font-medium`}>{c.criterion}</td><td className={td}>{c.value}</td></tr>)}
          </Table>
        </Card>

        <Card title={<span id="performance">Performance</span>}>
          <Table head={["Metric", "Value", "Result", "What it means"]}>
            {(r.performance ?? []).map((p) => <tr key={p.metric}><td className={`${td} font-medium`}>{p.metric}</td><td className={`${td} tabular-nums`}>{p.value}</td><td className={td}><Result status={p.status} /></td><td className={`${td} text-xs text-muted`}>{p.explanation}</td></tr>)}
          </Table>
        </Card>

        <Card title={<span id="competitors">Competitors</span>} sub={`Keyword: ${r.competitorAnalysis?.keyword ?? "—"}`}>
          <Table head={["Page", "SEO score", "Semantic score", "Words"]}>
            <tr className="bg-blue-500/5"><td className={`${td} font-medium`}>Your page</td><td className={td}>{r.competitorAnalysis?.yourPage?.seoScore ?? "—"}</td><td className={td}>{r.competitorAnalysis?.yourPage?.semanticScore ?? "—"}</td><td className={td}>{r.competitorAnalysis?.yourPage?.totalWords ?? "—"}</td></tr>
            {(r.competitorAnalysis?.pages ?? []).map((p, i) => <tr key={i}><td className={`${td} max-w-xs break-all`}>{p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="text-accent underline">{p.title ?? p.url}</a> : p.title}</td><td className={td}>{p.seoScore ?? "—"}</td><td className={td}>{p.semanticScore ?? "—"}</td><td className={td}>{p.totalWords ?? "—"}</td></tr>)}
          </Table>
          {!r.competitorAnalysis?.pages?.length && <p className="px-4 py-3 text-xs text-muted">SEOSignalX hasn&apos;t compared competitors for this keyword yet{r.competitorAnalysis?.source ? ` (${r.competitorAnalysis.source})` : ""}.</p>}
        </Card>

        <Card title={<span id="plain-text">Plain text</span>} sub={`${r.wordCount ?? 0} words`}>
          <p className="max-h-[28rem] overflow-y-auto whitespace-pre-line p-4 text-sm text-secondary">{r.plainText}</p>
        </Card>
      </div>
    </>
  );
}
