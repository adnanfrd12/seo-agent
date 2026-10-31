import { Donut } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { FillColumns } from "@/components/charts/research-charts";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Highlights } from "@/components/dashboard/highlights";
import { KpiCard, StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine } from "@/components/research/chrome";
import { ResearchTable } from "@/components/research/research-table";
import { PinButton, RankControls, RankSchedulePicker, RemoveButton } from "@/components/research/tracking-controls";
import { fmtInt } from "@/lib/analytics/format";
import { localIdentity } from "@/lib/dataforseo/local";
import { googleSearchUrl, loadRanks, loadRankSettings, movers, nextRankCheck, rankDueCutoff, rankEstimate, rankMonthlyCost, RANK_DEPTH, RANK_SCHEDULES, type RankRow } from "@/lib/dataforseo/rank";
import { researchPage } from "@/lib/dataforseo/view";
import type { Highlight } from "@/lib/overview/highlights";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

/** Due keywords and each keyword's next automatic check, from the client's schedule (kept out of the component: it reads the clock). */
function schedulePlan(rows: RankRow[], days: number) {
  const now = Date.now();
  const cutoff = rankDueCutoff(days, now);
  const next = new Map(rows.map((r) => [r.id, nextRankCheck(r.checkedOn, days, now)]));
  const soonest = [...next.values()].sort()[0] ?? null;
  return { due: rows.filter((r) => !r.checkedOn || r.checkedOn <= cutoff).length, next, soonest, dueThen: soonest ? [...next.values()].filter((t) => t === soonest).length : 0 };
}
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

