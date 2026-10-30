import { CheckCircle2, CircleDashed, Eye, Link2 } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { BubbleMap } from "@/components/charts/bubble-map";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Highlights } from "@/components/dashboard/highlights";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { Tabs } from "@/components/research/tabs";
import { AiControls, RemoveButton } from "@/components/research/tracking-controls";
import { getSession } from "@/lib/analytics/client-context";
import {
  AI_EVERY_DAYS, brandStats, ENGINES, enginesFrom, loadAi, promptEstimate, suggestPrompts, type AiCheck, type EngineKey,
} from "@/lib/ai/visibility";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadRanks } from "@/lib/dataforseo/rank";
import { loadCache, resolveTarget } from "@/lib/dataforseo/research";
import type { Highlight } from "@/lib/overview/highlights";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300; // a manual check asks several assistants per question

type Row = Record<string, unknown>;
const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const avg = (l: number[]) => (l.length ? Number((l.reduce((a, b) => a + b, 0) / l.length).toFixed(1)) : null);

function Status({ c }: { c: AiCheck | undefined }) {
  if (!c) return <span className="inline-flex items-center gap-1 text-xs text-muted"><CircleDashed className="size-3.5" aria-hidden /> Not checked</span>;
  if (c.mentioned && c.cited) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><CheckCircle2 className="size-3.5" aria-hidden /> Named{c.position ? ` #${c.position}` : ""} + cited</span>;
  if (c.mentioned) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><CheckCircle2 className="size-3.5" aria-hidden /> Named{c.position ? ` #${c.position}` : ""}</span>;
  if (c.cited) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><Link2 className="size-3.5" aria-hidden /> Cited</span>;
  if (c.seen) return <span className="inline-flex items-center gap-1 text-xs font-medium text-[#D4970A]"><Eye className="size-3.5" aria-hidden /> Seen, not used</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-negative"><CircleDashed className="size-3.5" aria-hidden /> Not visible</span>;
}

