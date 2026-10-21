import { PageHeader } from "@/components/dashboard/page-header";
import { ReportTable, Unavailable } from "@/components/report/report-ui";
import { getSession } from "@/lib/analytics/client-context";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { createClient } from "@/lib/supabase/server";
import { ConnectClarity, ReviewForm } from "./clarity-forms";

type MetricRow = { metric_date: string; dimension: string; value: string; metric: string; count: number | null; sessions_pct: number | null };
type Review = { id: string; page_url: string; recording_url: string | null; device: string | null; friction_type: string; severity: string; observation: string; observed_on: string | null; created_at: string };

const FRICTION = ["DeadClickCount", "RageClickCount", "ExcessiveScroll", "QuickbackClick", "ScriptErrorCount", "ErrorClickCount"];
const LABEL: Record<string, string> = {
  DeadClickCount: "Dead clicks", RageClickCount: "Rage clicks", ExcessiveScroll: "Excessive scrolling", QuickbackClick: "Quick backs",
  ScriptErrorCount: "Script errors", ErrorClickCount: "Error clicks", Traffic: "Sessions", ScrollDepth: "Scroll depth", EngagementTime: "Engagement time",
};

export default async function ClarityPage() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const supabase = await createClient();
  const since = shiftDays(todayIn("UTC"), -30);
  const [{ data: conn }, metrics, { data: reviews }] = await Promise.all([
    supabase.from("integration_connections").select("status, last_synced_at, last_error").eq("client_id", client.id).eq("provider", "clarity").maybeSingle(),
    supabase.from("clarity_behavior_metrics").select("metric_date, dimension, value, metric, count, sessions_pct").eq("client_id", client.id).gte("metric_date", since).limit(5000),
    supabase.from("clarity_recording_reviews").select("*").eq("client_id", client.id).order("created_at", { ascending: false }).limit(50),
  ]);
  const migrationMissing = Boolean(metrics.error);
  const rows = (metrics.data ?? []) as MetricRow[];
  const totals = FRICTION.map((m) => ({ m, v: rows.filter((r) => r.dimension === "total" && r.metric === m).reduce((a, r) => a + (r.count ?? 0), 0) }));
  const days = new Set(rows.map((r) => r.metric_date)).size;
  const byUrl = new Map<string, Record<string, number>>();
  for (const r of rows.filter((x) => x.dimension === "url" && FRICTION.includes(x.metric))) {
    const o = byUrl.get(r.value) ?? {};
    o[r.metric] = (o[r.metric] ?? 0) + (r.count ?? 0);
    byUrl.set(r.value, o);
  }
  const pages = [...byUrl.entries()].map(([url, m]) => ({ url, m, total: Object.values(m).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total).slice(0, 15);
  const connected = conn?.status === "connected";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title="Microsoft Clarity" description="Behaviour signals (rage clicks, dead clicks, excessive scrolling, quick backs) and reviewed session recordings." />

      {migrationMissing && <Unavailable title="Database update needed" body="Apply migration 20261021000011 in Supabase to enable Clarity." />}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold">Connection {connected ? <span className="ml-2 text-sm text-positive">Connected</span> : <span className="ml-2 text-sm text-muted">Not connected</span>}</h2>
        {conn?.last_synced_at && <p className="mt-1 text-xs text-muted">Last synced {new Date(conn.last_synced_at).toLocaleString()}</p>}
        {conn?.last_error && <p className="mt-1 text-sm text-negative">{conn.last_error}</p>}
        <div className="mt-3"><ConnectClarity connected={connected} canEdit={canEdit} /></div>
        <p className="mt-3 text-xs text-muted">
          Clarity&apos;s official Data Export API returns only the last 1–3 days (10 requests per project per day), so this dashboard stores one day per
          daily sync and builds history over time. There is no official API for session recordings: recordings can&apos;t be downloaded or analysed
          automatically, so recording insights come from the reviewer observations below.
        </p>
      </section>

      {rows.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Last {days} stored day(s)</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {totals.map((t) => (
              <div key={t.m} className="rounded-lg bg-surface-muted p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#D4970A]">{LABEL[t.m]}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums">{t.v.toLocaleString("en-US")}</p>
                <p className="text-xs text-muted">Source: Clarity</p>
              </div>
            ))}
          </div>
          <ReportTable<(typeof pages)[number]> title="Pages with the most friction signals" source="Microsoft Clarity" empty="No page-level data yet." rows={pages}
            columns={[
              { label: "Page", render: (p) => <span className="break-all">{p.url || "(unknown)"}</span> },
              { label: "Rage", align: "right", render: (p) => p.m.RageClickCount ?? 0 },
              { label: "Dead", align: "right", render: (p) => p.m.DeadClickCount ?? 0 },
              { label: "Excess. scroll", align: "right", render: (p) => p.m.ExcessiveScroll ?? 0 },
              { label: "Quick backs", align: "right", render: (p) => p.m.QuickbackClick ?? 0 },
            ]} />
        </section>
      ) : connected ? (
        <Unavailable title="No Clarity data stored yet" body="The first import runs right after connecting; then one day is added per daily sync." />
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold">Recording reviews</h2>
        <p className="mt-1 text-sm text-muted">
          Watch recordings in Clarity (filter by rage or dead clicks), then log what you saw. The AI analysis uses these as human observations
          alongside GA4 landing-page data; it never claims to have watched a recording itself.
        </p>
        <div className="mt-4"><ReviewForm /></div>
      </section>

      {(reviews ?? []).length > 0 && (
        <ReportTable<Review> title="Logged observations" empty="" rows={(reviews ?? []) as Review[]} columns={[
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
