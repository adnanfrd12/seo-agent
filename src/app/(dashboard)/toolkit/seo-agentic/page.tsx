import Link from "next/link";
import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { lhColor, ScoreRing } from "@/components/charts/score-ring";
import { ResearchTable } from "@/components/research/research-table";
import { BackToToolkit, Card, day, FixList, type Fix } from "@/components/toolkit/bits";
import { ScanRun } from "@/components/toolkit/scan-run";
import { CopyText, DownloadText } from "@/components/toolkit/text-file";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { daysAgo, loadScan, TK, type AiReady } from "@/lib/toolkit/site-scan";
import { cn } from "@/lib/utils";

export const maxDuration = 300;

/**
 * AI readiness: agent/crawler access (claude-seo seo-agentic) + passage citability and entity clarity (seo-geo),
 * both MIT-licensed skills from github.com/AgricIDaniel/claude-seo, combined with this app's AI Visibility checks.
 */
export default async function AiReadinessPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, cache } = page;
  const header = <><BackToToolkit /><TabHeader source={null} title="AI Readiness" description="Can AI assistants and AI search reach, understand and quote this website? Checks llms.txt, the robots.txt rules for each AI crawler, Content-Signal, the business entity in structured data and how quotable the top pages are, next to the real AI Visibility results." guide={[
    { term: "Score", text: "Crawler access 30, entity clarity 25, passage citability 25, llms.txt 10, measured AI visibility 10 (when AI Visibility checks exist; otherwise re-balanced)." },
    { term: "Citability", text: "Per page, 0-100: self-contained 40-170 word answer paragraphs, question-style headings, lists or tables, FAQ data and enough depth. AI answers quote passages, not whole pages." },
    { term: "Training vs search bots", text: "Blocking training bots (GPTBot, Google-Extended, CCBot) is a business choice. Blocking search/user bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot, ChatGPT-User) removes the site from AI answers." },
    { term: "Method", text: "Adapted from the open-source claude-seo seo-agentic and seo-geo skills (MIT licence). Free: reads the client's own website." },
  ]} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website yet" body="Set the client's website so it can be scanned." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  const supabase = await createClient();
  const since = new Date(daysAgo(90)).toISOString().slice(0, 10);
  const [stored, { data: checks }] = await Promise.all([
    loadScan<AiReady>(supabase, client.id, TK.ai),
    supabase.from("ai_checks").select("mentioned, cited, checked_on").eq("client_id", client.id).gte("checked_on", since).limit(2000),
  ]);
  const top = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <p className="text-xs text-muted"><span className="font-medium text-foreground">{cache.target.domain}</span> · scanned {day(stored?.fetchedAt)} · refreshed weekly</p>
      <ScanRun canEdit={canEdit} />
    </div>
  );
  if (!stored) return <>{header}{top}<EmptyState title="Not scanned yet" body="Run the free scan to check llms.txt, robots.txt and the key pages." /></>;
  const a = stored.data;

  const vis = checks ?? [];
  const mentionRate = vis.length ? Math.round((vis.filter((c) => c.mentioned).length / vis.length) * 100) : null;
  const citeRate = vis.length ? Math.round((vis.filter((c) => c.cited).length / vis.length) * 100) : null;
  const searchBots = a.robots.bots.filter((b) => b.purpose !== "training");
  const blockedSearch = searchBots.filter((b) => b.access === "blocked");
  const blockedTrain = a.robots.bots.filter((b) => b.purpose === "training" && b.access === "blocked");
  const access = Math.round(100 * (1 - blockedSearch.length / searchBots.length) - (a.robots.status === 200 ? 0 : 10));
  const entity = Math.min(100, (a.entity.types.length ? 40 : 0) + (a.entity.name ? 10 : 0) + Math.min(20, a.entity.sameAs.length * 5) + (a.entity.hasAddress ? 10 : 0) + (a.entity.hasPhone ? 10 : 0) + (a.entity.hasLogo ? 5 : 0) + (a.entity.hasGeo ? 5 : 0));
  const cit = a.pages.length ? Math.round(a.pages.reduce((s, p) => s + p.citability, 0) / a.pages.length) : 0;
  const llms = a.llms.present ? 50 + (a.llms.hasH1 ? 15 : 0) + (a.llms.hasSummary ? 15 : 0) + (a.llms.sections ? 10 : 0) + (a.llms.links >= 5 ? 10 : 0) : 0;
  const parts = [{ label: "AI crawler access", v: Math.max(0, access), w: 30 }, { label: "Entity clarity", v: entity, w: 25 }, { label: "Passage citability", v: cit, w: 25 }, { label: "llms.txt", v: llms, w: 10 }, ...(mentionRate != null ? [{ label: "Measured AI visibility", v: Math.min(100, mentionRate * 2), w: 10 }] : [])];
  const score = Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / parts.reduce((s, p) => s + p.w, 0));

  const fixes: Fix[] = [];
  if (blockedSearch.length) fixes.push({ prio: "Critical", issue: `robots.txt blocks AI search crawlers: ${blockedSearch.map((b) => b.ua).join(", ")}`, fix: "Remove the Disallow: / for these user agents. They fetch pages to answer live questions and cite sources; blocked, the site can't be cited." });
  if (!a.llms.present) fixes.push({ prio: "Medium", issue: "No llms.txt at the site root", fix: "Upload the draft below as /llms.txt (a WordPress plugin such as Yoast or a static file both work). It gives AI agents a clean summary and the key URLs." });
  else if (!a.llms.hasSummary || a.llms.links < 5) fixes.push({ prio: "Low", issue: "llms.txt is thin", fix: "Add a one-line > summary and ## sections linking the main service pages (see the draft below)." });
  if (!a.entity.types.length) fixes.push({ prio: "High", issue: "No Organization / LocalBusiness structured data on the home page", fix: "Add LocalBusiness JSON-LD with name, address, telephone, logo, geo, areaServed and sameAs links to the Business Profile and social profiles." });
  else {
    if (a.entity.sameAs.length < 2) fixes.push({ prio: "High", issue: `Entity has ${a.entity.sameAs.length} sameAs link${a.entity.sameAs.length === 1 ? "" : "s"}`, fix: "Add sameAs URLs (Google Business Profile, Facebook, Instagram, LinkedIn, Yelp, BBB) so AI systems can tie the brand to one entity." });
    if (!a.entity.hasAddress || !a.entity.hasPhone) fixes.push({ prio: "Medium", issue: "Entity is missing address or telephone", fix: "Add PostalAddress and telephone matching the Business Profile exactly (NAP consistency)." });
  }
  const weak = a.pages.filter((p) => p.citability < 40);
  if (weak.length) fixes.push({ prio: "Medium", issue: "Pages with low passage citability", count: weak.length, fix: "Add question-style H2s (\"How much does a channel letter sign cost?\") each followed by a direct 40-170 word answer, plus a short list or table of specs/prices." });
  if (!a.pages.some((p) => p.faq)) fixes.push({ prio: "Low", issue: "No FAQ blocks on key pages", fix: "Add a visible FAQ section on main service pages; FAQ structured data is optional, the visible Q&A is what AI answers quote." });
  if (!a.robots.contentSignal) fixes.push({ prio: "Low", issue: "No Content-Signal in robots.txt", fix: "Optional: state AI usage preferences, e.g. Content-Signal: search=yes, ai-input=yes, ai-train=no." });

  return (
    <>
      {header}{top}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col items-center justify-center gap-2 rounded-[10px] border border-border bg-surface p-5 text-center">
          <div className="[&>div]:w-auto"><ScoreRing score={score} label="AI readiness" size={124} /></div>
          <p className="text-xs text-muted">{fixes.length} fix{fixes.length === 1 ? "" : "es"} · {a.pages.length} pages read</p>
        </div>
        <Card title="Score breakdown" sub="Weight in brackets">
          <ul className="space-y-2.5">{parts.map((p) => (
            <li key={p.label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
              <span className="truncate">{p.label} <span className="text-xs text-muted">{p.w}%</span></span>
              <span className="relative h-3 rounded-full bg-surface-muted"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, p.v)}%`, background: lhColor(p.v) }} /></span>
              <span className="text-right font-semibold tabular-nums" style={{ color: lhColor(p.v) }}>{p.v}</span>
            </li>
          ))}</ul>
        </Card>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="llms.txt" value={a.llms.present ? "Present" : "Missing"} sub={a.llms.present ? `${a.llms.sections} sections · ${a.llms.links} links${a.llms.full ? " · llms-full.txt too" : ""}` : `/llms.txt answered ${a.llms.status ?? "nothing"}`} tone={a.llms.present ? "good" : "warn"} />
        <StatCard label="AI search bots blocked" value={`${blockedSearch.length} / ${searchBots.length}`} sub={`${blockedTrain.length} training bots blocked`} tone={blockedSearch.length ? "bad" : "good"} />
        <StatCard label="Entity sameAs links" value={String(a.entity.sameAs.length)} sub={a.entity.types.join(", ") || "no Organization schema"} tone={a.entity.sameAs.length >= 2 ? "good" : "warn"} />
        <StatCard label="AI answers mentioning brand" value={mentionRate == null ? "—" : `${mentionRate}%`} sub={mentionRate == null ? "no AI Visibility checks yet" : `${citeRate}% cite the site · ${vis.length} checks, 90 days`} tone={mentionRate == null ? undefined : mentionRate >= 30 ? "good" : "warn"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Prioritised fixes"><FixList fixes={fixes} empty="Everything checked is AI-ready." /></Card>
        <Card title="AI crawler access (robots.txt)" sub={`robots.txt ${a.robots.status ?? "unreachable"} · Content-Signal: ${a.robots.contentSignal ?? "not set"}`}>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{a.robots.bots.map((b) => (
            <li key={b.ua} className="flex items-center justify-between gap-2 rounded-md bg-surface-muted/60 px-2.5 py-1.5">
              <span className="min-w-0 truncate"><span className="font-medium">{b.ua}</span> <span className="text-xs text-muted">{b.owner} · {b.purpose}</span></span>
              <span className={cn("shrink-0 rounded px-1.5 text-xs font-medium", b.access === "allowed" ? "bg-positive/10 text-positive" : b.access === "blocked" ? "bg-negative/10 text-negative" : "bg-warn/10 text-warn")}>{b.access}</span>
            </li>
          ))}</ul>
          <p className="mt-2 text-xs text-muted">Rule group used: the bot&apos;s own User-agent block when present, otherwise &quot;*&quot;.</p>
        </Card>
      </div>

      <div className="mt-6">
        <ResearchTable title="Passage citability of key pages" csvName={`ai-readiness-${cache.target.domain}`} searchKeys={["page", "title"]} initialSort={{ key: "citability", dir: "asc" }}
          rows={a.pages.map((p) => ({ page: p.url, title: p.title ?? "", citability: p.citability, words: p.words, headings: p.headings, questions: p.questionHeadings, answers: p.answerParagraphs, lists: p.lists + p.tables, faq: p.faq }))}
          columns={[{ key: "page", label: "Page", type: "url" }, { key: "title", label: "Title" }, { key: "citability", label: "Citability", type: "int", hint: "0-100" }, { key: "words", label: "Words", type: "int" }, { key: "headings", label: "H2-H4", type: "int" }, { key: "questions", label: "Question headings", type: "int" }, { key: "answers", label: "Answer paragraphs (40-170 words)", type: "int" }, { key: "lists", label: "Lists + tables", type: "int" }, { key: "faq", label: "FAQ schema", type: "bool" }]} />
      </div>

      <div className="mt-6">
        <Card title="Generated llms.txt draft" sub={a.llms.present ? "The site already has an llms.txt; compare with this draft built from the scanned pages." : "Built from the home page, entity data and scanned service pages. Review, then upload to the site root as /llms.txt."}
          right={<div className="flex gap-2"><CopyText text={a.draft} /><DownloadText text={a.draft} filename="llms.txt" label="Download llms.txt" /></div>}>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-muted p-3 text-xs">{a.draft}</pre>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted">Live AI answers for tracked prompts are on <Link href="/ai-visibility" className="underline">AI Visibility</Link>.</p>
    </>
  );
}
