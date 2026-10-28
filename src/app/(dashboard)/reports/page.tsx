import Link from "next/link";
import { Printer } from "lucide-react";
import { PdfDownloadButton } from "@/components/report/pdf-download";
import { TabHeader } from "@/components/dashboard/tab-header";
import { getSession } from "@/lib/analytics/client-context";
import { monthLabel, previousMonth, todayIn } from "@/lib/analytics/range";

/** Last 12 complete calendar months, newest first. */
function months(tz: string) {
  const out: string[] = [];
  let m = previousMonth(todayIn(tz));
  for (let i = 0; i < 12; i++) { out.push(m); m = previousMonth(`${m}-15`); }
  return out;
}

export default async function ReportsPage() {
  const { client } = await getSession();
  if (!client) return null;
  return (
    <div className="mx-auto max-w-4xl">
      <TabHeader source={null} eyebrow="Reporting" title="Monthly Reports" description="Full monthly reports and executive summaries, rendered from stored data without the dashboard sidebar. Months with no connected data show unavailable sections, never zeros." />
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {months(client.timezone).map((m) => (
          <li key={m} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-40 font-medium">{monthLabel(m)}</span>
            <div className="ml-auto flex flex-wrap gap-2 text-sm">
              <Link href={`/report?month=${m}`} target="_blank" className="rounded-lg border border-border px-3 py-1.5 hover:bg-surface-muted">View</Link>
              <PdfDownloadButton primary href={`/api/report/pdf?month=${m}&type=full`} printHref={`/report?month=${m}&type=full&print=1`}
                label="Full PDF" filename={`report-${m}-full.pdf`} />
              <PdfDownloadButton href={`/api/report/pdf?month=${m}&type=executive`} printHref={`/report?month=${m}&type=executive&print=1`}
                label="Executive PDF" filename={`report-${m}-executive.pdf`} />
              <Link href={`/report?month=${m}&print=1`} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 hover:bg-surface-muted">
                <Printer className="size-4" aria-hidden /> Print
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
