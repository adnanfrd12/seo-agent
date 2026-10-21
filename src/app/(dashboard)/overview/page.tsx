import Link from "next/link";
import { FileText, Printer } from "lucide-react";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { ReportBody } from "@/components/report/report-body";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { resourceOptions, resourceScope } from "@/lib/analytics/resource-scope";
import { first, type SearchParams } from "@/lib/analytics/url";
import { loadReportData } from "@/lib/report/data";

const PATH = "/overview";

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

  let data;
  try {
    data = await loadReportData(scope.supabase, client.id, range, compare);
  } catch {
    return <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load the overview. Please try again.</p>;
  }

  // export links carry the exact period and property/site so the report matches this screen
  const qs = new URLSearchParams({ start: range.start, end: range.end });
  if (scope.ga4Pick) qs.set("property", scope.ga4Pick.id);
  if (scope.gscPick) qs.set("site", scope.gscPick.id);
  const reportHref = (type: "full" | "executive", print = false) =>
    `/report?${qs.toString()}&type=${type}${print ? "&print=1" : ""}`;
  const basisLabel = range.preset === "month" ? "vs the previous month" : "vs the previous period of equal length";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Performance report</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{client.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {range.start} → {range.end} · every figure compares month-over-month and, where history exists, year-over-year
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={reportHref("full", true)} target="_blank"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
              <FileText className="size-4" aria-hidden /> Full report PDF
            </Link>
            <Link href={reportHref("executive", true)} target="_blank"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-muted">
              <FileText className="size-4" aria-hidden /> Executive summary PDF
            </Link>
            <Link href={reportHref("full")} target="_blank"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-muted">
              <Printer className="size-4" aria-hidden /> Print view
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          <span><span className="font-semibold text-positive">↑ green</span> = improvement</span>
          <span><span className="font-semibold text-negative">↓ red</span> = decline</span>
          <span>— = no comparable data</span>
        </div>
      </div>

      <RangeSelector path={PATH} sp={sp} range={range} />
      {(propertyOptions || siteOptions) && (
        <div className="mb-5 flex flex-wrap items-end gap-3">
          {propertyOptions && <FilterSelect label="GA4 property" name="property" value={scope.ga4Pick?.id ?? ""} path={PATH} sp={sp} options={propertyOptions} />}
          {siteOptions && <FilterSelect label="Search Console site" name="site" value={scope.gscPick?.id ?? ""} path={PATH} sp={sp} options={siteOptions} />}
        </div>
      )}
      <div className="mt-8">
        <ReportBody d={data} opts={{ variant: "dashboard", basisLabel }} />
      </div>
    </div>
  );
}
