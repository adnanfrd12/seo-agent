import Link from "next/link";
import { ColChart, Scatter, Treemap } from "@/components/ga4x/charts";
import { C, fmt, typeColor } from "@/components/ga4x/fmt";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { Band, Card, Grid, Note, ScreenTasks } from "@/components/ga4x/ui";
import { first, withParams, type SearchParams } from "@/lib/analytics/url";
import type { G } from "@/lib/ga4x/g";
import { group, sum, weekday, type Obj } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { cn } from "@/lib/utils";
import { Ga4xScreen } from "../_ga4x/screen";
import { eventColor, plainEvent, TYPE_PLAIN } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/explorer";

type Src = "S" | "S2" | "H" | "G" | "R" | "L" | "L2" | "L3";
interface Dim { name: string; s: [Src, (x: Obj, g: G) => string] | null; l: [Src, (x: Obj, g: G) => string]; page?: boolean; note?: string }
const str = (k: string) => (x: Obj) => String(x[k] ?? "(not set)") || "(not set)";
const DIMS: Dim[] = [
  { name: "Session default channel group", s: ["S", str("ch")], l: ["L", str("ch")] },
  { name: "Session source / medium", s: ["S", str("sessionSourceMedium")], l: ["L", str("sessionSourceMedium")] },
  { name: "Session source", s: ["S", (x, g) => g.source(x)], l: ["L", (x, g) => g.source(x)] },
  { name: "Session medium", s: ["S", (x, g) => g.medium(x)], l: ["L", (x, g) => g.medium(x)] },
  { name: "Landing page (cleaned)", s: ["S", str("land")], l: ["L", str("land")], page: true },
  { name: "Landing page + query string (raw)", s: ["S", str("landingPagePlusQueryString")], l: ["L", str("landingPagePlusQueryString")], page: true },
  { name: "Page where the lead happened", s: null, l: ["L2", str("pagePath")], page: true, note: "The page the lead event fired on. GA4 has no sessions per lead page, so sessions and lead rate are left out." },
  { name: "City", s: ["G", str("city")], l: ["L", str("city")] },
  { name: "Region", s: ["G", str("region")], l: ["L2", str("region")] },
  { name: "Country", s: ["G", str("country")], l: ["L", str("country")] },
  { name: "Device category", s: ["S", str("deviceCategory")], l: ["L", str("deviceCategory")] },
  { name: "Browser", s: ["S", str("browser")], l: ["L", str("browser")] },
  { name: "Operating system", s: ["S2", str("operatingSystem")], l: ["L2", str("operatingSystem")] },
  { name: "New vs returning", s: ["S", str("newVsReturning")], l: ["L2", str("newVsReturning")] },
  { name: "Session campaign", s: ["S2", str("sessionCampaignName")], l: ["L2", str("sessionCampaignName")] },
  { name: "Day of week", s: ["S", (x) => weekday(String(x.date))], l: ["L", (x) => weekday(String(x.date))] },
  { name: "Hour of day", s: ["H", (x) => `${String(x.dateHour).slice(11, 13)}:00`], l: ["L2", (x) => `${String(x.dateHour).slice(11, 13)}:00`] },
  { name: "Language", s: ["S2", str("language")], l: ["L3", str("language")] },
  { name: "Screen resolution", s: ["R", str("screenResolution")], l: ["L3", str("screenResolution")] },
];
const LAYOUTS: [string, number][] = [["Traffic Source vs Leads", 0], ["Detailed Source vs Leads", 1], ["Page vs Leads", 5], ["Page vs Leads (cleaned)", 4], ["City vs Leads", 7], ["Device vs Leads", 10], ["Where leads happened", 6]];

