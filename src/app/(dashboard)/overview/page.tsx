import Link from "next/link";
import { Printer } from "lucide-react";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { AlertsPanel } from "@/components/overview/alerts-panel";
import { ChangesPanel, CompetitorSnapshot, HealthPanel, Hero, KpiBand, NextActions, TopAndOpportunities, type NextAction } from "@/components/overview/command-center";
import { ReportBody } from "@/components/report/report-body";
import { PdfDownloadButton } from "@/components/report/pdf-download";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { resourceOptions, resourceScope } from "@/lib/analytics/resource-scope";
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

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
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

  let data: ReportData;
  try {
    data = await loadReportData(scope.supabase, client.id, range, compare);
  } catch {
    return <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load the overview. Please try again.</p>;
  }
  // everything below reads stored data only; a missing table (migration not applied) just hides that panel
  const [comp, alerts, status] = await Promise.all([
    loadCompetitors(scope.supabase, client.id).catch(() => null),
    loadAlerts(scope.supabase, client.id).catch(() => []),
    loadDataStatus(scope.supabase, client.id).catch(() => []),
  ]);
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
  const basisLabel = range.preset === "month" ? "vs the previous month" : "vs the previous period of equal length";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Overview</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{client.name}</h1>
          <p className="mt-1 text-sm text-muted">{range.start} → {range.end} · every figure compares with the previous period and, where history exists, month and year ago</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PdfDownloadButton primary href={pdfHref("full")} printHref={reportHref("full", true)}
            label="Download full report PDF" filename={`${fileBase}-full-report.pdf`} />
          <PdfDownloadButton href={pdfHref("executive")} printHref={reportHref("executive", true)}
            label="Executive summary PDF" filename={`${fileBase}-executive-summary.pdf`} />
          <Link href={reportHref("full", true)} target="_blank"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-muted">
            <Printer className="size-4" aria-hidden /> Print report
          </Link>
        </div>
      </div>

      <RangeSelector path={PATH} sp={sp} range={range} />
      {(propertyOptions || siteOptions) && (
        <div className="mb-5 flex flex-wrap items-end gap-3">
          {propertyOptions && <FilterSelect label="GA4 property" name="property" value={scope.ga4Pick?.id ?? ""} path={PATH} sp={sp} options={propertyOptions} />}
          {siteOptions && <FilterSelect label="Search Console site" name="site" value={scope.gscPick?.id ?? ""} path={PATH} sp={sp} options={siteOptions} />}
        </div>
      )}
      <div className="space-y-6">
        <Hero clientName={client.name} rangeLabel={`${range.start} → ${range.end}`} growth={growth} status={status} comp={comp} unseenAlerts={alerts.filter((a) => !a.seen_at).length} />
        <KpiBand d={data} />
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3"><ChangesPanel d={data} /></div>
          <div className="lg:col-span-2"><NextActions items={nextActions} /></div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <CompetitorSnapshot comp={comp} />
          <HealthPanel checks={health} />
          <div id="alerts"><AlertsPanel alerts={alerts} /></div>
        </div>
        <TopAndOpportunities d={data} />
      </div>

      <div className="mt-12 border-t border-border pt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Detailed report</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight">Every metric, chapter by chapter</h2>
        <p className="mb-6 mt-1 text-sm text-muted">The same content that goes into the PDF report.</p>
        <ReportBody d={data} opts={{ variant: "dashboard", basisLabel }} />
      </div>
    </div>
  );
}
