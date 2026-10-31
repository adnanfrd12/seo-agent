import type { CruxKey, CruxMetric, CruxRecord, CruxRun } from "@/lib/dataforseo/lighthouse";

/* Charts for the "tracking" pages (Site Audit real-user data). Server-renderable: no hooks, no handlers. */

const GOOD = "#0cce6b", NI = "#ffa400", POOR = "#ff4e42";
// Google's Core Web Vitals thresholds: good up to the first value, poor above the second
const METRICS: { key: CruxKey; label: string; long: string; t: [number, number] }[] = [
  { key: "inp", label: "INP", long: "Interaction to Next Paint", t: [200, 500] },
  { key: "lcp", label: "LCP", long: "Largest Contentful Paint", t: [2500, 4000] },
  { key: "cls", label: "CLS", long: "Cumulative Layout Shift", t: [0.1, 0.25] },
  { key: "ttfb", label: "TTFB", long: "Time to First Byte", t: [800, 1800] },
];
const fmt = (k: CruxKey, v: number | null) => (v == null ? "—" : k === "cls" ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const tone = (v: number | null, t: [number, number]) => (v == null ? "var(--muted)" : v <= t[0] ? GOOD : v <= t[1] ? NI : POOR);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/ (home)" : x.pathname; } catch { return u; } };

function DistBar({ m }: { m: CruxMetric }) {
  const parts = [{ v: m.good, c: GOOD, l: "good" }, { v: m.ni, c: NI, l: "needs improvement" }, { v: m.poor, c: POOR, l: "poor" }];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={parts.map((p) => `${pct(p.v)} ${p.l}`).join(", ")}>
        {parts.map((p) => p.v > 0 && <span key={p.l} style={{ width: `${p.v * 100}%`, background: p.c }} />)}
      </div>
      <p className="mt-1 flex justify-between text-[11px] tabular-nums text-muted"><span style={{ color: GOOD }}>{pct(m.good)} good</span><span>{pct(m.ni)}</span><span style={{ color: POOR }}>{pct(m.poor)} poor</span></p>
    </div>
  );
}

function MetricCard({ def, mobile, desktop }: { def: (typeof METRICS)[number]; mobile: CruxRecord | null; desktop: CruxRecord | null }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-border bg-surface p-4">
      <p className="text-sm font-semibold">{def.label} <span className="font-normal text-muted">{def.long}</span></p>
      <p className="mb-3 text-xs text-muted">good under {fmt(def.key, def.t[0])} · poor over {fmt(def.key, def.t[1])} (75th percentile)</p>
      <div className="space-y-3">
        {([["Mobile", mobile], ["Desktop", desktop]] as const).map(([label, rec]) => {
          const m = rec?.metrics[def.key];
          return (
            <div key={label}>
              <p className="mb-1 flex items-baseline justify-between text-[13px]"><span className="text-muted">{label}</span>
                <span className="font-semibold tabular-nums" style={{ color: tone(m?.p75 ?? null, def.t) }}>{m ? fmt(def.key, m.p75) : "no data"}</span></p>
              {m ? <DistBar m={m} /> : <p className="text-[11px] text-muted">Not enough real-user visits on {label.toLowerCase()}.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Real-user data (Chrome UX Report)": INP, LCP, CLS and TTFB that real Chrome visitors experienced over 28
 * days, whole site and per tested page, with the good / needs-improvement / poor split. `run` is the newest
 * lookup Google answered; `latest` the newest attempt (its error is shown when Google refused).
 */
export function CruxPanel({ run, latest, right }: { run: CruxRun | null; latest: CruxRun | null; right?: React.ReactNode }) {
  const failed = latest && !latest.source ? latest : null;
  const origin = run?.origin ?? { mobile: null, desktop: null };
  const pages = (run?.pages ?? []).filter((p) => p.page);
  const any = Boolean(origin.mobile || origin.desktop || pages.length);
  const period = origin.mobile?.period ?? origin.desktop?.period ?? null;
  return (
    <section className="mt-6 rounded-[10px] border border-border bg-surface p-5" aria-label="Real-user data">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Real-user data (Chrome UX Report)</h2>
          <p className="text-xs text-muted">
            What real Chrome visitors experienced over the last 28 days. Lighthouse can&apos;t measure INP because nobody clicks during a lab test.
            {run ? ` Read ${run.checkedAt.slice(0, 10)} from ${run.source === "crux_api" ? "the Chrome UX Report API" : "PageSpeed Insights"}${period ? `, data up to ${period}` : ""} · refreshed weekly.` : ""}
          </p>
        </div>
        {right}
      </div>
      {failed && (
        <div role="alert" className="mb-4 rounded-[10px] border border-warn/40 bg-warn/10 p-3 text-sm">
          <p className="font-medium">Google didn&apos;t return real-user data on {failed.checkedAt.slice(0, 10)}.</p>
          <p className="mt-1 break-words text-xs text-muted">{failed.error}</p>
          <p className="mt-1 text-xs text-muted">Fix: in Google Cloud, enable the &quot;Chrome UX Report API&quot; and &quot;PageSpeed Insights API&quot; and allow them on the API key (or set PAGESPEED_API_KEY to a key that has them). Both are free.</p>
        </div>
      )}
      {!run ? (
        !failed && <p className="text-sm text-muted">Not looked up yet. It runs with the weekly Lighthouse test, or use the refresh button.</p>
      ) : !any ? (
        <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Not enough real-user data: Google publishes these numbers only for pages and sites with enough Chrome visits in the last 28 days, and this site doesn&apos;t have enough yet. The Lighthouse lab results above are the best guide until it does.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">{origin.mobile || origin.desktop ? "Whole site (all pages together)" : "No whole-site record; the tested pages are shown below."}</p>
          {(origin.mobile || origin.desktop) && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {METRICS.map((d) => <MetricCard key={d.key} def={d} mobile={origin.mobile} desktop={origin.desktop} />)}
            </div>
          )}
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Real-user data per tested page</caption>
              <thead className="bg-surface-sunken text-left text-xs text-muted">
                <tr><th className="px-3 py-2 font-medium">Page</th><th className="px-3 py-2 font-medium">Device</th>{METRICS.map((d) => <th key={d.key} className="px-3 py-2 text-right font-medium">{d.label}</th>)}</tr>
              </thead>
              <tbody>
                {(run.pages ?? []).map((p) => (
                  <tr key={`${p.url}|${p.device}`} className="border-t border-border">
                    <td className="max-w-[14rem] truncate px-3 py-2" title={p.url}>{pathOf(p.url)}</td>
                    <td className="px-3 py-2 capitalize text-muted">{p.device}</td>
                    {p.page ? METRICS.map((d) => {
                      const v = p.page!.metrics[d.key]?.p75 ?? null;
                      return <td key={d.key} className="px-3 py-2 text-right tabular-nums" style={{ color: tone(v, d.t) }}>{fmt(d.key, v)}</td>;
                    }) : <td colSpan={METRICS.length} className="px-3 py-2 text-right text-xs text-muted">not enough visits for page-level data{origin[p.device] ? " (whole-site figures above apply)" : ""}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
