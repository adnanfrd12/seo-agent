import { MetricTrend } from "@/components/charts/metric-trend";
import { Highlights } from "@/components/dashboard/highlights";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine } from "@/components/research/chrome";
import { ResearchTable } from "@/components/research/research-table";
import { RankControls, RemoveButton } from "@/components/research/tracking-controls";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadRanks, movers, rankEstimate, RANK_DEPTH, RANK_EVERY_DAYS, type RankRow } from "@/lib/dataforseo/rank";
import { researchPage } from "@/lib/dataforseo/view";
import type { Highlight } from "@/lib/overview/highlights";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

export default async function RankTrackingPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Rank Tracking" description="Where the website appears in Google for the keywords that matter, and how that changes week by week." guide={[
    { term: "Position", text: `The website's place among Google's organic results (1 = first). We look at the top ${RANK_DEPTH}; "not in top ${RANK_DEPTH}" means it wasn't found there.` },
    { term: "Change", text: "Movement since the previous check. A green arrow means the keyword moved up." },
    { term: "Who ranks above you", text: "The websites that most often appear in the top 10 for your keywords: your real search competitors." },
    { term: "Estimates and timing", text: "Positions come from a fresh Google search from the United States (or the client's market) on the chosen device. Google results vary by person and place, so treat positions as a consistent yardstick rather than an exact view for every visitor." },
  ]} />;
  if (!configured) return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website to track yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected, or ask an owner or admin to set it." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const supabase = await createClient();
  const { ok, rows, lastChecked } = await loadRanks(supabase, client.id);
  if (!ok) return <>{header}<EmptyState title="Rank tracking needs one database update" body="Apply the latest database migration (20261030000020_rank_tracking_ai_visibility.sql) in the Supabase SQL editor, then reload this page." /></>;

  const tracked = new Set(rows.map((r) => r.keyword));
  const ranked = (cache.get<Row[]>("ranked_keywords")?.data ?? []) as Row[];
  const suggestions = ranked.filter((k) => typeof k.keyword === "string" && !tracked.has(k.keyword as string) && Number(k.position) >= 4 && Number(k.position) <= 30)
    .sort((a, b) => Number(b.volume ?? 0) - Number(a.volume ?? 0)).slice(0, 8).map((k) => k.keyword as string);

  const cutoff = shiftDays(todayIn("UTC"), -(RANK_EVERY_DAYS - 1));
  const due = rows.filter((r) => !r.checkedOn || r.checkedOn <= cutoff).length;
  const checkedRows = rows.filter((r) => r.checkedOn);
  const found = checkedRows.filter((r) => r.position !== null);
  const avg = found.length ? found.reduce((a, r) => a + (r.position as number), 0) / found.length : null;
  const top3 = found.filter((r) => (r.position as number) <= 3).length;
  const top10 = found.filter((r) => (r.position as number) <= 10).length;
  const { dropped, gained } = movers(rows);

  const picks: Highlight[] = [];
  if (dropped.length) picks.push({ tone: "bad", title: `${dropped.length} keyword${dropped.length > 1 ? "s" : ""} dropped`, detail: dropped.slice(0, 3).map((r) => `“${r.keyword}” ${r.previous ?? "30+"} → ${r.position ?? `not in top ${RANK_DEPTH}`}`).join("; ") + ".", action: "Check those pages for lost content, links or technical problems (Site Audit)." });
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

  const tableRows: Row[] = rows.map((r: RankRow) => ({ ...r, serp: r.top.length }));
  return (
    <>
      {header}
      <div className="mb-5 space-y-3">
        <SpendLine budget={budget} />
        <p className="text-xs text-muted">Website: <span className="font-medium text-foreground">{cache.target.domain}</span> · {rows.length} keyword{rows.length === 1 ? "" : "s"} tracked{lastChecked ? ` · last checked ${lastChecked}` : ""}. A check costs about 0.5 cents per keyword and runs weekly for active clients.</p>
      </div>
      <div className="mb-6"><RankControls canEdit={canEdit} count={rows.length} due={due} suggestions={suggestions} estimate={`$${rankEstimate(due || rows.length).toFixed(2)}`} /></div>

      {rows.length === 0 ? <EmptyState title="No keywords tracked yet" body="Add the keywords you want to rank for above. The first check gives their positions today; every later check shows movement." /> : checkedRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">Keywords added. Press &quot;Check now&quot; to get their first positions.</p>
      ) : (
        <>
          <Highlights items={picks.slice(0, 4)} stableNote="No keyword moved much since the previous check." />
          <section aria-label="Ranking summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Average position" source="DFS" format={(n) => (n == null ? "—" : n.toFixed(1))} value={avg} previous={prevPoint?.avg ?? null} higherIsBetter={false} hint="Across keywords found in the top 30. Lower is better." />
            <KpiCard label="In the top 3" source="DFS" format={fmtInt} value={top3} previous={null} />
            <KpiCard label="In the top 10" source="DFS" format={fmtInt} value={top10} previous={prevPoint?.top10 ?? null} />
            <KpiCard label={`Not in top ${RANK_DEPTH}`} source="DFS" format={fmtInt} value={missing} previous={null} higherIsBetter={false} />
          </section>

          {series.length >= 2 && (
            <div className="mt-6"><MetricTrend title="Rankings over time" source="DFS" options={[
              { key: "avg", label: "Average position", data: series.filter((s) => s.avg !== null).map((s) => ({ date: s.date, value: s.avg })) },
              { key: "top10", label: "Keywords in top 10", data: series.map((s) => ({ date: s.date, value: s.top10 })) },
            ]} /></div>
          )}

          <div className="mt-6">
            <ResearchTable title="Tracked keywords" rows={tableRows} searchKeys={["keyword", "url"]} initialSort={{ key: "position", dir: "asc" }} csvName={`rankings-${cache.target.domain}`}
              columns={[
                { key: "keyword", label: "Keyword" }, { key: "position", label: "Position", type: "int", hint: `Place in Google's organic results; empty = not in the top ${RANK_DEPTH}` },
                { key: "previous", label: "Change", type: "change", hint: "Movement since the previous check" }, { key: "best", label: "Best", type: "int" },
                { key: "url", label: "Ranking page", type: "url" }, { key: "device", label: "Device", type: "badge" }, { key: "checkedOn", label: "Checked", type: "date" },
              ]}
              ranges={[{ key: "position", label: "Position" }, { key: "best", label: "Best" }]} facets={[{ key: "device", label: "Device" }]}
              presets={[{ label: "Top 3", where: [{ key: "position", op: "lte", value: 3 }] }, { label: "Top 10", where: [{ key: "position", op: "lte", value: 10 }] }, { label: "Page 2-3 (11-30)", where: [{ key: "position", op: "gte", value: 11 }] }, { label: "Improved", where: [{ key: "change", op: "gte", value: 1 }] }, { label: "Declined", where: [{ key: "change", op: "lte", value: -1 }] }]}
              note="Keywords where the site wasn't found have no position. Change compares with the previous check." />
          </div>

          {leaders.length > 0 && (
            <section className="mt-6 rounded-xl border border-border bg-surface p-4" aria-label="Who ranks above you">
              <h2 className="text-sm font-semibold">Who ranks in the top 10 for your keywords</h2>
              <p className="mb-2 text-xs text-muted">Websites that appear most often, with their average position. These are your real search competitors.</p>
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {leaders.map(([d, v]) => <li key={d} className="flex justify-between gap-3"><span className="break-all">{d}</span><span className="shrink-0 tabular-nums text-muted">{v.n} keyword{v.n > 1 ? "s" : ""} · avg #{(v.sum / v.n).toFixed(1)}</span></li>)}
              </ul>
            </section>
          )}
        </>
      )}

      {canEdit && rows.length > 0 && (
        <details className="mt-6 rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Manage tracked keywords <span className="text-muted">({rows.length})</span></summary>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {rows.map((r) => <li key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-3 pr-1">{r.keyword}<span className="text-xs text-muted">({r.device})</span><RemoveButton kind="rank" id={r.id} label={r.keyword} /></li>)}
          </ul>
        </details>
      )}
    </>
  );
}