export default async function LeadExplorerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const di = Math.min(DIMS.length - 1, Math.max(0, Number(first(sp.rows)) || 0));
  const mode = first(sp.cols) === "types" ? "types" : "events";
  const n = ["10", "25", "0"].includes(first(sp.n) ?? "") ? Number(first(sp.n)) : 10;
  const extra = first(sp.extra) !== "0";
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Lead explorer" description="Any dimension as rows, each lead event as a column.">
      {({ g, wins }) => {
        const d = DIMS[di];
        const rowsOf = (s: Src) => (s === "S" ? g.sCur() : s === "S2" ? g.s2Cur() : s === "H" ? g.hCur() : s === "G" ? g.geoCur() : s === "R" ? g.rCur() : s === "L" ? g.lCur() : s === "L2" ? g.l2Cur() : g.l3Cur());
        const sG = d.s ? group(rowsOf(d.s[0]), (x) => d.s![1](x, g)) : new Map<string, Obj[]>();
        const lG = group(rowsOf(d.l[0]), (x) => d.l[1](x, g));
        const colsK: string[] = mode === "events" ? g.leadEvents : g.types();
        const val = (rows: Obj[], k: string) => sum(rows.filter((x) => (mode === "events" ? x.eventName === k : g.typeOf(String(x.eventName)) === k)), (x) => Number(x.eventCount));
        const all = [...new Set([...sG.keys(), ...lG.keys()])].map((key) => {
          const l = lG.get(key) ?? [], cells = colsK.map((k) => val(l, k)), tot = sum(cells, (v) => v), sessions = sum(sG.get(key) ?? [], (x) => Number(x.sessions));
          return { key, cells, tot, sessions };
        }).filter((r) => r.tot > 0 || extra).sort((a, b) => b.tot - a.tot || b.sessions - a.sessions);
        const lAll = rowsOf(d.l[0]);
        const tc = colsK.map((k) => val(lAll, k)), tt = sum(tc, (v) => v);
        const tSessions = d.s ? sum(rowsOf(d.s[0]), (x) => Number(x.sessions)) : 0;
        const mx = colsK.map((_, i) => Math.max(1, ...all.map((r) => r.cells[i])));
        const shown = n ? all.slice(0, n) : all;
        const showSessions = extra && !!d.s;
        const colName = (k: string) => (mode === "events" ? k : TYPE_PLAIN[k as keyof typeof TYPE_PLAIN] ?? k);
        const colColor = (k: string) => (mode === "events" ? eventColor(g, k) : typeColor(k));
        const rawCount = di === 5 ? new Set(g.sCur().map((x) => String(x.landingPagePlusQueryString))).size : 0;
        const site = g.meta.streamUrl?.replace(/\/$/, "");
        const top10 = all.filter((r) => r.tot).slice(0, 10), top6 = all.filter((r) => r.tot).slice(0, 6);
        const T = g.total();
        return (
          <>
            <Grid>
              <Card title="Explore your leads" info="The 'Source vs Leads' and 'Page vs Leads' explorations, without building them in GA. Pick any dimension for rows; lead events are the columns.">
                <div className="flex flex-wrap items-end gap-4">
                  <FilterSelect label="Rows" name="rows" value={String(di)} options={DIMS.map((x, i) => ({ value: String(i), label: x.name }))} path={PATH} sp={sp} />
                  <FilterSelect label="Columns" name="cols" value={mode} options={[{ value: "events", label: "Lead events" }, { value: "types", label: "Lead types" }]} path={PATH} sp={sp} />
                  <FilterSelect label="Show rows" name="n" value={String(n)} options={[{ value: "10", label: "10" }, { value: "25", label: "25" }, { value: "0", label: "All" }]} path={PATH} sp={sp} />
                  <Link href={withParams(PATH, sp, { extra: extra ? "0" : null })} className="inline-flex items-center gap-1.5 pb-1 text-sm" aria-pressed={extra}>
                    <span className={cn("grid size-4 place-items-center rounded border", extra ? "border-foreground bg-foreground text-background" : "border-border")}>{extra ? "✓" : ""}</span> Sessions and lead rate
                  </Link>
                </div>
              </Card>
              <Card title="Quick views" tech="Saved layouts">
                <div className="flex flex-wrap gap-2">
                  {LAYOUTS.map(([l, i]) => <Link key={l} href={withParams(PATH, sp, { rows: String(i) })} aria-pressed={i === di} className={cn("rounded-full border px-3 py-1 text-sm", i === di ? "border-foreground bg-foreground text-background" : "border-border hover:bg-surface-muted")}>{l}</Link>)}
                </div>
              </Card>
            </Grid>
            <Band title="Charts" />
            <Grid>
              <Card title={`Leads by ${d.name.toLowerCase()}`} span={7}>
                <ColChart id="explorer-stack" labels={top10.map((r) => (r.key.length > 14 ? `${r.key.slice(0, 13)}…` : r.key))} series={colsK.map((k, i) => ({ name: mode === "events" ? plainEvent(g, k) : colName(k), tech: k, values: top10.map((r) => r.cells[i]), color: colColor(k) }))} />
              </Card>
              <Card title="Share of leads" sub="Area = leads." span={5}>
                <Treemap items={all.filter((r) => r.tot).slice(0, 20).map((r, i) => ({ label: r.key, value: r.tot, color: C[i % C.length] }))} />
              </Card>
              <Card title="Leads by type for each row" tech="Lead events per row" sub="Top 6 rows." span={7}>
                <ColChart id="explorer-group" stacked={false} labels={top6.map((r) => (r.key.length > 14 ? `${r.key.slice(0, 13)}…` : r.key))} series={colsK.map((k, i) => ({ name: mode === "events" ? plainEvent(g, k) : colName(k), tech: k, values: top6.map((r) => r.cells[i]), color: colColor(k) }))} />
              </Card>
              <Card title="Visits vs lead rate" tech="Sessions vs lead rate" sub="Bubble = leads." span={5}>
                {d.s ? <Scatter points={all.filter((r) => r.sessions > 0).slice(0, 40).map((r) => ({ x: r.sessions, y: r.tot / r.sessions, s: Math.max(1, r.tot), label: r.key, show: r.tot > 0, c: r.tot / r.sessions >= T.lr ? C[2] : C[1] }))} xLabel="Sessions (log scale)" yLabel="Lead rate" logX yRef={T.lr} />
                  : <p className="py-6 text-sm text-muted">{d.note}</p>}
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title={`Pivot table: ${d.name} × lead ${mode}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-hairline">
                      <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <th className="px-3 py-2 text-left">{d.name}</th>
                        {showSessions && <th className="px-3 py-2 text-right">Sessions</th>}
                        {colsK.map((k) => <th key={k} className="px-3 py-2 text-right normal-case"><span className="font-mono">{colName(k)}</span></th>)}
                        <th className="px-3 py-2 text-right">Totals</th>
                        {showSessions && <th className="px-3 py-2 text-right">Lead rate</th>}
                      </tr>
                      <tr className="bg-surface-sunken">
                        <td className="px-3 py-2 font-semibold">Total</td>
                        {showSessions && <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt("int", tSessions)}</td>}
                        {tc.map((v, i) => <td key={i} className="px-3 py-2 text-right tabular-nums"><b>{fmt("int", v)}</b><br /><small className="text-muted">{fmt("pct", tt ? v / tt : 0)} of total</small></td>)}
                        <td className="px-3 py-2 text-right tabular-nums"><b>{fmt("int", tt)}</b><br /><small className="text-muted">100.0% of total</small></td>
                        {showSessions && <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt("pct", tSessions ? tt / tSessions : 0)}</td>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {shown.map((r, i) => (
                        <tr key={r.key} className="hover:bg-surface-sunken">
                          <td className="max-w-[26rem] px-3 py-2 align-top"><span className="text-muted">{i + 1}</span>&nbsp; {d.page && site && r.key.startsWith("/") ? <a href={site + r.key} target="_blank" rel="noreferrer" className="break-all hover:underline">{r.key}</a> : <span className="break-all">{r.key}</span>}</td>
                          {showSessions && <td className="px-3 py-2 text-right tabular-nums">{fmt("int", r.sessions)}</td>}
                          {r.cells.map((v, j) => <td key={j} className="relative px-3 py-2 text-right tabular-nums">{fmt("int", v)}<i className="absolute bottom-1 right-3 block h-[3px] rounded-full opacity-70" style={{ width: `calc(${((v / mx[j]) * 100).toFixed(0)}% - 1.5rem)`, maxWidth: "calc(100% - 1.5rem)", background: colColor(colsK[j]) }} /></td>)}
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{fmt("int", r.tot)}</td>
                          {showSessions && <td className="px-3 py-2 text-right tabular-nums">{fmt("pct", r.sessions ? r.tot / r.sessions : 0)}</td>}
                        </tr>
                      ))}
                      {!shown.length && <tr><td colSpan={colsK.length + 4} className="px-3 py-6 text-center text-muted">No leads in this period.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {n > 0 && all.length > n && <Note>Showing {n} of {all.length} rows. <Link href={withParams(PATH, sp, { n: "0" })} className="underline underline-offset-2">Show all</Link></Note>}
                {di === 5 && <Note>{fmt("int", rawCount)} raw landing-page values. Switch to &quot;Landing page (cleaned)&quot; to merge fbclid, gclid and utm_ variants into one row per page.</Note>}
                {d.note && <Note>{d.note}</Note>}
              </Card>
            </Grid>
            <ScreenTasks screen="Lead explorer" wins={forScreen(wins, "explorer")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