export default async function AiVisibilityPage() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const header = <TabHeader source={null} title="AI Visibility" description="Whether ChatGPT, Perplexity, Gemini and Claude name, rank and cite the business when people ask the questions your customers ask, who they recommend instead, and how they talk about each brand." guide={[
    { term: "Visibility", text: "Share of AI answers (question × assistant) that name the business." },
    { term: "Top-3 visibility", text: "Share of answers where the business is among the first three businesses named." },
    { term: "Position", text: "Where the business is named in the answer: #1 = the first business mentioned." },
    { term: "Detection rate", text: "Share of tracked questions where at least one assistant names the business." },
    { term: "Citations", text: "Links the assistants give as sources. A citation of your website sends readers to it." },
    { term: "Sentiment", text: "0-100 for how favourably the answer describes a brand: 50 neutral, 75+ recommended or praised, under 40 negative. Read by Claude Sonnet 5.5 from the answer text." },
    { term: "Sources", text: "ChatGPT (GPT-5.4 mini), Perplexity (Sonar) and Gemini (3.5 Flash) answer with live web search through DataForSEO; Claude Sonnet 5.5 through your Anthropic key. Answers vary by person and day, so read the numbers as a trend." },
  ]} />;
  if (!process.env.ANTHROPIC_API_KEY) return <>{header}<EmptyState title="AI isn't configured" body="Add ANTHROPIC_API_KEY to the environment (and Vercel), then redeploy." /></>;

  const supabase = await createClient();
  const [ai, target] = await Promise.all([loadAi(supabase, client.id), resolveTarget(createAdminClient(), client.id)]);
  if (!ai.ok) return <>{header}<EmptyState title="AI visibility needs one database update" body="Apply the latest database migrations in the Supabase SQL editor, then reload this page." /></>;
  if (!target) return <>{header}<EmptyState title="No website to check yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const { data: settings } = await supabase.from("clients").select("settings").eq("id", client.id).maybeSingle();
  const search = (settings?.settings as { ai_search?: boolean } | null)?.ai_search !== false;
  const engines = enginesFrom(settings?.settings);
  const cache = await loadCache(supabase, client.id);
  const have = new Set(ai.rows.map((r) => r.prompt.toLowerCase()));
  const kws = ((cache.get<Row[]>("ranked_keywords")?.data ?? []) as Row[]).filter((k) => typeof k.keyword === "string").sort((a, b) => Number(b.volume ?? 0) - Number(a.volume ?? 0)).map((k) => k.keyword as string);
  const suggestions = suggestPrompts(kws, [...have]).slice(0, 6);

  const cutoff = shiftDays(todayIn("UTC"), -(AI_EVERY_DAYS - 1));
  const due = ai.rows.filter((r) => !r.latest || r.latest.checked_on <= cutoff).length;
  const est = `$${((due || ai.rows.length) * promptEstimate(engines)).toFixed(2)}`;
  const site = target.domain.replace(/^www\./, "");

  // ---- metrics over the newest answer per question and assistant
  const L = ai.latest;
  const named = L.filter((c) => c.mentioned);
  const positions = named.map((c) => c.position).filter((p): p is number => p != null);
  const latestDay = ai.lastChecked;
  const latestPositions = L.filter((c) => c.checked_on === latestDay && c.position != null).map((c) => c.position as number);
  const sentiments = named.map((c) => c.sentiment).filter((s): s is number => s != null);
  const ownCitations = L.reduce((a, c) => a + c.sources.filter((s) => s.domain === site || s.domain.endsWith(`.${site}`)).length, 0);
  const detected = ai.rows.filter((r) => Object.values(r.byEngine).some((c) => c && (c.mentioned || c.cited))).length;
  const checkedQuestions = ai.rows.filter((r) => Object.keys(r.byEngine).length).length;
  const brands = brandStats(ai, site);
  const me = brands.find((b) => b.own);
  const rivals = brands.filter((b) => !b.own);

  // previous period (the check before the latest, per question and engine) for comparisons
  const prevMap = new Map<string, AiCheck>();
  for (const c of ai.checks) { const k = `${c.prompt_id}|${c.engine}`; const l = L.find((x) => `${x.prompt_id}|${x.engine}` === k); if (l && c.checked_on < l.checked_on && !prevMap.has(k)) prevMap.set(k, c); }
  const P = [...prevMap.values()];
  const prevVis = P.length ? pctOf(P.filter((c) => c.mentioned).length, P.length) : null;

  // ---- by assistant
  const byEngine = (Object.keys(ENGINES) as EngineKey[]).map((e) => {
    const list = L.filter((c) => c.engine === e);
    const pos = list.map((c) => c.position).filter((p): p is number => p != null);
    const sen = list.filter((c) => c.mentioned).map((c) => c.sentiment).filter((s): s is number => s != null);
    return {
      engine: ENGINES[e].label, answers: list.length, named: list.filter((c) => c.mentioned).length, cited: list.filter((c) => c.cited).length,
      mention_rate: pctOf(list.filter((c) => c.mentioned).length, list.length), citation_rate: pctOf(list.filter((c) => c.cited).length, list.length),
      position: avg(pos), sentiment: avg(sen), brands: avg(list.map((c) => c.brands.length)), sources: avg(list.map((c) => c.sources.length)),
    };
  }).filter((r) => r.answers > 0);

  // ---- visibility over time for the client and the most-named competitors
  const dates = [...new Set(ai.checks.map((c) => c.checked_on))].sort();
  const top = [...(me ? [me] : []), ...rivals.slice(0, 5)];
  const shareOn = (d: string, name: string, own: boolean) => {
    const list = ai.checks.filter((c) => c.checked_on === d);
    const hit = list.filter((c) => (own ? c.mentioned : c.brands.some((b) => !b.own && b.name.toLowerCase() === name.toLowerCase()))).length;
    return pctOf(hit, list.length);
  };
  const sentOn = (d: string, name: string, own: boolean) => {
    const vals = ai.checks.filter((c) => c.checked_on === d).flatMap((c) => c.brands.filter((b) => (own ? b.own : !b.own && b.name.toLowerCase() === name.toLowerCase())).map((b) => b.sentiment)).filter((s): s is number => s != null);
    return avg(vals);
  };
  const visTrend = top.map((b) => ({ key: b.name, label: b.own ? `${b.name} (you)` : b.name, data: dates.map((d) => ({ date: d, value: shareOn(d, b.name, b.own) })).filter((p) => p.value != null) }));
  const sentTrend = top.map((b) => ({ key: b.name, label: b.own ? `${b.name} (you)` : b.name, data: dates.map((d) => ({ date: d, value: sentOn(d, b.name, b.own) })).filter((p) => p.value != null) })).filter((o) => o.data.length);

  // ---- citations
  const citeRows: Row[] = L.flatMap((c) => c.sources.map((s) => ({
    url: s.url, domain: s.domain, title: s.title, question: ai.rows.find((r) => r.id === c.prompt_id)?.prompt ?? "", engine: ENGINES[c.engine].label,
    brands: c.brands.slice(0, 5).map((b) => b.name).join(", "), yours: s.domain === site || s.domain.endsWith(`.${site}`) ? "Your site" : "",
  })));
  const domCount = new Map<string, number>();
  for (const r of citeRows) domCount.set(r.domain as string, (domCount.get(r.domain as string) ?? 0) + 1);
  const topDomains = [...domCount.entries()].sort((a, b) => b[1] - a[1]);

  // ---- Google AI Overviews, from the rank-tracking searches (no extra cost)
  const ranks = await loadRanks(supabase, client.id);
  const aio: Row[] = ranks.ok ? ranks.rows.filter((r) => r.serp).map((r) => ({
    keyword: r.keyword, device: r.device, shown: r.serp!.ai_overview.length ? "Yes" : "No",
    you: r.serp!.ai_overview.some((a) => (a.domain ?? "").replace(/^www\./, "").endsWith(site)) ? "Cited" : r.serp!.ai_overview.length ? "Not cited" : "—",
    sources: r.serp!.ai_overview.map((a) => a.domain).filter(Boolean).join(", "), checked: r.checkedOn,
  })) : [];

  const picks: Highlight[] = [];
  const vis = pctOf(named.length, L.length);
  if (vis != null && prevVis != null && vis !== prevVis) picks.push({ tone: vis > prevVis ? "good" : "bad", title: `AI visibility ${vis > prevVis ? "rose" : "fell"} from ${prevVis}% to ${vis}%`, detail: "Share of AI answers that name the business, compared with the check before." });
  if (rivals[0] && (me?.mentions ?? 0) < rivals[0].mentions) picks.push({ tone: "info", title: `${rivals[0].name} is named in ${rivals[0].detection}% of answers`, detail: `The business is named in ${me?.detection ?? 0}%. Average position for ${rivals[0].name}: #${rivals[0].latestPosition ?? "—"}.`, action: "Open Competitors and Citations to see which sources the assistants rely on, and get listed or mentioned there." });
  if (topDomains[0]) picks.push({ tone: "info", title: `${topDomains[0][0]} is the most cited source`, detail: `Cited ${topDomains[0][1]} times across ${L.length} answers.`, action: "Being listed or reviewed on the most-cited sites is the fastest way into AI answers." });
  const seenOnly = L.filter((c) => c.seen && !c.mentioned && !c.cited).length;
  if (seenOnly) picks.push({ tone: "info", title: `Found by search but not used in ${seenOnly} answer${seenOnly > 1 ? "s" : ""}`, detail: "The assistant saw the website but recommended others.", action: "Add a page that answers that question directly, with clear headings, prices, service areas and reviews." });

  const brandRows: Row[] = brands.map((b) => ({ ...b, name: b.own ? `${b.name} (you)` : b.name, engines: undefined }));

  return (
    <>
      {header}
      <p className="mb-4 text-xs text-muted">Website: <span className="font-medium text-foreground">{site}</span> · {ai.rows.length} question{ai.rows.length === 1 ? "" : "s"} × {engines.length} assistant{engines.length === 1 ? "" : "s"}{ai.lastChecked ? ` · last checked ${ai.lastChecked}` : ""}. Checks run automatically every week; you can also run them now.</p>
      <div className="mb-6"><AiControls canEdit={canEdit} count={ai.rows.length} due={due} search={search} suggestions={suggestions} estimate={est} engines={engines} /></div>

      {ai.rows.length === 0 ? <EmptyState title="No questions tracked yet" body="Add the questions your customers would ask an AI assistant, or pick a suggestion above. Each check shows whether each assistant names, ranks and cites the business." /> : L.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">Questions added. They are checked in the next daily run, or press &quot;Check now&quot;.</p>
      ) : (
        <>
          <Highlights items={picks.slice(0, 4)} stableNote="No big change since the previous check." />
          <section aria-label="AI visibility summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Visibility" source="AI" format={(n) => (n == null ? "—" : `${n}%`)} value={vis} previous={prevVis} hint="Share of AI answers that name the business." />
            <KpiCard label="Top-3 visibility" source="AI" format={(n) => (n == null ? "—" : `${n}%`)} value={pctOf(positions.filter((p) => p <= 3).length, L.length)} previous={null} hint="Share of answers naming the business among the first three." />
            <KpiCard label="Average position" source="AI" format={(n) => (n == null ? "—" : `#${n.toFixed(1)}`)} value={avg(positions)} previous={null} higherIsBetter={false} hint="Where the business is named when it is named (1 = first)." />
            <KpiCard label="Latest position" source="AI" format={(n) => (n == null ? "—" : `#${n.toFixed(1)}`)} value={avg(latestPositions)} previous={null} higherIsBetter={false} hint={`From the answers checked on ${latestDay ?? "—"}.`} />
            <KpiCard label="Sentiment score" source="AI" format={(n) => (n == null ? "—" : n.toFixed(0))} value={avg(sentiments)} previous={null} hint="0-100 for how favourably the answers describe the business (50 = neutral)." />
            <KpiCard label="Your citations" source="AI" format={fmtInt} value={ownCitations} previous={null} hint={`Links to ${site} among ${fmtInt(citeRows.length)} sources cited.`} />
            <KpiCard label="Detection rate" source="AI" format={(n) => (n == null ? "—" : `${n}%`)} value={pctOf(detected, checkedQuestions)} previous={null} hint="Share of questions where at least one assistant names or cites the business." />
            <KpiCard label="Brands found" source="AI" format={fmtInt} value={brands.length} previous={null} hint="Different businesses named across the latest answers." />
          </section>

          <div className="mt-6">
            <Tabs label="AI visibility views" items={[
              {
                key: "overview", label: "Overview", content: (
                  <div className="space-y-6">
                    {visTrend.some((o) => o.data.length >= 2)
                      ? <MetricTrend title="Visibility over time (share of answers naming each brand, %)" source="AI" options={visTrend.filter((o) => o.data.length)} />
                      : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">The trend appears after the second weekly check.</p>}
                    <ResearchTable title="By assistant (latest answers)" rows={byEngine} pageSize={6} columns={[
                      { key: "engine", label: "Assistant" }, { key: "answers", label: "Answers", type: "int" }, { key: "named", label: "Named you", type: "int" },
                      { key: "cited", label: "Cited your site", type: "int" }, { key: "mention_rate", label: "Mention rate %", type: "int" }, { key: "citation_rate", label: "Citation rate %", type: "int" },
                      { key: "position", label: "Avg position", type: "dec" }, { key: "sentiment", label: "Sentiment", type: "dec" }, { key: "brands", label: "Brands per answer", type: "dec" }, { key: "sources", label: "Sources per answer", type: "dec" },
                    ]} />
                    <section className="space-y-2" aria-label="Google AI Overviews">
                      <h3 className="text-sm font-semibold">Google AI Overviews on your tracked keywords</h3>
                      {aio.length ? (
                        <ResearchTable title="AI Overviews (from Rank Tracking)" rows={aio} pageSize={10} facets={[{ key: "shown", label: "AI Overview shown" }, { key: "you", label: "You" }]}
                          columns={[{ key: "keyword", label: "Keyword" }, { key: "device", label: "Device", type: "badge" }, { key: "shown", label: "AI Overview", type: "badge" }, { key: "you", label: "Your site", type: "badge" }, { key: "sources", label: "Sources it cites" }, { key: "checked", label: "Checked", type: "date" }]}
                          note="Collected from the same Google searches as Rank Tracking, at no extra cost." />
                      ) : <p className="text-sm text-muted">Appears after the next Rank Tracking check (it reads the AI Overview from the same Google search).</p>}
                    </section>
                  </div>
                ),
              },
              {
                key: "competitors", label: "Competitors", badge: rivals.length, content: (
                  <div className="space-y-6">
                    <BubbleMap title="Competition map" xLabel="Detection rate (share of answers naming the brand)" yLabel="Average position"
                      items={brands.filter((b) => b.latestPosition != null).slice(0, 14).map((b) => ({ label: b.name, x: b.detection, y: b.latestPosition as number, size: b.mentions, highlight: b.own }))} />
                    <ResearchTable title="Competitor analysis" rows={brandRows} searchKeys={["name", "domain"]} initialSort={{ key: "mentions", dir: "desc" }} csvName={`ai-competitors-${site}`}
                      columns={[
                        { key: "name", label: "Brand" }, { key: "domain", label: "Website" }, { key: "latestPosition", label: "Latest position", type: "dec" }, { key: "avgPosition", label: "Avg position", type: "dec" },
                        { key: "detection", label: "Detection %", type: "int" }, { key: "top3", label: "Top 3 %", type: "int" }, { key: "mentions", label: "Mentions", type: "int" },
                        { key: "citations", label: "Citations", type: "int", hint: "Links to the brand's website among the cited sources" }, { key: "avgSentiment", label: "Avg sentiment", type: "int" },
                      ]} ranges={[{ key: "detection", label: "Detection %" }, { key: "mentions", label: "Mentions" }]}
                      note="Every business the assistants named in the latest answers. Sentiment is 0-100 (50 neutral)." />
                    {ai.topSources.length > 0 && <BarList title="Websites cited instead of you" valueLabel="Answers citing them" items={ai.topSources.map((s) => ({ label: s.domain, value: s.count }))} />}
                  </div>
                ),
              },
              {
                key: "citations", label: "Citations", badge: citeRows.length, content: (
                  <div className="space-y-6">
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {([["Total citations", citeRows.length], ["Unique URLs", new Set(citeRows.map((r) => r.url)).size], ["Unique domains", domCount.size], ["Brands found", brands.length], ["Most appearances", topDomains[0]?.[1] ?? 0]] as const).map(([l, v]) => (
                        <div key={l} className="rounded-xl border border-border bg-surface p-4"><dt className="text-xs text-muted">{l}</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{fmtInt(v)}</dd></div>
                      ))}
                    </dl>
                    <BarList title="Top cited domains" valueLabel="Citations" items={topDomains.slice(0, 20).map(([label, value]) => ({ label: label === site ? `${label} (you)` : label, value }))} />
                    <ResearchTable title="Cited pages" rows={citeRows} searchKeys={["url", "title", "question", "brands"]} facets={[{ key: "engine", label: "Assistant" }, { key: "yours", label: "Owner" }]} csvName={`ai-citations-${site}`}
                      columns={[{ key: "url", label: "Citation URL", type: "url" }, { key: "question", label: "Question" }, { key: "brands", label: "Brands named" }, { key: "engine", label: "Assistant", type: "badge" }, { key: "yours", label: "", type: "badge" }]}
                      note="Every source link in the latest answers. Gemini only reports the cited domain, not the exact page." />
                  </div>
                ),
              },
              {
                key: "sentiment", label: "Sentiment", content: (
                  <div className="space-y-6">
                    {sentTrend.some((o) => o.data.length >= 2)
                      ? <MetricTrend title="Sentiment over time by brand (0-100)" source="AI" options={sentTrend} />
                      : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">The sentiment trend appears after the second weekly check.</p>}
                    <ResearchTable title="Sentiment by brand and assistant" csvName={`ai-sentiment-${site}`} searchKeys={["brand"]} facets={[{ key: "engine", label: "Assistant" }]} initialSort={{ key: "mentions", dir: "desc" }}
                      rows={brands.flatMap((b) => (Object.entries(b.engines) as [EngineKey, { mentions: number; sentiment: number | null }][]).map(([e, v]) => ({
                        brand: b.own ? `${b.name} (you)` : b.name, engine: ENGINES[e].label, sentiment: v.sentiment, mentions: v.mentions,
                        tone: v.sentiment == null ? null : v.sentiment >= 60 ? "positive" : v.sentiment >= 40 ? "neutral" : "negative",
                      })))}
                      columns={[{ key: "brand", label: "Brand" }, { key: "engine", label: "Assistant", type: "badge" }, { key: "sentiment", label: "Sentiment", type: "int" }, { key: "tone", label: "Tone", type: "badge" }, { key: "mentions", label: "Mentions", type: "int" }]} />
                    <ResearchTable title="Positive, neutral and negative mentions" rows={brandRows} initialSort={{ key: "mentions", dir: "desc" }}
                      columns={[{ key: "name", label: "Brand" }, { key: "avgSentiment", label: "Avg sentiment", type: "int" }, { key: "positive", label: "Positive", type: "int" }, { key: "neutral", label: "Neutral", type: "int" }, { key: "negative", label: "Negative", type: "int" }, { key: "mentions", label: "Mentions", type: "int" }]} />
                  </div>
                ),
              },
              {
                key: "answers", label: "Questions & answers", badge: ai.rows.length, content: (
                  <ul className="space-y-2">
                    {ai.rows.map((r) => (
                      <li key={r.id}>
                        <details className="rounded-xl border border-border bg-surface">
                          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                            <span className="min-w-0 flex-1 font-medium">{r.prompt}</span>
                            <span className="flex flex-wrap gap-3">{engines.map((e) => <span key={e} className="inline-flex items-center gap-1 text-xs"><span className="text-muted">{ENGINES[e].label}:</span><Status c={r.byEngine[e]} /></span>)}</span>
                          </summary>
                          <div className="space-y-4 border-t border-border px-4 py-3 text-sm">
                            {(Object.entries(r.byEngine) as [EngineKey, AiCheck][]).map(([e, c]) => (
                              <div key={e} className="space-y-1.5">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{ENGINES[e].label} · {c.checked_on} · {c.model}</p>
                                {c.brands.length > 0 && <p className="flex flex-wrap gap-1 text-xs">{c.brands.map((b) => <span key={`${b.position}-${b.name}`} className={`rounded px-1.5 py-0.5 ${b.own ? "bg-accent text-accent-foreground" : "bg-surface-muted"}`}>#{b.position} {b.name}{b.sentiment != null ? ` · ${b.sentiment}` : ""}</span>)}</p>}
                                <p className="whitespace-pre-line text-muted">{c.answer ?? "No answer text."}</p>
                                {c.sources.length > 0 && <ul className="space-y-0.5 text-xs">{c.sources.slice(0, 8).map((s) => <li key={s.url} className="break-all"><a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{s.title ?? s.domain}</a> <span className="text-muted">· {s.domain}</span></li>)}</ul>}
                              </div>
                            ))}
                            {canEdit && <div className="flex justify-end"><RemoveButton kind="ai" id={r.id} label={r.prompt} /></div>}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]} />
          </div>
        </>
      )}
    </>
  );
}
