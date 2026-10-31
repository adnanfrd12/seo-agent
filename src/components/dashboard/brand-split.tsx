"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveBrandTerms } from "@/app/(dashboard)/brand-actions";
import { fmtDecimal, fmtInt, fmtPercent } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

export interface BrandSplitData {
  has_data: boolean;
  branded: { queries: number; clicks: number; impressions: number; position: number | null };
  non_branded: { queries: number; clicks: number; impressions: number; position: number | null };
  top_branded: { query: string; clicks: number; impressions: number }[];
  top_non_branded: { query: string; clicks: number; impressions: number }[];
}

function Share({ label, value, total, cls }: { label: string; value: number; total: number; cls: string }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{label}</span><span className="tabular-nums text-muted">{fmtInt(value)} · {pct.toFixed(0)}%</span></div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-muted"><div className={cn("h-full rounded-full", cls)} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function List({ title, rows }: { title: string; rows: BrandSplitData["top_branded"] }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted">None in this period.</p> : (
        <ul className="space-y-0.5 text-sm">{rows.map((r) => <li key={r.query} className="flex justify-between gap-3"><span className="break-words">{r.query}</span><span className="shrink-0 tabular-nums text-muted">{fmtInt(r.clicks)} clicks</span></li>)}</ul>
      )}
    </div>
  );
}

/**
 * Branded vs non-branded search. Branded clicks come from people who already know the business;
 * non-branded clicks are new demand SEO is winning. The split covers the queries Google reports
 * (it hides rare, anonymised ones), and the brand terms are editable so it stays reliable.
 */
export function BrandSplit({ data, terms, canEdit }: { data: BrandSplitData; terms: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(terms.join(", "));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const totalClicks = data.branded.clicks + data.non_branded.clicks;
  const totalImpr = data.branded.impressions + data.non_branded.impressions;
  const save = () => start(async () => {
    const r = await saveBrandTerms(draft);
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });
  return (
    <section className="rise rounded-[10px] border border-border bg-surface p-5" aria-labelledby="brand-h">
      <h2 id="brand-h" className="text-sm font-semibold">Branded vs non-branded search</h2>
      <p className="mt-0.5 text-xs text-muted">Branded = queries that contain your name. A healthy site keeps winning non-branded searches, because those are customers who didn&apos;t know you yet.</p>
      {!data.has_data || totalImpr === 0 ? (
        <p className="mt-4 text-sm text-muted">No query-level data for this period yet.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Clicks</p>
              <Share label="Non-branded" value={data.non_branded.clicks} total={totalClicks} cls="bg-accent" />
              <Share label="Branded" value={data.branded.clicks} total={totalClicks} cls="bg-[#2563EB]" />
              <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Impressions</p>
              <Share label="Non-branded" value={data.non_branded.impressions} total={totalImpr} cls="bg-accent" />
              <Share label="Branded" value={data.branded.impressions} total={totalImpr} cls="bg-[#2563EB]" />
              <p className="text-xs text-muted">
                Average position: non-branded {fmtDecimal(data.non_branded.position)}, branded {fmtDecimal(data.branded.position)}. CTR: non-branded {fmtPercent(data.non_branded.impressions ? data.non_branded.clicks / data.non_branded.impressions : null, 1)},
                branded {fmtPercent(data.branded.impressions ? data.branded.clicks / data.branded.impressions : null, 1)}.
              </p>
            </div>
            {/* stacked, not side by side: the branded list is usually a line or two and would leave a tall blank column */}
            <div className="grid content-start gap-5"><List title="Top non-branded queries" rows={data.top_non_branded} /><List title="Top branded queries" rows={data.top_branded} /></div>
          </div>
          <p className="mt-3 text-xs text-muted">Based on the queries Search Console reports; rare queries Google hides (anonymised) aren&apos;t included, so shares describe the visible queries.</p>
        </>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-accent">Brand terms used {canEdit ? "(edit)" : ""}</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 text-xs text-muted">Words that identify the brand, comma separated (spaces are ignored, e.g. &quot;ledlightsandsigns&quot;)
            <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground disabled:opacity-60" value={draft} disabled={!canEdit || pending} onChange={(e) => setDraft(e.target.value)} />
          </label>
          {canEdit && <button className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60" disabled={pending || draft.trim() === terms.join(", ")} onClick={save}>{pending && <Loader2 className="size-4 animate-spin" />} Save</button>}
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mt-1 text-sm", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
      </details>
    </section>
  );
}