export default async function RankTrackingPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Rank Tracking" description="Google positions for your keywords on desktop and mobile, and what else is on each results page." guide={[
    { term: "Position", text: `Place among Google's organic results (1 = first). "Not in top ${RANK_DEPTH}" means it wasn't found.` },
    { term: "Change", text: "Movement since the previous check." },
    { term: "Next check", text: "When the daily job (07:30 UTC) next re-checks the keyword, from the chosen schedule. Runs for clients opened in the last 14 days with automatic refresh on, inside the daily spend cap." },
    { term: "Pinned", text: "Keywords an owner pinned: they are listed first and shown as cards at the top." },
    { term: "Map pack / AI Overview", text: "Whether Google showed a map pack or AI Overview for the search, and whether the business is in it." },
    { term: "On the results page", text: "The extras Google showed for the search (map pack, AI Overview, People also ask, images, ads…). Each takes clicks away from the plain blue links." },
  ]} />;
  if (!configured) return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website to track yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected, or ask an owner or admin to set it." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ ok, rows, lastChecked }, settings, place] = await Promise.all([loadRanks(supabase, client.id), loadRankSettings(admin, client.id), localIdentity(admin, client.id)]);
  if (!ok) return <>{header}<EmptyState title="Rank tracking needs one database update" body="Apply the latest database migration (20261030000020_rank_tracking_ai_visibility.sql) in the Supabase SQL editor, then reload this page." /></>;

  const tracked = new Set(rows.map((r) => r.keyword));
  const ranked = (cache.get<Row[]>("ranked_keywords")?.data ?? []) as Row[];
  const suggestions = ranked.filter((k) => typeof k.keyword === "string" && !tracked.has(k.keyword as string) && Number(k.position) >= 4 && Number(k.position) <= 30)
    .sort((a, b) => Number(b.volume ?? 0) - Number(a.volume ?? 0)).slice(0, 8).map((k) => k.keyword as string);

  const plan = schedulePlan(rows, settings.days);
  const due = plan.due;
  const pinned = new Set(settings.pinned.filter((id) => rows.some((r) => r.id === id)));
  const liveUrl = (r: RankRow) => r.checkUrl ?? googleSearchUrl(r.keyword, r.serp?.searched_from && r.serp.searched_from !== "country" ? place : null);
  const monthly = { daily: rankMonthlyCost(rows.length, RANK_SCHEDULES.daily), weekly: rankMonthlyCost(rows.length, RANK_SCHEDULES.weekly), monthly: rankMonthlyCost(rows.length, RANK_SCHEDULES.monthly) };
  const checkedRows = rows.filter((r) => r.checkedOn);
  const found = checkedRows.filter((r) => r.position !== null);
  const avg = found.length ? found.reduce((a, r) => a + (r.position as number), 0) / found.length : null;
  const top3 = found.filter((r) => (r.position as number) <= 3).length;
  const top10 = found.filter((r) => (r.position as number) <= 10).length;
  const { dropped, gained } = movers(rows);

  const picks: Highlight[] = [];
  if (dropped.length) picks.push({ tone: "bad", title: `${dropped.length} keyword${dropped.length > 1 ? "s" : ""} dropped`, detail: dropped.slice(0, 3).map((r) => `“${r.keyword}” ${r.previous ?? `${RANK_DEPTH}+`} → ${r.position ?? `not in top ${RANK_DEPTH}`}`).join("; ") + ".", action: "Check those pages for lost content, links or technical problems (Site Audit)." });
  if (gained.length) picks.push({ tone: "good", title: `${gained.length} keyword${gained.length > 1 ? "s" : ""} moved up`, detail: gained.slice(0, 3).map((r) => `“${r.keyword}” ${r.previous ?? `${RANK_DEPTH}+`} → ${r.position}`).join("; ") + "." });
  const near = found.filter((r) => (r.position as number) >= 4 && (r.position as number) <= 10).length;
  if (near) picks.push({ tone: "info", title: `${near} keyword${near > 1 ? "s are" : " is"} just below the top 3`, detail: "Positions 4-10 get a fraction of the clicks of the top 3.", action: "Improve those pages' content, titles and internal links first." });
  const missing = checkedRows.length - found.length;
  if (missing) picks.push({ tone: "info", title: `${missing} keyword${missing > 1 ? "s" : ""} not in Google's top ${RANK_DEPTH}`, detail: "The site wasn't found for these searches.", action: "Create or strengthen a dedicated page for each." });

  // search competitors: sites that most often hold the top 10 for the tracked keywords
  const self = cache.target.domain.replace(/^www\./, "").toLowerCase();
  const lead = new Map<string, { n: number; sum: number }>();
  for (const r of rows) for (const t of r.top) {
    const d = (t.domain ?? "").replace(/^www\./, "").toLowerCase();
    if (!d || d === self || d.endsWith(`.${self}`)) continue;
    const c = lead.get(d) ?? { n: 0, sum: 0 }; c.n++; c.sum += t.position; lead.set(d, c);
  }
  const leaders = [...lead.entries()].sort((a, b) => b[1].n - a[1].n || a[1].sum / a[1].n - b[1].sum / b[1].n).slice(0, 10);

  // trend: average position and top-10 count by check date
  const dates = [...new Set(rows.flatMap((r) => r.history.map((h) => h.date)))].sort();
  const series = dates.map((d) => {
    const pts = rows.map((r) => r.history.find((h) => h.date === d)?.position).filter((p): p is number => typeof p === "number");
    return { date: d, avg: pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null, top10: pts.filter((p) => p <= 10).length };
  });
  const prevPoint = series.length >= 2 ? series[series.length - 2] : null;

  const featureName = (f: string) => f.replace(/_/g, " ");
  // pinned keywords first, then by position (not found last)
  const ordered = [...rows].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || (a.position ?? 1e9) - (b.position ?? 1e9));
  const tableRows: Row[] = ordered.map((r: RankRow) => ({
    ...r, serp: undefined, history: undefined, top: undefined, checkUrl: undefined,
    pinned: pinned.has(r.id) ? "★ pinned" : null, next_check: plan.next.get(r.id)?.slice(0, 10) ?? null, google: liveUrl(r),
    features: r.serp?.features.map(featureName).join(", ") ?? null,
    in_pack: r.serp ? (r.pack ? `#${r.pack}` : r.serp.local_pack.length ? "Not in pack" : "No map pack") : null,
    in_ai: r.serp ? (r.serp.ai_overview.length === 0 ? "No AI Overview" : r.serp.ai_overview.some((a) => (a.domain ?? "").replace(/^www\./, "").toLowerCase().endsWith(self)) ? "Cited" : "Not cited") : null,
  }));
  const checkedSerp = rows.filter((r) => r.serp);
  const inPack = checkedSerp.filter((r) => r.pack).length, packFirst = checkedSerp.filter((r) => r.pack === 1).length;
  const from = checkedSerp.find((r) => r.serp?.searched_from)?.serp?.searched_from;
  const improved = rows.filter((r) => (r.change ?? 0) > 0).length, declined = rows.filter((r) => (r.change ?? 0) < 0).length;
  const unchanged = rows.filter((r) => r.change === 0).length;
  const dist = [
    { label: "Top 3", value: found.filter((r) => (r.position as number) <= 3).length },
    { label: "4 to 10", value: found.filter((r) => (r.position as number) >= 4 && (r.position as number) <= 10).length },
    { label: "11 to 20", value: found.filter((r) => (r.position as number) >= 11 && (r.position as number) <= 20).length },
    { label: "21 to 50", value: found.filter((r) => (r.position as number) >= 21 && (r.position as number) <= 50).length },
    { label: `51 to ${RANK_DEPTH}`, value: found.filter((r) => (r.position as number) >= 51).length },
    { label: `Not in top ${RANK_DEPTH}`, value: missing },
  ];
  const deviceAvg = (["desktop", "mobile"] as const).map((d) => {
    const f = found.filter((r) => r.device === d);
    return { device: d, avg: f.length ? f.reduce((a, r) => a + (r.position as number), 0) / f.length : null, n: rows.filter((r) => r.device === d).length };
  }).filter((d) => d.n > 0);
  // the rest of each results page: who holds the map pack, who advertises, what the AI Overview cites
  const serpRows: Row[] = rows.filter((r) => r.serp).map((r) => ({
    keyword: r.keyword, device: r.device,
    local_pack: r.serp!.local_pack.map((p) => `${p.own ? "★ " : ""}${p.title ?? p.domain ?? "?"}${p.rating ? ` (${p.rating})` : ""}`).join(" · ") || null,
    ai_overview: r.serp!.ai_overview.map((a) => a.domain).filter(Boolean).slice(0, 5).join(", ") || null,
    featured_snippet: r.serp!.featured_snippet, ads: r.serp!.ads.join(", ") || null,
  }));
  const adCount = new Map<string, number>();
  for (const r of rows) for (const a of r.serp?.ads ?? []) adCount.set(a, (adCount.get(a) ?? 0) + 1);
  const advertisers = [...adCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const featCount = new Map<string, number>();
  for (const r of checkedSerp) for (const f of new Set(r.serp!.features)) featCount.set(f, (featCount.get(f) ?? 0) + 1);
  const features = [...featCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([f, n]) => ({ label: featureName(f)[0].toUpperCase() + featureName(f).slice(1), value: n, detail: `${Math.round((n / checkedSerp.length) * 100)}%` }));
  const packMix = [
    { label: "#1", value: packFirst, color: "var(--positive)" },
    { label: "#2–#3", value: inPack - packFirst, color: "color-mix(in oklab, var(--positive) 50%, var(--surface))" },
    { label: "Not in pack", value: checkedSerp.filter((r) => !r.pack && r.serp!.local_pack.length).length, color: "var(--negative)" },
    { label: "No pack", value: checkedSerp.filter((r) => !r.serp!.local_pack.length).length, color: "var(--series-prev)" },
  ].map((m) => ({ ...m, label: `${m.label} · ${m.value}` }));
  const aiMix = ["Cited", "Not cited", "No AI Overview"].map((k, i) => {
    const n = tableRows.filter((r) => r.in_ai === k).length;
    return { label: `${k === "No AI Overview" ? "None shown" : k} · ${n}`, value: n, color: ["var(--positive)", "var(--negative)", "var(--series-prev)"][i] };
  });
  const aiShown = aiMix[0].value + aiMix[1].value;
  const movement = [
    { label: "Improved", value: improved, color: "var(--positive)" }, { label: "Unchanged", value: unchanged, color: "var(--series-prev)" },
    { label: "Declined", value: declined, color: "var(--negative)" },
  ];
  const distChart = <FillColumns title="Position distribution" sub="Tracked keyword/device pairs by organic position" valueLabel="Keywords" bins={dist.map((d, i) => ({ ...d, color: i < 2 ? "var(--series)" : i < 5 ? "color-mix(in oklab, var(--series) 45%, var(--surface))" : "var(--series-prev)" }))} />;
  const moveChart = <FillColumns title="Movement since the previous check" sub="Keyword/device pairs whose organic position changed" valueLabel="Keywords" bins={movement} empty="No earlier check to compare with yet." />;
  return (
    <>
      {header}
      <p className="mb-5 text-sm"><span className="font-semibold">{cache.target.domain}</span><span className="text-muted"> · {rows.length} keyword/device pairs{lastChecked ? ` · checked ${lastChecked}` : ""} · refreshes {settings.schedule}</span></p>

      {rows.length > 0 && (
        <section aria-label="Check schedule" className="mb-6 grid gap-4 rounded-[10px] border border-border bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Next automatic check</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{plan.soonest ? when(plan.soonest) : "—"}</p>
            <p className="mt-1 text-xs text-muted">
              {plan.dueThen} of {rows.length} keyword{rows.length === 1 ? "" : "s"} due then · {settings.schedule} schedule · the daily job runs at 07:30 UTC for clients opened in the last 14 days, inside the daily spend cap
              {cache.target.auto_refresh === false ? ". Automatic refresh is off for this client, so only “Check now” runs." : "."}
            </p>
          </div>
          <RankSchedulePicker canEdit={canEdit} schedule={settings.schedule} monthly={monthly} count={rows.length} />
        </section>
      )}

      {rows.length === 0 ? <EmptyState title="No keywords tracked yet" body="Keywords are added automatically in the next daily run, or add your own below." /> : checkedRows.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border p-6 text-sm text-muted">Keywords added. Their first positions arrive with the next daily run.</p>
      ) : (
        <>
          <section aria-label="Ranking summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="In the Google map pack" value={`${inPack} of ${checkedSerp.length}`} sub={`#1 for ${packFirst}`} tone={inPack ? "good" : undefined} />
            <StatCard label="Searched from" value={from === "country" || !from ? "United States" : from} sub="the business location, like a nearby customer" />
            <KpiCard label="Organic average position" source="DFS" format={(n) => (n == null ? "—" : n.toFixed(1))} value={avg} previous={prevPoint?.avg ?? null} higherIsBetter={false} hint="Across keywords found in the top 30. Lower is better." />
            <KpiCard label="Organic top 3" source="DFS" format={fmtInt} value={top3} previous={null} />
            <KpiCard label="Organic top 10" source="DFS" format={fmtInt} value={top10} previous={prevPoint?.top10 ?? null} />
            <KpiCard label={`Not in organic top ${RANK_DEPTH}`} source="DFS" format={fmtInt} value={missing} previous={null} higherIsBetter={false} />
          </section>
          <p className="mt-2 text-xs text-muted">
            Since the previous check: <span className="text-positive">{improved} improved</span> · <span className="text-negative">{declined} declined</span> · {unchanged} unchanged
            {deviceAvg.map((d) => ` · ${d.device} average ${d.avg == null ? "—" : `#${d.avg.toFixed(1)}`} (${d.n} keyword${d.n === 1 ? "" : "s"})`).join("")}
          </p>
          {pinned.size > 0 && (
            <section aria-label="Pinned keywords" className="mt-6">
              <h2 className="mb-2 text-sm font-semibold">Pinned keywords</h2>
              <ul className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
                {ordered.filter((r) => pinned.has(r.id)).map((r) => (
                  <li key={r.id} className="min-w-0 rounded-[10px] border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium" title={r.keyword}>★ {r.keyword}</p>
                      {canEdit && <PinButton id={r.id} label={r.keyword} pinned />}
                    </div>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{r.position ?? <span className="text-base font-medium text-muted">Not in top {RANK_DEPTH}</span>}
                      {r.change ? <span className={`ml-2 text-sm ${r.change > 0 ? "text-positive" : "text-negative"}`}>{r.change > 0 ? "▲" : "▼"} {Math.abs(r.change)}</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-muted">{r.device}{r.pack ? ` · map pack #${r.pack}` : ""} · next check {plan.next.get(r.id)?.slice(0, 10) ?? "—"}</p>
                    <a href={liveUrl(r)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Open the live Google results ↗</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {picks.length > 0 && <div className="mt-6"><Highlights items={picks.slice(0, 3)} /></div>}
          <div className={`mt-6 grid gap-4 ${series.length >= 2 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {distChart}
            <Donut title="Map pack position" sub={`Your place in the map pack across ${checkedSerp.length} checked searches`} items={packMix} center={checkedSerp.length ? `${Math.round((inPack / checkedSerp.length) * 100)}%` : "—"} centerLabel="in the pack" />
            <Donut title="Google AI Overview" sub="Shown for the search, and whether it cites you" items={aiMix} center={aiShown ? `${Math.round((aiMix[0].value / aiShown) * 100)}%` : "—"} centerLabel="cited when shown" />
            {series.length < 2 && moveChart}
          </div>

          {series.length >= 2 && (
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="min-w-0 lg:col-span-2"><MetricTrend title="Rankings over time" source="DFS" options={[
                { key: "avg", label: "Average position", data: series.filter((s) => s.avg !== null).map((s) => ({ date: s.date, value: s.avg })) },
                { key: "top10", label: "Keywords in top 10", data: series.map((s) => ({ date: s.date, value: s.top10 })) },
              ]} /></div>
              {moveChart}
            </div>
          )}

          <div className="mt-6">
            <ResearchTable title="Tracked keywords" rows={tableRows} searchKeys={["keyword", "url"]} csvName={`rankings-${cache.target.domain}`}
              note={`Pinned keywords are listed first. “Live Google page” opens the same search on Google${rows.some((r) => !r.checkUrl) ? " (for checks made before the link was recorded, it is rebuilt from the keyword and the search location)" : ""}.`}
              columns={[
                { key: "pinned", label: "Pin", type: "badge" },
                { key: "keyword", label: "Keyword" }, { key: "position", label: "Position", type: "int", hint: `Place in Google's organic results; empty = not in the top ${RANK_DEPTH}` },
                { key: "previous", label: "Change", type: "change", hint: "Movement since the previous check" }, { key: "best", label: "Best", type: "int" },
                { key: "url", label: "Ranking page", type: "url" }, { key: "device", label: "Device", type: "badge" },
                { key: "volume", label: "Volume", type: "int", hint: "Monthly Google searches (DataForSEO estimate)" }, { key: "difficulty", label: "KD", type: "int", hint: "Keyword difficulty, 0-100" },
                { key: "cpc", label: "CPC", type: "usd", hint: "Average cost per click in Google Ads" }, { key: "intent", label: "Intent", type: "badge" },
                { key: "features", label: "On the results page", hint: "SERP features Google showed for this search" }, { key: "in_pack", label: "Map pack", type: "badge", hint: "Place in Google's map pack (the 3 businesses on the map)" },
                { key: "in_ai", label: "AI Overview", type: "badge" }, { key: "checkedOn", label: "Checked", type: "date" },
                { key: "next_check", label: "Next check", type: "date", hint: "When the automatic job next re-checks it (UTC date)" },
                { key: "google", label: "Live Google page", type: "url", hint: "The same search on Google, from the same location" },
              ]}
              ranges={[{ key: "position", label: "Position" }, { key: "best", label: "Best" }, { key: "volume", label: "Volume" }, { key: "difficulty", label: "KD" }]} facets={[{ key: "device", label: "Device" }, { key: "intent", label: "Intent" }, { key: "in_pack", label: "Map pack" }, { key: "in_ai", label: "AI Overview" }]}
              presets={[...(pinned.size ? [{ label: `Pinned (${pinned.size})`, where: [{ key: "pinned", op: "eq" as const, value: "★ pinned" }] }] : []), { label: "Top 3", where: [{ key: "position", op: "lte", value: 3 }] }, { label: "Top 10", where: [{ key: "position", op: "lte", value: 10 }] }, { label: "Page 2-3 (11-30)", where: [{ key: "position", op: "gte", value: 11 }] }, { label: "Improved", where: [{ key: "change", op: "gte", value: 1 }] }, { label: "Declined", where: [{ key: "change", op: "lte", value: -1 }] }]} />
          </div>

          {serpRows.length > 0 && (
            <div className="mt-6 space-y-3">
              <ResearchTable title="Who owns the rest of the results page" rows={serpRows} searchKeys={["keyword", "local_pack", "ai_overview", "ads"]} pageSize={10}
                columns={[{ key: "keyword", label: "Keyword" }, { key: "device", label: "Device", type: "badge" }, { key: "local_pack", label: "Map pack (★ = you)" },
                  { key: "ai_overview", label: "AI Overview cites" }, { key: "featured_snippet", label: "Featured snippet" }, { key: "ads", label: "Ads shown by" }]} />
              {advertisers.length > 0 && (
                <BarList title="Who buys ads on your keywords" valueLabel="Keywords with their ad" items={advertisers.map(([d, n]) => ({ label: d, value: n }))} />
              )}
            </div>
          )}

          {(leaders.length > 0 || features.length > 0) && (
            <div className={`mt-6 grid gap-4 ${leaders.length > 0 && features.length > 0 ? "lg:grid-cols-2" : ""}`}>
              {leaders.length > 0 && <BarList title="Who ranks in the top 10 for your keywords" valueLabel="Keywords · avg position" items={leaders.map(([d, v]) => ({ label: d, value: v.n, detail: `#${(v.sum / v.n).toFixed(1)}` }))} />}
              {features.length > 0 && <BarList title="What else Google shows on your searches" valueLabel="Searches · share" items={features} />}
            </div>
          )}
        </>
      )}

      {canEdit && (
        <details className="mt-8 rounded-[10px] border border-border bg-surface p-4" open={rows.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">Manage tracked keywords <span className="text-muted">({rows.length})</span></summary>
          <div className="mt-3"><RankControls canEdit={canEdit} count={rows.length} due={due} suggestions={suggestions} estimate={`$${rankEstimate(due || rows.length).toFixed(2)}`} /></div>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {ordered.map((r) => <li key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-3 pr-1">{r.keyword}<span className="text-xs text-muted">({r.device})</span><PinButton id={r.id} label={r.keyword} pinned={pinned.has(r.id)} /><RemoveButton kind="rank" id={r.id} label={r.keyword} /></li>)}
          </ul>
        </details>
      )}
      <div className="mt-6"><SpendLine budget={budget} /></div>
    </>
  );
}
