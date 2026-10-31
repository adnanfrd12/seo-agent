import Link from "next/link";
import { EmptyState } from "@/components/dashboard/page-header";
import { Highlights } from "@/components/dashboard/highlights";
import { TabHeader } from "@/components/dashboard/tab-header";
import { pickHighlights } from "@/lib/overview/highlights";
import { ReportTable, Unavailable } from "@/components/report/report-ui";
import { Columns, StackedBars } from "@/components/charts/ai-charts";
import { ShareDonut } from "@/components/charts/analytics-charts";
import { BarList } from "@/components/charts/bar-list";
import { cat } from "@/lib/charts/colors";
import { getSession } from "@/lib/analytics/client-context";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { createClient } from "@/lib/supabase/server";

type MetricRow = {
  metric_date: string; dimension: string; value: string; metric: string;
  count: number | null; sessions_pct: number | null; sessions: number | null; raw: Record<string, unknown>;
};
type Review = { id: string; page_url: string; recording_url: string | null; device: string | null; friction_type: string; severity: string; observation: string; observed_on: string | null; created_at: string };

const FRICTION = ["RageClickCount", "DeadClickCount", "ExcessiveScroll", "QuickbackClick", "ScriptErrorCount", "ErrorClickCount"];
const LABEL: Record<string, string> = {
  DeadClickCount: "Dead clicks", RageClickCount: "Rage clicks", ExcessiveScroll: "Excessive scrolling", QuickbackClick: "Quick backs",
  ScriptErrorCount: "Script errors", ErrorClickCount: "Error clicks",
};
/** List-style metrics Clarity returns in the un-dimensioned response. */
const LISTS: [string, string][] = [
  ["PopularPages", "Popular pages"], ["ReferrerUrl", "Referrers"], ["Country", "Countries"], ["Device", "Devices"],
  ["Browser", "Browsers"], ["OS", "Operating systems"], ["PageTitle", "Page titles"],
];

/** Path only (the host is the same on every row), so the bar labels stay readable. */
const path = (u: string) => { try { const x = new URL(u); return `${x.pathname}${x.search}` || "/"; } catch { return u || "(unknown)"; } };
const SHARES = ["Device", "Browser", "OS", "Country"];

const n = (v: unknown) => { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : null; };
const fmt = (v: number | null, digits = 0) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits }));

