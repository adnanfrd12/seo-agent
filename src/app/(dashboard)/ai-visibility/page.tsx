import { CheckCircle2, CircleDashed, Eye, Link2 } from "lucide-react";
import { Columns, Donut, Gauge, Heatmap, MultiLine, Panel, StackedBars, Themes, type LineMetric } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { BubbleMap } from "@/components/charts/bubble-map";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Fill, SplitBar, StackedColumns } from "@/components/charts/ops-charts";
import { MarketRefreshButton } from "@/components/market/refresh-button";
import { Highlights } from "@/components/dashboard/highlights";
import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { Tabs } from "@/components/research/tabs";
import { AiControls, RemoveButton } from "@/components/research/tracking-controls";
import { getSession } from "@/lib/analytics/client-context";
import {
  AI_EVERY_DAYS, brandKey, brandStats, ENGINE_KEYS, ENGINES, enginesFrom, loadAi, promptEstimate, suggestPrompts, type AiCheck, type EngineKey,
} from "@/lib/ai/visibility";
import { BRAND_EST, BRAND_VIEW_LABEL, BRAND_VIEWS, LLM_LABEL, LLM_PLATFORMS, type BrandHistory, type BrandLookup, type BrandView, type LlmTopic } from "@/lib/ai/llm-mentions";
import { fmtInt } from "@/lib/analytics/format";
import { cat } from "@/lib/charts/colors";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadRanks } from "@/lib/dataforseo/rank";
import { loadCache, resolveTarget } from "@/lib/dataforseo/research";
import type { Highlight } from "@/lib/overview/highlights";
import { memo } from "@/lib/memo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300; // a manual check asks several assistants per question

type Row = Record<string, unknown>;
const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const avg = (l: number[]) => (l.length ? Number((l.reduce((a, b) => a + b, 0) / l.length).toFixed(1)) : null);
const onSite = (h: string, site: string) => !!h && !!site && (h === site || h.endsWith(`.${site}`));
const countList = (l: string[], n = 8) => { const m = new Map<string, number>(); for (const x of l) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count })); };

function Status({ c }: { c: AiCheck | undefined }) {
  if (!c) return <span className="inline-flex items-center gap-1 text-xs text-muted"><CircleDashed className="size-3.5" aria-hidden /> Not checked</span>;
  if (c.mentioned && c.cited) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><CheckCircle2 className="size-3.5" aria-hidden /> Named{c.position ? ` #${c.position}` : ""} + cited</span>;
  if (c.mentioned) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><CheckCircle2 className="size-3.5" aria-hidden /> Named{c.position ? ` #${c.position}` : ""}</span>;
  if (c.cited) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><Link2 className="size-3.5" aria-hidden /> Cited</span>;
  if (c.seen) return <span className="inline-flex items-center gap-1 text-xs font-medium text-warn"><Eye className="size-3.5" aria-hidden /> Seen, not used</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-negative"><CircleDashed className="size-3.5" aria-hidden /> Not visible</span>;
}

