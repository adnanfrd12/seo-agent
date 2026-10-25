import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { ReportTable, Unavailable } from "@/components/report/report-ui";
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
  const header = <PageHeader title="Microsoft Clarity" description="Visitor behaviour from Clarity's Data Export API: traffic, engagement, scroll depth and friction signals." />;
  const connected = conn?.status === "connected";

  if (metrics.error) return <div className="mx-auto max-w-6xl">{header}<Unavailable title="Database update needed" body="Apply migration 20261021000011 in Supabase to enable Clarity." /></div>;
  if (!connected && !(metrics.data ?? []).length) {
    return (
      <div className="mx-auto max-w-6xl">
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
    return { title, items: [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15) };
  }).filter((l) => l.items.length);

  const dimCols = (label: string) => [
    { label, render: (p: (typeof pages)[number]) => <span className="break-all">{p.value || "(unknown)"}</span> },
    { label: "Sessions", align: "right" as const, render: (p: (typeof pages)[number]) => fmt(p.m.Traffic ?? null) },
    ...FRICTION.slice(0, 4).map((k) => ({ label: LABEL[k], align: "right" as const, render: (p: (typeof pages)[number]) => fmt(p.m[k] ?? 0) })),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <p>
          {dates.length} stored day(s){dates.length ? ` · ${dates.at(-1)} → ${dates[0]}` : ""} · last synced {conn?.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : "never"} · dates in UTC
        </p>
        <Link href="/integrations" className="font-medium text-accent hover:underline">Manage connection & recording reviews →</Link>
      </div>
      {conn?.last_error && <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">{conn.last_error}</p>}

      {rows.length === 0 ? (
        <Unavailable title="No Clarity data stored yet" body="The first import runs right after connecting (it can take a minute); then one day is added per daily sync. Clarity's API only serves the last 1–3 days, so history builds up over time." />
      ) : (
        <>
          <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t.label}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums">{t.value}</p>
                {"detail" in t && t.detail && <p className="text-xs text-muted">{t.detail}</p>}
              </div>
            ))}
          </section>

          <ReportTable<(typeof daily)[number]> title="By day" source="Microsoft Clarity" empty="No daily totals." rows={daily}
            columns={[
              { label: "Date", render: (d) => d.date },
              { label: "Sessions", align: "right", render: (d) => fmt(d.sessions) },
              { label: "Scroll depth", align: "right", render: (d) => (d.scroll == null ? "—" : `${fmt(d.scroll, 1)}%`) },
              ...FRICTION.map((k) => ({ label: LABEL[k], align: "right" as const, render: (d: (typeof daily)[number]) => fmt(d[k]) })),
            ]} />

          <ReportTable<(typeof pages)[number]> title="Pages" source="Microsoft Clarity" empty="No page-level data yet." rows={pages} columns={dimCols("Page")} />
          {devices.length > 0 && <ReportTable<(typeof devices)[number]> title="Devices" source="Microsoft Clarity" empty="" rows={devices} columns={dimCols("Device")} />}

          {lists.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {lists.map((l) => (
                <section key={l.title} className="rounded-xl border border-border bg-surface p-4">
                  <h2 className="mb-2 text-sm font-semibold">{l.title}</h2>
                  <ul className="space-y-1 text-sm">
                    {l.items.map(([k, v]) => (
                      <li key={k} className="flex justify-between gap-3 border-b border-border/60 py-1 last:border-0">
                        <span className="break-all">{k}</span><span className="shrink-0 tabular-nums text-muted">{fmt(v)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
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
          { label: "Observation", render: (r) => <span>{r.observation}{r.recording_url && <> · <a href={r.recording_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">recording</a></>}</span> },
          { label: "Device", render: (r) => r.device ?? "—" },
        ]} />
      )}
    </div>
  );
}
