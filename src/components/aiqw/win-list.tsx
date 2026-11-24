"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { setWinOwner, setWinStatus, startQuickWins } from "@/app/(dashboard)/ai-quick-wins/actions";
import { CopyButton } from "@/components/ga4x/info";
import { Tag } from "@/components/ga4x/table";
import { SOURCE_SHORT, STATUS_LABEL, type Source, type Status, type StoredWin } from "@/lib/aiqw/types";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./badges";
import { RunSteps, useRun } from "./generate-panel";

export { SourceBadge };
const effTone = { Low: "good", Medium: "warn", High: "bad" } as const;
const confTone = { High: "good", Medium: "warn", Low: "mute" } as const;

function WinCard({ w, canEdit }: { w: StoredWin; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [owner, setOwner] = useState(w.owner ?? "");
  const [err, setErr] = useState<string | null>(null);
  const { run, setRunId } = useRun(null, () => router.refresh());
  const regenerating = run?.status === "running";
  const fmtV = (v?: number) => (v == null ? "—" : Number.isInteger(v) ? v.toLocaleString() : v < 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
  return (
    <article className={cn("min-w-0 rounded-[10px] border border-border bg-surface p-4", (w.status === "done" || w.status === "dismissed") && "opacity-75")} aria-labelledby={`w-${w.key}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">{w.rank || "–"}</span>
        <div className="min-w-0 flex-1">
          <h3 id={`w-${w.key}`} className="text-[15px] font-semibold leading-snug">{w.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Tag tone="acc">{w.type}</Tag><Tag tone={effTone[w.effort]}>Effort {w.effort}</Tag><Tag tone={confTone[w.confidence]}>Confidence {w.confidence}</Tag>
            {w.sources.map((s) => <SourceBadge key={s} s={s} />)}
            {!w.seen_run && (w.status === "todo" || w.status === "doing") && <Tag tone="mute">No longer found in the data</Tag>}
          </div>
        </div>
        <div className="shrink-0 text-right"><p className="text-lg font-bold tabular-nums text-positive">+{w.computed_gain}</p><p className="text-[11px] text-muted">{w.gain_unit} (est.)</p></div>
      </div>
      <p className="mt-3 rounded-md bg-surface-muted p-2.5 text-sm"><b>For the owner:</b> {w.plain_summary}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2 text-sm">
          <p><b>Page:</b> {w.page_url.startsWith("/") ? <a href={w.page_url} target="_blank" rel="noreferrer" className="break-all text-accent underline-offset-2 hover:underline">{w.page_url}</a> : w.page_url}</p>
          <p><b>Where:</b> {w.where}</p>
          <p><b>Why:</b> {w.why}</p>
          {w.queries_to_use.length > 0 && <p><b>Queries to use:</b> {w.queries_to_use.map((q) => <span key={q} className="mr-1 inline-block rounded bg-surface-muted px-1.5 py-0.5 text-xs">{q}</span>)}</p>}
          {w.evidence.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-secondary">Evidence ({w.evidence.length})</summary>
              <div className="mt-1 overflow-x-auto"><table className="w-full text-xs"><tbody>
                {w.evidence.map((e, i) => <tr key={i} className="border-b border-hairline align-top"><td className="py-1 pr-2 text-muted">{e.name}</td><td className="py-1 pr-2">{e.value}</td><td className="py-1"><SourceBadge s={e.source} /></td></tr>)}
              </tbody></table></div>
            </details>
          )}
        </div>
        <div className="min-w-0 space-y-2 text-sm">
          <ol className="list-decimal space-y-1 pl-5">{w.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {w.suggested_change && (
            <div className="rounded-md border border-border bg-background p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-muted">Suggested change</span><CopyButton text={w.suggested_change} /></div>
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px]">{w.suggested_change}</pre>
            </div>
          )}
          <p className="text-xs text-muted"><b>Measure:</b> {w.measure}</p>
        </div>
      </div>
      {(w.baseline || w.result) && (
        <p className="mt-2 text-xs text-muted">
          Before: {w.baseline?.clicks != null ? `${fmtV(w.baseline.clicks)} clicks · ${fmtV(w.baseline.impressions)} impr. · CTR ${fmtV(w.baseline.ctr)} · pos ${fmtV(w.baseline.position)}` : w.baseline?.leads != null ? `${fmtV(w.baseline.leads)} leads` : "—"}
          {w.result ? ` → 28 days after done: ${fmtV(w.result.clicks)} clicks · ${fmtV(w.result.impressions)} impr. · CTR ${fmtV(w.result.ctr)} · pos ${fmtV(w.result.position)}` : w.status === "done" ? " → result measured 28 days after it was marked done" : ""}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-sm">
        <label className="flex items-center gap-1.5 text-xs text-muted">Status
          <select value={w.status} disabled={!canEdit || pending} onChange={(e) => start(async () => { const r = await setWinStatus(w.key, e.target.value as Status); if (!r.ok) setErr(r.error); router.refresh(); })} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">Owner
          <input value={owner} disabled={!canEdit} onChange={(e) => setOwner(e.target.value)} onBlur={() => owner !== (w.owner ?? "") && start(async () => { const r = await setWinOwner(w.key, owner); if (!r.ok) setErr(r.error); })} placeholder="Name" className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
        </label>
        <button type="button" disabled={!canEdit || regenerating} onClick={async () => { const r = await startQuickWins({ scope: { kind: "item", key: w.key }, depth: "standard", sources: ["gsc", "ga4", "gbp", "bing", "clarity", "youtube", "facebook", "instagram", "threads", "x", "tiktok", "pinterest", "linkedin", "dataforseo", "crawl", "seosignalx"] }); if (r.ok) setRunId(r.runId); else setErr(r.error); }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-50">
          {regenerating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Regenerate this item
        </button>
      </div>
      {run && run.status !== "done" && <div className="mt-2"><RunSteps run={run} /></div>}
      {err && <p role="alert" className="mt-1 text-xs text-negative">{err}</p>}
    </article>
  );
}

/** Every stored quick win as a card, with status / type / source filters and search. */
export function WinList({ wins, canEdit, compact = false }: { wins: StoredWin[]; canEdit: boolean; compact?: boolean }) {
  const [status, setStatus] = useState<"open" | Status | "all">("open");
  const [type, setType] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const open = (w: StoredWin) => w.status === "todo" || w.status === "doing";
  const types = useMemo(() => [...new Set(wins.map((w) => w.type))], [wins]);
  const srcs = useMemo(() => [...new Set(wins.flatMap((w) => w.sources))], [wins]);
  const shown = wins.filter((w) => (status === "all" || (status === "open" ? open(w) : w.status === status)) && (!type || w.type === type) && (!src || w.sources.includes(src as Source)) && (!q || `${w.title} ${w.page_url} ${w.why}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9) || b.score - a.score);
  const tasks = shown.map((w) => `${w.rank || "-"}. ${w.title} (${w.page_url} · ${w.where}) +${w.computed_gain} ${w.gain_unit}`).join("\n");
  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-surface-muted");
  if (!wins.length) return <p className="rounded-[10px] border border-dashed border-border p-6 text-center text-sm text-muted">No quick wins yet. Press Generate quick wins.</p>;
  return (
    <div>
      {!compact && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1">
            {(["open", "todo", "doing", "done", "dismissed", "all"] as const).map((s) => <button key={s} type="button" className={chip(status === s)} onClick={() => setStatus(s)}>{s === "open" ? "Open" : s === "all" ? "All" : STATUS_LABEL[s]} <b className="text-faint">{wins.filter((w) => s === "all" || (s === "open" ? open(w) : w.status === s)).length}</b></button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Type" value={type ?? ""} onChange={(e) => setType(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-xs"><option value="">All types</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
            <select aria-label="Source" value={src ?? ""} onChange={(e) => setSrc(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-xs"><option value="">All sources</option>{srcs.map((s) => <option key={s} value={s}>{SOURCE_SHORT[s]}</option>)}</select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search quick wins" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs" />
            <CopyButton text={tasks} label="Copy as task list" />
          </div>
        </div>
      )}
      <div className="space-y-3">{shown.map((w) => <WinCard key={w.key} w={w} canEdit={canEdit} />)}</div>
      {!shown.length && <p className="text-sm text-muted">Nothing matches these filters.</p>}
    </div>
  );
}