export default async function ClarityPage() {
  const { client } = await getSession();
  if (!client) return null;
  const supabase = await createClient();
  const since = shiftDays(todayIn("UTC"), -90);
  const [{ data: conn }, metrics, { data: reviews }] = await Promise.all([
    supabase.from("integration_connections").select("status, last_synced_at, last_error").eq("client_id", client.id).eq("provider", "clarity").maybeSingle(),
    supabase.from("clarity_behavior_metrics").select("metric_date, dimension, value, metric, count, sessions_pct, sessions, raw")
      .eq("client_id", client.id).gte("metric_date", since).order("metric_date", { ascending: false }).limit(10000),
    supabase.from("clarity_recording_reviews").select("*").eq("client_id", client.id).order("created_at", { ascending: false }).limit(50),
  ]);
  const header = <TabHeader source="clarity" title="Microsoft Clarity" description="How visitors actually use the site: where they get stuck, what doesn't work and how far they read." guide={[
    { term: "Rage clicks", text: "Visitors clicking the same spot repeatedly: a sign something looks clickable but doesn't work." },
    { term: "Dead clicks", text: "Clicks that did nothing. Often a button or image people expect to be a link." },
    { term: "Quick backs", text: "Visitors who jumped straight back to the previous page: the page wasn't what they expected." },
    { term: "Script errors", text: "Technical errors in the page's code that can break forms, menus and buttons." },
    { term: "Scroll depth", text: "How far down visitors read, on average. Low numbers mean key content may be buried." },
    { term: "History", text: "Clarity only shares the last 1-3 days at a time, so history builds up from each daily sync." },
  ]} />;
  const connected = conn?.status === "connected";

  if (metrics.error) return <div>{header}<Unavailable title="Database update needed" body="Apply migration 20261021000011 in Supabase to enable Clarity." /></div>;
  if (!connected && !(metrics.data ?? []).length) {
    return (
      <div>
        {header}
        <EmptyState title="Clarity isn't connected" body="Connect Clarity with a Data Export API token on the Integrations page." action={{ href: "/integrations", label: "Go to Integrations" }} />
      </div>
    );
  }

  const rows = (metrics.data ?? []) as MetricRow[];
  const totals = rows.filter((r) => r.dimension === "total");
  const dates = [...new Set(rows.map((r) => r.metric_date))].sort().reverse();
  const sum = (metric: string, field: (r: MetricRow) => number | null) =>
    totals.filter((r) => r.metric === metric && !r.value).reduce((a, r) => a + (field(r) ?? 0), 0);
  const avg = (metric: string, key: string) => {
    const v = totals.filter((r) => r.metric === metric && !r.value).map((r) => n(r.raw?.[key])).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const sessions = sum("Traffic", (r) => n(r.raw?.totalSessionCount));
  const tiles = [
    { label: "Sessions", value: fmt(sessions) },
    { label: "Bot sessions", value: fmt(sum("Traffic", (r) => n(r.raw?.totalBotSessionCount))) },
    { label: "Distinct users", value: fmt(sum("Traffic", (r) => n(r.raw?.distinctUserCount ?? r.raw?.distantUserCount))) },
    { label: "Pages per session", value: fmt(avg("Traffic", "pagesPerSessionPercentage") ?? avg("Traffic", "PagesPerSessionPercentage"), 2) },
    { label: "Avg scroll depth", value: (() => { const v = avg("ScrollDepth", "averageScrollDepth"); return v == null ? "—" : `${fmt(v, 1)}%`; })() },
    { label: "Engagement time (avg active)", value: (() => { const v = avg("EngagementTime", "activeTime"); return v == null ? "—" : `${fmt(v)}s`; })() },
    ...FRICTION.map((m) => {
      const pct = avg(m, "sessionsWithMetricPercentage");
      return { label: LABEL[m], value: fmt(sum(m, (r) => r.count)), detail: pct != null ? `${fmt(pct, 1)}% of sessions` : undefined };
    }),
  ];

  const scriptPct = avg("ScriptErrorCount", "sessionsWithMetricPercentage");
  const ragePct = avg("RageClickCount", "sessionsWithMetricPercentage");
  const deadPct = avg("DeadClickCount", "sessionsWithMetricPercentage");
  const scroll = avg("ScrollDepth", "averageScrollDepth");
  const hl = pickHighlights([
    scriptPct != null && scriptPct >= 10 && { tone: "bad" as const, title: `${scriptPct.toFixed(0)}% of sessions hit a script error`, detail: "Code errors can silently break forms, menus and buttons.", action: "Ask your developer to check the browser console on the most-visited pages and fix the errors." },
    ragePct != null && ragePct > 0 && { tone: "bad" as const, title: `${ragePct.toFixed(1)}% of sessions had rage clicks`, detail: "Visitors clicked repeatedly on something that didn't respond.", action: "In Clarity, filter recordings by rage clicks and fix the element people keep clicking." },
    deadPct != null && deadPct >= 5 && { tone: "bad" as const, title: `${deadPct.toFixed(0)}% of sessions had dead clicks`, detail: "People clicked things that did nothing.", action: "Make images and headings that look clickable into real links, or restyle them." },
    scroll != null && scroll < 40 && { tone: "info" as const, title: `Visitors read ${scroll.toFixed(0)}% of the page on average`, detail: "Content below the fold may not be seen.", action: "Move the most important message and call-to-action higher up." },
    scriptPct != null && scriptPct < 10 && (ragePct ?? 0) === 0 && { tone: "good" as const, title: "No rage clicks and few script errors", detail: "Visitors aren't hitting obvious friction in the stored days." },
  ]);
  const daily = dates.map((d) => {
    const day = totals.filter((r) => r.metric_date === d && !r.value);
    const get = (m: string) => day.find((r) => r.metric === m);
    return {
      date: d,
      sessions: n(get("Traffic")?.raw?.totalSessionCount),
      scroll: n(get("ScrollDepth")?.raw?.averageScrollDepth),
      ...Object.fromEntries(FRICTION.map((m) => [m, get(m)?.count ?? null])),
    } as { date: string; sessions: number | null; scroll: number | null } & Record<string, number | null>;
  });

  const byDim = (dim: string) => {
    const map = new Map<string, Record<string, number>>();
    for (const r of rows.filter((x) => x.dimension === dim)) {
      const o = map.get(r.value) ?? {};
      o[r.metric] = (o[r.metric] ?? 0) + (r.metric === "Traffic" ? n(r.raw?.totalSessionCount) ?? 0 : r.count ?? 0);
      map.set(r.value, o);
    }
    return [...map.entries()].map(([value, m]) => ({ value, m, friction: FRICTION.reduce((a, k) => a + (m[k] ?? 0), 0) }))
      .sort((a, b) => (b.m.Traffic ?? 0) - (a.m.Traffic ?? 0) || b.friction - a.friction);
  };
  const pages = byDim("url").slice(0, 50);
  const devices = byDim("device");

  const lists = LISTS.map(([metric, title]) => {
    const map = new Map<string, number>();
    for (const r of totals.filter((x) => x.metric === metric && x.value)) map.set(r.value, (map.get(r.value) ?? 0) + (r.count ?? 0));
    return { metric, title, items: [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15) };
  }).filter((l) => l.items.length);
  // short categorical lists read best as shares; long ranked ones (URLs, titles) as bars
  const shareLists = lists.filter((l) => SHARES.includes(l.metric));
  const rankLists = lists.filter((l) => !SHARES.includes(l.metric));
  const frictionShare = FRICTION.map((m) => ({ label: LABEL[m], value: Number((avg(m, "sessionsWithMetricPercentage") ?? 0).toFixed(1)) }));
  const frictionPages = pages.filter((p) => p.friction > 0).sort((a, b) => b.friction - a.friction).slice(0, 8)
    .map((p, _, all) => ({ label: all.filter((o) => path(o.value) === path(p.value)).length > 1 ? p.value : path(p.value), values: Object.fromEntries(FRICTION.map((k) => [k, p.m[k] ?? 0])) }));
  const frictionKeys = FRICTION.map((k, i) => ({ key: k, label: LABEL[k], color: cat(i) }));
  // a span on the odd last card keeps a two-column grid from ending in an empty cell
  const fill = "md:[&>*:last-child:nth-child(odd)]:col-span-2";

  const dimCols = (label: string) => [
    { label, render: (p: (typeof pages)[number]) => <span className="break-all">{p.value || "(unknown)"}</span> },
    { label: "Sessions", align: "right" as const, render: (p: (typeof pages)[number]) => fmt(p.m.Traffic ?? null) },
    ...FRICTION.slice(0, 4).map((k) => ({ label: LABEL[k], align: "right" as const, render: (p: (typeof pages)[number]) => fmt(p.m[k] ?? 0) })),
  ];

  return (
    <div className="space-y-8">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <p>
          {dates.length} stored day(s){dates.length ? ` · ${dates.at(-1)} → ${dates[0]}` : ""} · last synced {conn?.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : "never"} · dates in UTC
        </p>
        <Link href="/integrations" className="font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Manage connection & recording reviews →</Link>
      </div>
      {conn?.last_error && <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">{conn.last_error}</p>}
      {rows.length > 0 && <Highlights items={hl} stableNote="Clarity only stores the most recent days; more history builds up daily." />}

      {rows.length === 0 ? (
        <Unavailable title="No Clarity data stored yet" body="The first import runs right after connecting (it can take a minute); then one day is added per daily sync. Clarity's API only serves the last 1–3 days, so history builds up over time." />
      ) : (
        <>
          <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-[10px] border border-border bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t.label}</p>
                <p className="mt-2 text-[26px] font-semibold tabular-nums tracking-[-0.02em]">{t.value}</p>
                {"detail" in t && t.detail && <p className="text-xs text-muted">{t.detail}</p>}
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Columns title="Friction: share of sessions" sub="Average over the stored days" valueLabel="% of sessions" bins={frictionShare} />
            <Columns title="Sessions by day" sub={`${dates.length} stored day${dates.length === 1 ? "" : "s"}, oldest first`} valueLabel="Sessions"
              bins={[...daily].reverse().slice(-14).map((d, i, a) => ({ label: d.date.slice(5), value: d.sessions ?? 0, highlight: i === a.length - 1 }))} />
          </div>

          <ReportTable<(typeof daily)[number]> title="By day" source="Microsoft Clarity" empty="No daily totals." rows={daily}
            columns={[
              { label: "Date", render: (d) => d.date },
              { label: "Sessions", align: "right", render: (d) => fmt(d.sessions) },
              { label: "Scroll depth", align: "right", render: (d) => (d.scroll == null ? "—" : `${fmt(d.scroll, 1)}%`) },
              ...FRICTION.map((k) => ({ label: LABEL[k], align: "right" as const, render: (d: (typeof daily)[number]) => fmt(d[k]) })),
            ]} />

          <ReportTable<(typeof pages)[number]> title="Pages" source="Microsoft Clarity" empty="No page-level data yet." rows={pages.slice(0, 20)} columns={dimCols("Page")} />
          {pages.length > 20 && (
            // every page stays available, folded so the list doesn't run on for screens
            <details className="-mt-3 rounded-[10px] border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Show all {pages.length} pages</summary>
              <div className="border-t border-hairline p-4"><ReportTable<(typeof pages)[number]> title={`Pages 21-${pages.length}`} empty="" rows={pages.slice(20)} columns={dimCols("Page")} /></div>
            </details>
          )}
          {devices.length > 0 && <ReportTable<(typeof devices)[number]> title="Devices" source="Microsoft Clarity" empty="" rows={devices} columns={dimCols("Device")} />}

          {frictionPages.length > 0 && (
            <StackedBars title="Friction by page" sub="Pages with the most friction events, split by type (hover a row for the counts)" valueLabel="Events"
              keys={frictionKeys} rows={frictionPages} />
          )}

          {shareLists.length > 0 && (
            <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${fill}`}>
              {shareLists.map((l) => (
                <ShareDonut key={l.title} title={l.title} sub="Share over the stored days" centerLabel="total"
                  items={l.items.map(([label, value]) => ({ label, value }))} />
              ))}
            </div>
          )}

          {rankLists.length > 0 && (
            <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${fill}`}>
              {rankLists.map((l) => (
                <BarList key={l.title} title={l.title} valueLabel="Count" items={l.items.map(([label, value]) => ({ label, value }))} />
              ))}
            </div>
          )}
        </>
      )}

      {(reviews ?? []).length > 0 && (
        <ReportTable<Review> title="Recording observations (logged by reviewers)" empty="" rows={(reviews ?? []) as Review[]} columns={[
          { label: "Page", render: (r) => <span className="break-all">{r.page_url}</span> },
          { label: "Issue", render: (r) => r.friction_type.replace(/_/g, " ") },
          { label: "Severity", render: (r) => r.severity },
          { label: "Observation", render: (r) => <span>{r.observation}{r.recording_url && <> · <a href={r.recording_url} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">recording</a></>}</span> },
          { label: "Device", render: (r) => r.device ?? "—" },
        ]} />
      )}
    </div>
  );
}
