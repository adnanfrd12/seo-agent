import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReportBody } from "@/components/report/report-body";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { resourceScope } from "@/lib/analytics/resource-scope";
import { first, type SearchParams } from "@/lib/analytics/url";
import { loadReportData, type ReportData } from "@/lib/report/data";

/** The full on-screen report (the same content as the PDF), on its own page instead of under the Overview. */
export default async function FullReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange(
    { range: first(sp.range) ?? (first(sp.start) ? undefined : "month"), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays,
  );
  const compare = first(sp.compare) === "1";
  const scope = await resourceScope(client.id, sp);
  let data: ReportData;
  try {
    data = await loadReportData(scope.supabase, client.id, range, compare);
  } catch {
    return <p role="alert" className="rounded-lg bg-negative-soft p-3 text-sm text-negative">Could not load the report. Please try again.</p>;
  }
  const back = new URLSearchParams();
  for (const k of ["start", "end", "property", "site", "compare"]) { const v = first(sp[k]); if (v) back.set(k, v); }
  const basisLabel = range.preset === "month" ? "vs the previous month" : "vs the previous period of equal length";
  return (
    <div>
      <Link href={`/overview${back.size ? `?${back.toString()}` : ""}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Overview
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.015em]">Full report</h1>
      <p className="mb-8 mt-1.5 text-sm text-secondary">{client.name} · {range.start} → {range.end} · every metric, chapter by chapter, {basisLabel}. The same content goes into the PDF.</p>
      <ReportBody d={data} opts={{ variant: "dashboard", basisLabel }} />
    </div>
  );
}