export default async function AiVisibilityPage() {
  const { client, user } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const header = <TabHeader source={null} title="AI Visibility" description="How ChatGPT, Perplexity, Gemini, Google AI Mode and Claude answer your customers' questions: who they name, in what order, how they describe them, and which sites they cite." guide={[
    { term: "Visibility", text: "Share of answers (question × assistant) that name the business." },
    { term: "Position", text: "Order in which the business is named: #1 = first." },
    { term: "Detection rate", text: "Share of questions where at least one assistant names the business." },
    { term: "Sentiment", text: "0-100: how favourably the answer describes a brand (50 = neutral)." },
  ]} />;
  if (!process.env.ANTHROPIC_API_KEY) return <>{header}<EmptyState title="AI isn't configured" body="Add ANTHROPIC_API_KEY to the environment (and Vercel), then redeploy." /></>;

  const supabase = await createClient();
  // every read in one parallel batch
  const [ai, target, { data: settings }, cache, ranks] = await memo(`ai-vis|${user.id}|${client.id}`, 120_000, () => Promise.all([
    loadAi(supabase, client.id), resolveTarget(createAdminClient(), client.id),
    supabase.from("clients").select("settings").eq("id", client.id).maybeSingle(), loadCache(supabase, client.id), loadRanks(supabase, client.id),
  ]));
  if (!ai.ok) return <>{header}<EmptyState title="AI visibility needs one database update" body="Apply the latest database migrations in the Supabase SQL editor, then reload this page." /></>;
  if (!target) return <>{header}<EmptyState title="No website to check yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const search = (settings?.settings as { ai_search?: boolean } | null)?.ai_search !== false;
  const engines = enginesFrom(settings?.settings);
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
  const aio: Row[] = ranks.ok ? ranks.rows.filter((r) => r.serp).map((r) => ({
    keyword: r.keyword, device: r.device, shown: r.serp!.ai_overview.length ? "Yes" : "No",
    you: r.serp!.ai_overview.some((a) => (a.domain ?? "").replace(/^www\./, "").endsWith(site)) ? "Cited" : r.serp!.ai_overview.length ? "Not cited" : "—",
    sources: r.serp!.ai_overview.map((a) => a.domain).filter(Boolean).join(", "), checked: r.checkedOn,
  })) : [];

  // ---- charts: colours follow the entity (you = slot 1, then competitors by mentions; assistants by their fixed order)
  const shown = [...(me ? [me] : []), ...rivals].slice(0, 7);
  const slot = new Map(shown.map((b, i) => [b.own ? "__you__" : brandKey(b), i]));
  const brandLabel = (b: { name: string; own: boolean }) => (b.own ? `${b.name} (you)` : b.name);
  const engineColor = (e: EngineKey) => cat(ENGINE_KEYS.indexOf(e));
  const usedEngines = ENGINE_KEYS.filter((e) => L.some((c) => c.engine === e));
  const engineKeys = usedEngines.map((e) => ({ key: e, label: ENGINES[e].label, color: engineColor(e) }));
  const hasBrand = (c: AiCheck, b: { name: string; own: boolean }) => (b.own ? c.mentioned || c.brands.some((x) => x.own) : c.brands.some((x) => !x.own && brandKey(x) === brandKey(b)));
  const brandIn = (c: AiCheck, b: { name: string; own: boolean }) => c.brands.find((x) => (b.own ? x.own : !x.own && brandKey(x) === brandKey(b)));

  // performance over time, one point per check date
  const weeks = [...new Set(ai.checks.map((c) => c.checked_on))].sort();
  const inWeek = new Map(weeks.map((w) => [w, ai.checks.filter((c) => c.checked_on === w)]));
  const perf = (fn: (list: AiCheck[], b: (typeof shown)[number]) => number | null) =>
    shown.map((b, i) => ({ key: `b${i}`, label: brandLabel(b), color: cat(i), data: weeks.map((w) => ({ date: w, value: fn(inWeek.get(w) ?? [], b) })) }));
  const perfMetrics: LineMetric[] = [
    { key: "vis", label: "Visibility", unit: "%", series: perf((l, b) => pctOf(l.filter((c) => hasBrand(c, b)).length, l.length)) },
    { key: "top3", label: "Top-3 visibility", unit: "%", series: perf((l, b) => pctOf(l.filter((c) => (brandIn(c, b)?.position ?? 99) <= 3).length, l.length)) },
    { key: "pos", label: "Average position", reverse: true, series: perf((l, b) => avg(l.map((c) => brandIn(c, b)?.position).filter((p): p is number => p != null))) },
    { key: "sent", label: "Sentiment", series: perf((l, b) => avg(l.map((c) => brandIn(c, b)?.sentiment).filter((p): p is number => p != null))) },
    { key: "mentions", label: "Mentions", series: perf((l, b) => l.filter((c) => hasBrand(c, b)).length) },
    { key: "cites", label: "Citations", series: perf((l, b) => { const d = b.own ? site : b.domain; return d ? l.reduce((a, c) => a + c.sources.filter((x) => onSite(x.domain, d)).length, 0) : null; }) },
    { key: "mention_rate", label: "Mention rate %", unit: "%", series: perf((l, b) => pctOf(l.filter((c) => (b.own ? c.mentioned : !!brandIn(c, b))).length, l.length)) },
    { key: "citation_rate", label: "Citation rate %", unit: "%", series: perf((l, b) => { const d = b.own ? site : b.domain; return d ? pctOf(l.filter((c) => c.sources.some((x) => onSite(x.domain, d))).length, l.length) : null; }) },
  ];
  // answers that name a competitor but not you: the clearest openings
  const gapAnswers = L.filter((c) => c.brands.some((b) => !b.own) && !c.mentioned && !c.brands.some((b) => b.own)).length;
  const citedAnswers = L.filter((c) => c.cited).length;

  // share of voice (mentions) and where you are named
  const sovTotal = brands.reduce((a, b) => a + b.mentions, 0);
  const sov = shown.slice(0, 5).map((b) => ({ label: brandLabel(b), value: b.mentions, color: cat(slot.get(b.own ? "__you__" : brandKey(b)) ?? 8) }));
  const sovRest = sovTotal - sov.reduce((a, x) => a + x.value, 0);
  if (sovRest > 0) sov.push({ label: "Other brands", value: sovRest, color: "var(--cat-other)" });
  const posBins = [
    { label: "#1", value: positions.filter((p) => p === 1).length, highlight: true }, { label: "#2", value: positions.filter((p) => p === 2).length, highlight: true },
    { label: "#3", value: positions.filter((p) => p === 3).length, highlight: true }, { label: "#4-5", value: positions.filter((p) => p >= 4 && p <= 5).length },
    { label: "#6-10", value: positions.filter((p) => p >= 6 && p <= 10).length }, { label: "#11+", value: positions.filter((p) => p > 10).length },
  ];
  // detection by brand and assistant
  const heatBrands = [...(me ? [me] : []), ...rivals.slice(0, 9)];
  const detectCells = heatBrands.map((b) => usedEngines.map((e) => { const l = L.filter((c) => c.engine === e); return l.length ? pctOf(l.filter((c) => hasBrand(c, b)).length, l.length) : null; }));
  const sentCells = heatBrands.map((b) => usedEngines.map((e) => b.engines[e]?.sentiment ?? null));
  const sovByEngine = heatBrands.map((b) => ({ label: brandLabel(b), values: Object.fromEntries(usedEngines.map((e) => [e, b.engines[e]?.mentions ?? 0])) }));
  // your sentiment per assistant
  const ownSentiment = usedEngines.map((e) => ({ e, v: avg(L.filter((c) => c.engine === e).map((c) => c.sentiment).filter((x): x is number => x != null)), n: L.filter((c) => c.engine === e && c.sentiment != null).length }));
  // themes and descriptions
  const ownBrands = L.flatMap((c) => c.brands.filter((b) => b.own).map((b) => ({ ...b, engine: c.engine, prompt: c.prompt_id })));
  const praised = countList(ownBrands.flatMap((b) => b.praised ?? []));
  const criticised = countList(ownBrands.flatMap((b) => b.criticised ?? []));
  const rivalThemes = rivals.slice(0, 8).map((b) => {
    const hits = L.flatMap((c) => c.brands.filter((x) => !x.own && brandKey(x) === brandKey(b)));
    return { brand: b.name, praised: countList(hits.flatMap((x) => x.praised ?? []), 3).map((t) => t.label).join(", "), criticised: countList(hits.flatMap((x) => x.criticised ?? []), 3).map((t) => t.label).join(", "), described: hits.find((x) => x.note)?.note ?? "", sentiment: b.avgSentiment };
  });
  const descriptions: Row[] = ownBrands.filter((b) => b.note).map((b) => ({ engine: ENGINES[b.engine].label, note: b.note, sentiment: b.sentiment, position: b.position, question: ai.rows.find((r) => r.id === b.prompt)?.prompt ?? "" }));
  const tonePct = heatBrands.map((b) => {
    const n = b.positive + b.neutral + b.negative;
    return { label: brandLabel(b), values: { positive: b.positive, neutral: b.neutral, negative: b.negative }, note: n ? `${Math.round((b.positive / n) * 100)}% positive` : "" };
  });

  // citations by domain and assistant, and over time
  const citeByEngine = topDomains.slice(0, 20).map(([d]) => ({ label: d === site ? `${d} (you)` : d, values: Object.fromEntries(usedEngines.map((e) => [e, L.filter((c) => c.engine === e).reduce((a, c) => a + c.sources.filter((x) => x.domain === d).length, 0)])) }));
  const citeTrend: LineMetric[] = [{ key: "c", label: "Citations", series: topDomains.slice(0, 6).map(([d], i) => ({ key: `d${i}`, label: d, color: cat(i), data: weeks.map((w) => ({ date: w, value: (inWeek.get(w) ?? []).reduce((a, c) => a + c.sources.filter((x) => x.domain === d).length, 0) })) })) }];
  const domainRows: Row[] = topDomains.map(([d, n]) => {
    const rows = citeRows.filter((r) => r.domain === d);
    return { domain: d, citations: n, urls: new Set(rows.map((r) => r.url)).size, engines: [...new Set(rows.map((r) => r.engine as string))].join(", "), questions: new Set(rows.map((r) => r.question)).size, brands: [...new Set(rows.flatMap((r) => String(r.brands).split(", ").filter(Boolean)))].slice(0, 6).join(", "), yours: onSite(d, site) ? "Your site" : "" };
  });

  // AI market (DataForSEO LLM Mentions), refreshed weekly
  const marketAll = LLM_PLATFORMS.map((p) => ({ p, d: cache.get<LlmTopic>(`llm_topic_${p}`) })).filter((x) => x.d?.data);
  const market = marketAll.filter((x) => x.d!.data.mentions > 0);
  // single platform: what kind of brands it names (categories), else which brands, else each site's share of the citations
  const one = market.length === 1 ? market[0].d!.data : null;
  const [mixSrc, marketMixTitle, marketMixSub]: [LlmTopic["domains"], string, string] = !one ? [[], "", ""]
    : one.categories.length ? [one.categories, "Brand categories AI names", "Mentions by category"]
    : one.brands.length ? [one.brands, "Brands AI names", "Mentions by brand"]
    : [one.domains.length ? one.domains : one.sources, "Share of citations", "Each site's share of the cited answers"];
  const marketMixTotal = mixSrc.reduce((a, g) => a + g.mentions, 0);
  const marketMix = mixSrc.slice(0, 5).map((g, i) => ({ label: onSite(g.key, site) ? `${g.key} (you)` : g.key, value: g.mentions, color: cat(i) }));
  if (mixSrc.length > 5) marketMix.push({ label: "Other", value: mixSrc.slice(5).reduce((a, g) => a + g.mentions, 0), color: "var(--cat-other)" });

  // brand lookup (DataForSEO LLM Mentions): the brand and up to three competitor brands in real AI answers
  const lookup = BRAND_VIEWS.map((v) => ({ v, d: cache.get<BrandLookup>(`llm_brand_${v}`) })).filter((x) => x.d?.data?.brands?.length && x.d.data.view === x.v);
  const brandHist = cache.get<BrandHistory>("llm_brand_history");
  const lookupBrands = lookup[0]?.d!.data.brands.map((b) => ({ brand: b.brand, own: b.own })) ?? [];
  const metricOf = (v: BrandView, brand: string) => lookup.find((x) => x.v === v)?.d!.data.brands.find((x) => x.brand === brand);
  const entityAll = lookupBrands.reduce((a, b) => a + (metricOf("entities", b.brand)?.mentions ?? 0), 0);
  const lookupRows: Row[] = lookupBrands.map((b) => ({
    brand: b.own ? `${b.brand} (you)` : b.brand, ...Object.fromEntries(lookup.flatMap(({ v }) => [[`${v}_m`, metricOf(v, b.brand)?.mentions ?? 0], [`${v}_v`, metricOf(v, b.brand)?.volume ?? null]])),
    share: entityAll ? Math.round(((metricOf("entities", b.brand)?.mentions ?? 0) / entityAll) * 1000) / 10 : 0,
  }));
  const lookupSov = lookupBrands.map((b, i) => ({ label: b.own ? `${b.brand} (you)` : b.brand, value: metricOf("entities", b.brand)?.mentions ?? 0, color: cat(i) }));
  const ownBrand = lookupBrands.find((b) => b.own)?.brand ?? "";
  const ownLookup = lookup.map(({ v }) => ({ v, b: metricOf(v, ownBrand) }));
  const lookupAt = [...lookup.map((x) => x.d!.fetchedAt), brandHist?.fetchedAt].filter(Boolean).sort().at(-1)?.slice(0, 10) ?? null;
  const histMonths = brandHist?.data?.months ?? [];
  const histLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

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
      <p className="mb-5 text-sm"><span className="font-semibold">{site}</span><span className="text-muted"> · {ai.rows.length} questions × {engines.length} assistants{ai.lastChecked ? ` · checked ${ai.lastChecked}` : ""} · refreshes weekly</span></p>

      {ai.rows.length === 0 ? <EmptyState title="No questions tracked yet" body="Questions are added automatically in the next daily run, or add your own below." /> : L.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border p-6 text-sm text-muted">Questions added. They are checked in the next daily run.</p>
      ) : (
        <>
          <section aria-label="AI visibility summary" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Visibility" value={vis == null ? "—" : `${vis}%`} sub={prevVis != null && prevVis !== vis ? `was ${prevVis}%` : "of answers name you"} tone={vis ? "good" : "bad"} />
            <StatCard label="Top-3 visibility" value={`${pctOf(positions.filter((p) => p <= 3).length, L.length) ?? 0}%`} sub="named in the first three" />
            <StatCard label="Average position" value={avg(positions) == null ? "—" : `#${avg(positions)!.toFixed(1)}`} sub={me?.avgPosition != null ? `all checks: #${me.avgPosition}` : "when named"} />
            <StatCard label="Detection rate" value={`${pctOf(detected, checkedQuestions) ?? 0}%`} sub={`${detected} of ${checkedQuestions} questions`} />
            <StatCard label="Sentiment" value={avg(sentiments) == null ? "—" : avg(sentiments)!.toFixed(0)} sub="0-100 · 50 neutral" />
            <StatCard label="Your citations" value={fmtInt(ownCitations)} sub={`of ${fmtInt(citeRows.length)} sources`} />
            <StatCard label="Answers" value={fmtInt(L.length)} sub={`${ai.rows.length} questions × ${engines.length} assistants`} />
            <StatCard label="Brands found" value={fmtInt(brands.length)} sub={rivals[0] ? `most named: ${rivals[0].name}` : undefined} />
            <StatCard label="Citation rate" value={`${pctOf(citedAnswers, L.length) ?? 0}%`} sub={`${citedAnswers} of ${L.length} answers cite your site`} tone={citedAnswers ? "good" : undefined} />
            <StatCard label="Competitor gap" value={fmtInt(gapAnswers)} sub={`answers name a competitor, not you (${pctOf(gapAnswers, L.length) ?? 0}%)`} tone={gapAnswers ? "warn" : undefined} />
          </section>
          {picks.length > 0 && <div className="mt-6"><Highlights items={picks.slice(0, 4)} /></div>}

          <div className="mt-6">
            <Tabs label="AI visibility views" items={[
              {
                key: "overview", label: "Overview", content: (
                  <div className="space-y-6">
                    <div className="grid gap-4 lg:grid-cols-3">
                      <Panel title="Sentiment score" sub="How favourably assistants describe you, 0-100">
                        <Gauge value={avg(sentiments)} label="All assistants" sub={`${sentiments.length} answer${sentiments.length === 1 ? "" : "s"} naming you`} />
                        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-3 text-[13px]">
                          {ownSentiment.map((o) => <div key={o.e} className="flex items-center justify-between gap-2"><span className="inline-flex min-w-0 items-center gap-1.5 truncate text-secondary"><span className="size-2 shrink-0 rounded-[2px]" style={{ background: engineColor(o.e) }} />{ENGINES[o.e].label}</span><span className="tabular-nums">{o.v == null ? "—" : Math.round(o.v)}</span></div>)}
                        </div>
                      </Panel>
                      <Fill><Donut title="Share of voice" sub="Share of all brand mentions in the latest answers" items={sov} center={sovTotal && me ? `${Math.round((me.mentions / sovTotal) * 100)}%` : "0%"} centerLabel="you" /></Fill>
                      <Columns title="Where you are named" sub={`Your position when named · not named in ${L.length - named.length} of ${L.length} answers`} bins={posBins} valueLabel="Answers" />
                    </div>
                    <MultiLine title="Performance over time" sub="Each check, you and the most-named competitors" metrics={perfMetrics} initialHidden={shown.slice(5).map((_, i) => `b${i + 5}`)} />
                    {visTrend.some((o) => o.data.length >= 2) && <MetricTrend title="Visibility over time, one brand at a time (share of answers naming it, %)" source="AI" options={visTrend.filter((o) => o.data.length)} />}
                    <Heatmap title="Visibility by assistant" sub="Share of each assistant's answers that name the brand, %" rows={heatBrands.map(brandLabel)} cols={usedEngines.map((e) => ENGINES[e].label)} cells={detectCells} max={100} unit="%" />
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
 />
                      ) : <p className="text-sm text-muted">Appears after the next Rank Tracking check.</p>}
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
                      ]} ranges={[{ key: "detection", label: "Detection %" }, { key: "mentions", label: "Mentions" }]} />
                    <StackedBars title="Mentions by brand and assistant" sub="Who each assistant recommends" keys={engineKeys} rows={sovByEngine} valueLabel="Mentions" />
                    {ai.topSources.length > 0 && <BarList title="Websites cited instead of you" valueLabel="Answers citing them" items={ai.topSources.map((s) => ({ label: s.domain, value: s.count }))} />}
                    <section className="space-y-3" aria-label="Brand lookup">
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold">Brand lookup</h3>
                          <p className="text-xs text-muted">How often real US AI answers name your brand and the competitor brands the assistants name most (DataForSEO LLM Mentions){lookupAt ? ` · updated ${lookupAt}` : ""}. Refreshes weekly. “Named as a brand” counts ChatGPT answers that recognise the name as a business; “phrase in answer” counts the words anywhere in the answer, so a name that is also an everyday phrase is counted wherever the phrase appears.</p>
                        </div>
                        {canEdit && <MarketRefreshButton action="brand" label="Fetch brand lookup" estimate={`≈$${(4 * BRAND_EST).toFixed(2)}`} />}
                      </div>
                      {lookup.length === 0 ? <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Appears after the next weekly run{canEdit ? " (or “Fetch brand lookup”)" : ""}.</p> : (
                        <>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {ownLookup.map(({ v, b }) => (
                              <StatCard key={v} label={BRAND_VIEW_LABEL[v]} value={fmtInt(b?.mentions ?? 0)} sub={b?.volume ? `${fmtInt(b.volume)} AI search volume` : b?.mentions ? "answers" : `${ownBrand} is not named`} tone={v === "entities" ? (b?.mentions ? "good" : "bad") : undefined} />
                            ))}
                          </div>
                          <div className={`grid gap-4 ${histMonths.length ? "lg:grid-cols-2" : ""}`}>
                            <Donut title="Share of voice in ChatGPT" sub="Answers naming each brand as a business (brand entities)" items={lookupSov}
                              center={entityAll ? `${Math.round(((metricOf("entities", ownBrand)?.mentions ?? 0) / entityAll) * 100)}%` : "0%"} centerLabel="you" />
                            {histMonths.length > 0 && <StackedColumns title={`${brandHist!.data.brand} named in ChatGPT, by month`} sub="Answers naming the brand as a business, since August 2025" valueLabel="Answers"
                              keys={[{ key: "m", label: "Answers", color: "var(--series)" }]} columns={histMonths.map((m) => ({ label: histLabel(m.month), values: { m: m.mentions } }))} empty={`${brandHist!.data.brand} has not been named as a brand in ChatGPT answers since August 2025.`} />}
                          </div>
                          <ResearchTable title="Brand lookup" rows={lookupRows} initialSort={{ key: "entities_m", dir: "desc" }} pageSize={6}
                            columns={[{ key: "brand", label: "Brand" }, ...lookup.flatMap(({ v }) => [{ key: `${v}_m`, label: BRAND_VIEW_LABEL[v], type: "int" as const }, { key: `${v}_v`, label: "AI search volume", type: "int" as const }]), { key: "share", label: "Share of voice % (ChatGPT, as a brand)", type: "dec" }]} />
                        </>
                      )}
                    </section>
                    <section className="space-y-3" aria-label="AI market">
                      <div>
                        <h3 className="text-sm font-semibold">AI market for your topics</h3>
                        <p className="text-xs text-muted">From millions of real US ChatGPT and Google AI Overview answers (DataForSEO LLM Mentions){marketAll[0]?.d ? ` · topic: ${marketAll[0].d.data.topics.join(", ")} · updated ${marketAll[0].d.fetchedAt.slice(0, 10)}` : ""}. Refreshes weekly.</p>
                      </div>
                      {market.length === 0 ? <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">{marketAll.length ? "No AI answers were found for this topic yet. It is checked again next week." : "Appears after the next weekly run (or “Check now” below)."}</p> : (
                        <>
                          {market.length === 1 ? (
                            // one platform: its stats and what it names sit beside the cited-sites list instead of two full-width rows
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                              <div className="flex min-w-0 flex-col gap-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <StatCard label={`${LLM_LABEL[market[0].p]} answers`} value={fmtInt(market[0].d!.data.mentions)} sub="on these topics" />
                                  <StatCard label="AI search volume" value={market[0].d!.data.volume == null ? "—" : fmtInt(market[0].d!.data.volume)} sub={market[0].d!.data.domains.some((x) => onSite(x.key, site)) ? "you are cited" : "you are not cited yet"} tone={market[0].d!.data.domains.some((x) => onSite(x.key, site)) ? "good" : undefined} />
                                </div>
                                {marketMix.length > 0 && <Fill className="flex-1"><Donut title={marketMixTitle} sub={`${marketMixSub} in ${LLM_LABEL[market[0].p]}`} items={marketMix} center={fmtInt(marketMixTotal)} centerLabel={marketMixTitle === "Share of citations" ? "citations" : "mentions"} /></Fill>}
                              </div>
                              <BarList title={`Most-cited sites in ${LLM_LABEL[market[0].p]}`} valueLabel="Answers citing them" items={(market[0].d!.data.domains.length ? market[0].d!.data.domains : market[0].d!.data.sources).slice(0, 10).map((x) => ({ label: onSite(x.key, site) ? `${x.key} (you)` : x.key, value: x.mentions, detail: x.volume == null ? undefined : `${fmtInt(x.volume)} vol` }))} />
                            </div>
                          ) : <>
                          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            {market.map(({ p, d }) => (
                              <div key={p} className="contents">
                                <StatCard label={`${LLM_LABEL[p]} answers`} value={fmtInt(d!.data.mentions)} sub="on these topics" />
                                <StatCard label={`${LLM_LABEL[p]} AI search volume`} value={d!.data.volume == null ? "—" : fmtInt(d!.data.volume)} sub={d!.data.domains.some((x) => onSite(x.key, site)) ? "you are cited" : "you are not cited yet"} tone={d!.data.domains.some((x) => onSite(x.key, site)) ? "good" : undefined} />
                              </div>
                            ))}
                          </div>
                          <div className="grid gap-4 lg:grid-cols-2">
                            {market.map(({ p, d }) => <BarList key={p} title={`Most-cited sites in ${LLM_LABEL[p]}`} valueLabel="Answers citing them" items={(d!.data.domains.length ? d!.data.domains : d!.data.sources).slice(0, 10).map((x) => ({ label: onSite(x.key, site) ? `${x.key} (you)` : x.key, value: x.mentions, detail: x.volume == null ? undefined : `${fmtInt(x.volume)} vol` }))} />)}
                          </div>
                          </>}
                          {marketAll.length > market.length && <p className="text-xs text-muted">No {marketAll.filter((x) => !market.includes(x)).map((x) => LLM_LABEL[x.p]).join(" or ")} answers were found for this topic yet.</p>}
                          {market.some(({ d }) => d!.data.brands.length) && (
                            <ResearchTable title="Brands and products AI names on these topics" rows={market.flatMap(({ p, d }) => d!.data.brands.map((b) => ({ brand: b.key, platform: LLM_LABEL[p], mentions: b.mentions, volume: b.volume })))} initialSort={{ key: "mentions", dir: "desc" }} pageSize={10}
                              columns={[{ key: "brand", label: "Brand or product" }, { key: "platform", label: "Platform", type: "badge" }, { key: "mentions", label: "Answers", type: "int" }, { key: "volume", label: "AI search volume", type: "int" }]} />
                          )}
                        </>
                      )}
                    </section>
                  </div>
                ),
              },
              {
                key: "citations", label: "Citations", badge: citeRows.length, content: (
                  <div className="space-y-6">
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {([["Total citations", citeRows.length], ["Unique URLs", new Set(citeRows.map((r) => r.url)).size], ["Unique domains", domCount.size], ["Brands found", brands.length], ["Most appearances", topDomains[0]?.[1] ?? 0]] as const).map(([l, v]) => (
                        <div key={l} className="rounded-[10px] border border-border bg-surface p-4"><dt className="text-xs text-muted">{l}</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{fmtInt(v)}</dd></div>
                      ))}
                    </dl>
                    <StackedBars title="Top 20 cited domains" sub="Citations in the latest answers, split by assistant" keys={engineKeys} rows={citeByEngine} valueLabel="Citations" />
                    <MultiLine title="Citations over time by top domain" sub="Each check" metrics={citeTrend} />
                    <ResearchTable title="Domain overview" rows={domainRows} searchKeys={["domain", "brands"]} facets={[{ key: "yours", label: "Owner" }]} initialSort={{ key: "citations", dir: "desc" }} csvName={`ai-cited-domains-${site}`}
                      columns={[{ key: "domain", label: "Domain" }, { key: "citations", label: "Citations", type: "int" }, { key: "urls", label: "Unique URLs", type: "int" }, { key: "questions", label: "Questions", type: "int" }, { key: "engines", label: "Assistants" }, { key: "brands", label: "Brands named alongside" }, { key: "yours", label: "", type: "badge" }]} />
                    <ResearchTable title="Cited pages" rows={citeRows} searchKeys={["url", "title", "question", "brands"]} facets={[{ key: "engine", label: "Assistant" }, { key: "yours", label: "Owner" }]} csvName={`ai-citations-${site}`}
                      columns={[{ key: "url", label: "Citation URL", type: "url" }, { key: "question", label: "Question" }, { key: "brands", label: "Brands named" }, { key: "engine", label: "Assistant", type: "badge" }, { key: "yours", label: "", type: "badge" }]} />
                  </div>
                ),
              },
              {
                key: "sentiment", label: "Sentiment", content: (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                      <div className="col-span-2 rounded-[10px] border border-border bg-surface p-4 sm:col-span-1"><Gauge value={avg(sentiments)} label="You, all assistants" /></div>
                      {ownSentiment.map((o) => <div key={o.e} className="rounded-[10px] border border-border bg-surface p-4"><Gauge value={o.v} label={ENGINES[o.e].label} empty="Not named" sub={`${o.n} answer${o.n === 1 ? "" : "s"} naming you`} /></div>)}
                    </div>
                    <MultiLine title="Sentiment over time by brand" sub="Average per check, 0-100 (50 = neutral)" metrics={[perfMetrics.find((m) => m.key === "sent")!]} initialHidden={shown.slice(5).map((_, i) => `b${i + 5}`)} />
                    <div className="grid gap-4 xl:grid-cols-2">
                      <Heatmap title="Sentiment by brand and assistant" sub="Average 0-100 · green above 50, red below" rows={heatBrands.map(brandLabel)} cols={usedEngines.map((e) => ENGINES[e].label)} cells={sentCells} scale="div" />
                      <div className="flex min-w-0 flex-col gap-4">
                        <StackedBars title="Positive, neutral and negative mentions" sub="Share of each brand's mentions" percent valueLabel="Positive share" rows={tonePct}
                          keys={[{ key: "positive", label: "Positive (60+)", color: "var(--positive)" }, { key: "neutral", label: "Neutral (40-59)", color: "var(--cat-other)" }, { key: "negative", label: "Negative (under 40)", color: "var(--negative)" }]} />
                        <Fill className="flex-1"><SplitBar title="How you are described" sub="Tone of every mention of you, all assistants" empty="Not named in the latest answers."
                          total={me && me.positive + me.neutral + me.negative ? `${Math.round((me.positive / (me.positive + me.neutral + me.negative)) * 100)}%` : undefined} totalLabel="positive"
                          segments={[{ label: "Positive", value: me?.positive ?? 0, color: "var(--positive)" }, { label: "Neutral", value: me?.neutral ?? 0, color: "var(--cat-other)" }, { label: "Negative", value: me?.negative ?? 0, color: "var(--negative)" }]} /></Fill>
                      </div>
                    </div>
                    <Themes title="What assistants say about you" sub="Themes in the answers that name you" praised={praised} criticised={criticised} />
                    {descriptions.length > 0 && (
                      <ResearchTable title="How each assistant describes you" rows={descriptions} searchKeys={["note", "question"]} facets={[{ key: "engine", label: "Assistant" }]} initialSort={{ key: "sentiment", dir: "desc" }} pageSize={8}
                        columns={[{ key: "note", label: "Description" }, { key: "engine", label: "Assistant", type: "badge" }, { key: "sentiment", label: "Sentiment", type: "int" }, { key: "position", label: "Position", type: "int" }, { key: "question", label: "Question" }]} />
                    )}
                    {rivalThemes.some((r) => r.praised || r.criticised || r.described) && (
                      <ResearchTable title="What assistants say about competitors" rows={rivalThemes} searchKeys={["brand"]} pageSize={8}
                        columns={[{ key: "brand", label: "Brand" }, { key: "sentiment", label: "Avg sentiment", type: "int" }, { key: "described", label: "Described as" }, { key: "praised", label: "Praised for" }, { key: "criticised", label: "Criticised for" }]} />
                    )}
                    {sentTrend.some((o) => o.data.length >= 2) && <MetricTrend title="Sentiment over time, one brand at a time (0-100)" source="AI" options={sentTrend} />}
                    <ResearchTable title="Sentiment by brand and assistant (table)" csvName={`ai-sentiment-${site}`} searchKeys={["brand"]} facets={[{ key: "engine", label: "Assistant" }]} initialSort={{ key: "mentions", dir: "desc" }}
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
                        <details className="rounded-[10px] border border-border bg-surface">
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
                                {c.sources.length > 0 && <ul className="space-y-0.5 text-xs">{c.sources.slice(0, 8).map((s) => <li key={s.url} className="break-all"><a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">{s.title ?? s.domain}</a> <span className="text-muted">· {s.domain}</span></li>)}</ul>}
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

      {canEdit && (
        <details className="mt-8 rounded-[10px] border border-border bg-surface p-4" open={ai.rows.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">Manage questions and assistants</summary>
          <div className="mt-3"><AiControls canEdit={canEdit} count={ai.rows.length} due={due} search={search} suggestions={suggestions} estimate={est} engines={engines} /></div>
        </details>
      )}
    </>
  );
}
