import type { Metadata } from "next";
import { BrandLockup } from "@/components/brand/brand-mark";
import { ReportBody, reportChapters } from "@/components/report/report-body";
import { CHAPTER_COLORS } from "@/components/report/report-ui";
import { getSession } from "@/lib/analytics/client-context";
import { isMonth, monthLabel, monthRange, resolveRange } from "@/lib/analytics/range";
import { resourceScope } from "@/lib/analytics/resource-scope";
import { first, type SearchParams } from "@/lib/analytics/url";
import { loadReportData } from "@/lib/report/data";
import { PrintControls } from "./print-controls";

export const metadata: Metadata = { title: "SEO Performance Report" };


/**
 * Report-only rendering: no sidebar, navigation, header controls, profile or admin UI.
 * Uses the same data loader as the Overview, so the printed report matches the dashboard.
 * ?month=YYYY-MM or ?start=&end=, ?type=full|executive, optional ?property= / ?site=, ?print=1.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return <p className="p-8">No client selected.</p>;
  const sp = await searchParams;
  const executive = first(sp.type) === "executive";
  const m = first(sp.month);
  const range = isMonth(m)
    ? monthRange(m)
    : resolveRange({ range: first(sp.range) ?? (first(sp.start) ? undefined : "month"), start: first(sp.start), end: first(sp.end) },
        client.timezone, client.defaultRangeDays);
  const isFullMonth = isMonth(m) || ("preset" in range && range.preset === "month")
    || (range.start.endsWith("-01") && range.end === monthRange(range.start.slice(0, 7)).end);
  const periodLabel = isFullMonth ? monthLabel(range.start.slice(0, 7)) : `${range.start} – ${range.end}`;

  const scope = await resourceScope(client.id, sp);
  const data = await loadReportData(scope.supabase, client.id, { start: range.start, end: range.end }, true);
  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const toc = reportChapters(data, executive);
  const properties = [scope.label(scope.ga4, scope.ga4Pick), scope.label(scope.gsc, scope.gscPick)].filter(Boolean).join(" · ");

  return (
    <div className="report-root min-h-screen bg-background">
      <PrintControls autoPrint={first(sp.print) === "1"} />

      <div className="mx-auto max-w-[210mm] bg-surface px-[14mm] py-[14mm] print:max-w-none print:p-0">
        {/* cover */}
        <section className="report-cover flex min-h-[250mm] flex-col justify-between print:min-h-[265mm]">
          <BrandLockup tagline="Analytics Dashboard" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              {executive ? "Executive summary" : "Monthly performance report"}
            </p>
            <h1 className="mt-3 text-5xl font-extrabold leading-tight tracking-tight">{client.name}</h1>
            <p className="mt-4 text-2xl font-semibold text-foreground/80">{periodLabel}</p>
            {properties && <p className="mt-2 text-sm text-muted">{properties}</p>}
          </div>
          <div className="flex items-end justify-between text-sm text-muted">
            <p>Generated {generated}</p>
            <p>Sources: connected Google, Microsoft and partner APIs · figures are never estimated</p>
          </div>
        </section>

        {/* contents */}
        <section className="report-page-break pt-2">
          <h2 className="text-xl font-semibold tracking-[-0.015em]">Contents</h2>
          <ol className="mt-6 divide-y divide-border border-y border-border">
            {toc.map((t, i) => (
              <li key={t} className="flex items-baseline gap-4 py-3">
                <span className="w-10 text-2xl font-extrabold tabular-nums" style={{ color: CHAPTER_COLORS[i % CHAPTER_COLORS.length] }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-medium">{t}</span>
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-lg bg-surface-muted p-5 text-sm text-muted">
            <p className="font-semibold text-foreground">How to read this report</p>
            <p className="mt-1">
              Green arrows mark improvements and red arrows declines. MoM compares with the previous calendar month for
              monthly reports (or the previous equal-length period otherwise); YoY appears only where last year&apos;s data
              is stored. A dash means no comparable data, never zero. Clicks on a call button are not the same as calls or leads.
            </p>
          </div>
        </section>

        <div className="report-page-break pt-2">
          <ReportBody d={data} opts={{ variant: "print", executive, basisLabel: isFullMonth ? "vs the previous month" : "vs the previous period of equal length" }} />
        </div>
      </div>
    </div>
  );
}
