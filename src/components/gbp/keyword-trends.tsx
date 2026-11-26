"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchKeywordVolumes } from "@/app/(dashboard)/business-profile/actions";
import { cn } from "@/lib/utils";

export type KeywordTrendRow = {
  keyword: string;
  /** per stored month, oldest first: exact count, or the "< N" threshold when Google withholds it */
  months: { v: number | null; thr: number | null }[];
  inPrevious: boolean;
  volume: number | null;
  volumeTrend: number[];
  hasVolume: boolean;
};

const nf = new Intl.NumberFormat("en-US");
const cell = (m: { v: number | null; thr: number | null } | undefined) => (!m ? "—" : m.v != null ? nf.format(m.v) : m.thr != null ? `< ${nf.format(m.thr)}` : "—");
const val = (m: { v: number | null; thr: number | null } | undefined) => (m ? m.v ?? m.thr ?? 0 : 0);
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Tiny line of one keyword's monthly values (thresholds drawn at their bound). */
function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="text-xs text-faint">—</span>;
  const w = 72, h = 20, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--series)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Search keywords that showed the profile: this month vs last month (and whether it appeared last month), the
 * monthly trend over every stored month, and Google search volume from DataForSEO beside it.
 */
export function KeywordTrends({ months, rows, canEdit, missing, estimate, volumeAvailable }: {
  months: string[]; rows: KeywordTrendRow[]; canEdit: boolean;
  /** keywords without a (fresh) search volume, and the estimated cost of fetching them */
  missing: string[]; estimate: number; volumeAvailable: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useMemo(() => rows.filter((r) => !q || r.keyword.includes(q.trim().toLowerCase())), [rows, q]);
  const cur = months.length - 1, prev = months.length - 2;
  const fetchNow = () => start(async () => {
    const r = await fetchKeywordVolumes(missing);
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keywords…" aria-label="Search keywords"
          className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        {canEdit && volumeAvailable && missing.length > 0 && (
          <button type="button" onClick={fetchNow} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60">
            {pending && <Loader2 className="size-4 animate-spin" />} Get search volume for {missing.length} keyword{missing.length === 1 ? "" : "s"} (about ${estimate.toFixed(3)})
          </button>
        )}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mb-2 text-sm", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Keyword</th>
              <th className="px-3 py-2 text-right font-medium">{months[cur] ? monthLabel(months[cur]) : "This month"}</th>
              <th className="px-3 py-2 text-right font-medium">{months[prev] ? monthLabel(months[prev]) : "Last month"}</th>
              <th className="px-3 py-2 text-right font-medium">Change</th>
              <th className="px-3 py-2 font-medium" title={`Every stored month (${months.length})`}>Trend</th>
              <th className="px-3 py-2 text-right font-medium" title="Average monthly Google searches (DataForSEO)">Search volume</th>
              <th className="py-2 pl-3 font-medium">Volume trend</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r) => {
              const c = r.months[cur], p = r.months[prev];
              const diff = c?.v != null && p?.v != null ? c.v - p.v : null;
              return (
                <tr key={r.keyword} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <span className="break-words">{r.keyword}</span>
                    {months.length > 1 && !r.inPrevious && <span className="ml-1.5 rounded bg-positive-soft px-1 py-0.5 text-[10px] font-medium text-positive">new</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{cell(c)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted">{r.inPrevious ? cell(p) : "not shown"}</td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", diff == null ? "text-faint" : diff > 0 ? "text-positive" : diff < 0 ? "text-negative" : "text-muted")}>
                    {diff == null ? "—" : `${diff > 0 ? "+" : ""}${nf.format(diff)}`}
                  </td>
                  <td className="px-3 py-1.5"><Spark values={r.months.map(val)} label={`${r.keyword}: ${r.months.map((m, i) => `${monthLabel(months[i])} ${cell(m)}`).join(", ")}`} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.volume != null ? nf.format(r.volume) : r.hasVolume ? "no data" : "—"}</td>
                  <td className="py-1.5 pl-3"><Spark values={r.volumeTrend} label={`${r.keyword} search volume, last 12 months`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > limit && (
        <button type="button" className="mt-3 text-sm font-medium text-accent" onClick={() => setLimit((n) => n + 100)}>Show more ({list.length - limit} left)</button>
      )}
      <p className="mt-2 text-xs text-muted">
        Profile impressions per keyword come from Google Business Profile (monthly; “&lt; N” = a low count Google gives only as a threshold).
        Search volume is Google&apos;s average monthly searches from DataForSEO{volumeAvailable ? ", refreshed at most every 30 days" : " (not configured)"}.
      </p>
    </div>
  );
}
