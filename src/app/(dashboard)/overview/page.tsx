import { memo } from "@/lib/memo";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CompareBars, ShareDonut } from "@/components/charts/analytics-charts";
import { MetricTrend } from "@/components/charts/metric-trend";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { AlertsPanel } from "@/components/overview/alerts-panel";
import { Onboarding } from "@/components/overview/onboarding";
import { ChangesPanel, CompetitorSnapshot, HealthPanel, Hero, KpiBand, NextActions, TopAndOpportunities, type NextAction } from "@/components/overview/command-center";
import { ExportMenu } from "@/components/report/export-menu";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { resourceOptions, resourceScope } from "@/lib/analytics/resource-scope";
import { dailySeries } from "@/lib/analytics/trend";
import { first, type SearchParams } from "@/lib/analytics/url";
import { loadAlerts } from "@/lib/alerts";
import { loadCompetitors } from "@/lib/dataforseo/competitors";
import { computeGrowth, computeHealth } from "@/lib/overview/score";
import { loadDataStatus } from "@/lib/overview/status";
import { loadReportData, type ReportData } from "@/lib/report/data";

const PATH = "/overview";

/** AI recommendations first (highest priority, not yet done), then rules over the stored data. */
function buildNextActions(d: ReportData, comp: Awaited<ReturnType<typeof loadCompetitors>> | null): NextAction[] {
  const out: NextAction[] = [];
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const open = (d.ai?.recommendations ?? []).filter((x) => !["implemented", "dismissed"].includes(x.implementation_status));
  for (const r of open.sort((a, b) => (rank[a.priority as keyof typeof rank] ?? 3) - (rank[b.priority as keyof typeof rank] ?? 3)).slice(0, 3)) {
    out.push({ title: r.title, why: r.summary.slice(0, 160), priority: (r.priority as NextAction["priority"]) ?? "medium", href: "/insights", source: "AI" });
  }
  const rules: NextAction[] = [];
  if (d.research?.spike) rules.push({ title: "Review the suspicious backlink jump", why: `${d.research.spike.newDomains.toLocaleString("en-US")} new referring domains in ${d.research.spike.month}: check anchors and spam scores, then consider disavowing.`, priority: "high", href: "/backlinks", source: "Data" });
  if (comp?.threats[0]) rules.push({ title: `Respond to ${comp.threats[0].domain} gaining ground`, why: `Their ranking keywords grew from ${comp.threats[0].keywordsFrom} to ${comp.threats[0].keywordsTo}. See the keyword gaps they cover.`, priority: "medium", href: "/competitors", source: "Data" });
  const qw = d.research?.quickWins[0];
  if (qw) rules.push({ title: `Push "${String(qw.keyword)}" onto page one`, why: `It ranks #${String(qw.position)} with ${String(qw.volume)} monthly searches: improve the page title, content and internal links.`, priority: "medium", href: "/organic-keywords", source: "Data" });
  if (d.gbpReviews && d.gbpReviews.replyRate !== null && d.gbpReviews.replyRate < 0.5) rules.push({ title: "Reply to your Google reviews", why: `Only ${(d.gbpReviews.replyRate * 100).toFixed(0)}% of ${d.gbpReviews.total} reviews have an owner reply.`, priority: "medium", href: "/business-profile", source: "Data" });
  if ((d.opportunities?.decaying_pages.length ?? 0) > 0) rules.push({ title: "Refresh pages losing clicks", why: `${d.opportunities!.decaying_pages.length} pages are getting fewer clicks than the previous period.`, priority: "medium", href: "/opportunities", source: "Data" });
  for (const r of rules) if (out.length < 5 && !out.some((o) => o.title === r.title)) out.push(r);
  return out.slice(0, 5);
}

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client, user } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  // the executive report defaults to the last complete calendar month
  const range = resolveRange(
    { range: first(sp.range) ?? (first(sp.start) ? undefined : "month"), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays,
  );
  const compare = first(sp.compare) === "1";
  const scope = await resourceScope(client.id, sp);
  const propertyOptions = resourceOptions(scope.ga4, "All properties (combined)");
  const siteOptions = resourceOptions(scope.gsc, "All sites (combined)");

  // all reads in parallel; the stored data only changes when a sync or a check runs, so a repeat
  // view within three minutes reuses it (the key holds the user, client, period and picked property/site)
  const key = `overview|${user.id}|${client.id}|${range.start}|${range.end}|${compare}|${scope.ga4Pick?.id ?? ""}|${scope.gscPick?.id ?? ""}`;
  let data: ReportData;
  let comp: Awaited<ReturnType<typeof loadCompetitors>> | null, alerts: Awaited<ReturnType<typeof loadAlerts>>, status: Awaited<ReturnType<typeof loadDataStatus>>;
  try {
    [data, comp, alerts, status] = await memo(key, 180_000, () => Promise.all([
      loadReportData(scope.supabase, client.id, range, compare),
      // a missing table (migration not applied) just hides that panel
      loadCompetitors(scope.supabase, client.id).catch(() => null),
      loadAlerts(scope.supabase, client.id).catch(() => []),
      loadDataStatus(scope.supabase, client.id).catch(() => []),
    ]));
  } catch {
    return <p role="alert" className="rounded-lg bg-negative-soft p-3 text-sm text-negative">Could not load the overview. Please try again.</p>;
  }
  const growth = computeGrowth(data);
  const health = computeHealth(data, { staleSources: status.filter((s) => s.health === "stale" || s.health === "error").map((s) => s.label) });
  const nextActions = buildNextActions(data, comp);

  // export links carry the exact period and property/site so the report matches this screen
  const qs = new URLSearchParams({ start: range.start, end: range.end });
  if (scope.ga4Pick) qs.set("property", scope.ga4Pick.id);
  if (scope.gscPick) qs.set("site", scope.gscPick.id);
  const reportHref = (type: "full" | "executive", print = false) =>
    `/report?${qs.toString()}&type=${type}${print ? "&print=1" : ""}`;
  // server-rendered PDF file (falls back to the print view if Chromium isn't available)
  const pdfHref = (type: "full" | "executive") => `/api/report/pdf?${qs.toString()}&type=${type}`;
  const fileBase = `${client.name.replace(/[^w-]+/g, "-").slice(0, 40) || "report"}-${range.start}_${range.end}`;
  // the on-screen full report keeps the same period, properties and comparison
  const onScreen = new URLSearchParams(qs);
  if (compare) onScreen.set("compare", "1");

  const trend = [
    ...(data.connected.ga4 ? [
      { key: "sessions", label: "Sessions", data: dailySeries(data.ga4Trend, "sessions", range) },
      { key: "users", label: "Users", data: dailySeries(data.ga4Trend, "users", range) },
    ] : []),
    ...(data.connected.gsc ? [
      { key: "clicks", label: "Search clicks", data: dailySeries(data.gscTrend, "clicks", range) },
      { key: "impressions", label: "Impressions", data: dailySeries(data.gscTrend, "impressions", range) },
    ] : []),
  ];

  return (
    <div className="space-y-6">
      <Hero clientName={client.name} rangeLabel={`${fmtDay(range.start)} – ${fmtDay(range.end)}`} growth={growth} status={status} comp={comp} unseenAlerts={alerts.filter((a) => !a.seen_at).length}
        actions={<ExportMenu fullPdf={pdfHref("full")} execPdf={pdfHref("executive")} fullPrint={reportHref("full", true)} execPrint={reportHref("executive", true)} reportPage={`/overview/report?${onScreen.toString()}`} fileBase={fileBase} />} />

      {(propertyOptions || siteOptions) && (
        <div className="flex flex-wrap items-end gap-3">
          {propertyOptions && <FilterSelect label="GA4 property" name="property" value={scope.ga4Pick?.id ?? ""} path={PATH} sp={sp} options={propertyOptions} />}
          {siteOptions && <FilterSelect label="Search Console site" name="site" value={scope.gscPick?.id ?? ""} path={PATH} sp={sp} options={siteOptions} />}
        </div>
      )}
      <Onboarding status={status} />
      <KpiBand d={data} />
      {trend.length > 0 && <MetricTrend title="Traffic and search" source={compare ? "vs previous period" : undefined} options={trend} />}
      {/* the action list is the taller column: the channel chart under "What changed" grows to its height */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
          <ChangesPanel d={data} />
          {data.channels.length > 0 && (
            <CompareBars fill title="Sessions by channel" sub="Top four GA4 channels · this period against the previous one" valueLabel="Sessions"
              rows={data.channels.slice(0, 4).map((c) => ({ label: c.channel, current: Number(c.sessions), previous: c.prevSessions == null ? null : Number(c.prevSessions) }))} />
          )}
        </div>
        <div className="lg:col-span-2"><NextActions items={nextActions} /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6">
          <CompetitorSnapshot comp={comp} />
          {data.devices.length > 0 && <ShareDonut title="Sessions by device" sub="Google Analytics 4 · this period" centerLabel="sessions" items={data.devices.map((x) => ({ label: x.value, value: Number(x.sessions) }))} />}
        </div>
        <HealthPanel checks={health} />
        <div id="alerts" className="scroll-mt-6"><AlertsPanel alerts={alerts} /></div>
      </div>
      <TopAndOpportunities d={data} />

      <Link href={`/overview/report?${onScreen.toString()}`}
        className="group flex items-center justify-between gap-4 rounded-[10px] border border-border bg-surface px-4 py-4 transition-colors hover:border-border-strong sm:px-5">
        <span>
          <span className="block text-[15px] font-semibold">Full report</span>
          <span className="mt-0.5 block text-[13px] text-secondary">Every metric, chapter by chapter: the same content as the PDF.</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-faint transition-colors group-hover:text-foreground" aria-hidden />
      </Link>
    </div>
  );
}
