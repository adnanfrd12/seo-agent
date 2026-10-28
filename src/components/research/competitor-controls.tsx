"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, RefreshCw, X } from "lucide-react";
import { runCompetitorsNow, runKeywordGap, saveCompetitors } from "@/app/(dashboard)/research-actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const field = "w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
type R = { ok: true; message: string } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<R>) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });
  const note = msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>;
  return { pending, run, note };
}

/** Manual re-analysis. Normal use never needs it: the analysis runs by itself every 24 hours. */
export function ReanalyzeButton({ canEdit, analysedToday }: { canEdit: boolean; analysedToday: boolean }) {
  const { pending, run, note } = useRun();
  if (!canEdit) return null;
  return (
    <div className="space-y-1">
      <button className={btn2} disabled={pending} onClick={() => {
        if (analysedToday && !confirm("The analysis already ran today. Run it again anyway? This costs about $0.12.")) return;
        run(() => runCompetitorsNow(analysedToday));
      }}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Re-analyse now <span className="opacity-70">(≈$0.12)</span>
      </button>
      {note}
    </div>
  );
}

/** Content gap against any domain you type (not only tracked competitors). About 3 cents; the answer is stored for 7 days. */
export function KeywordGapForm({ canEdit, suggestions }: { canEdit: boolean; suggestions: string[] }) {
  const { pending, run, note } = useRun();
  const [c, setC] = useState("");
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">Any competitor
        <input list="kw-gap-suggestions" className={`${field} mt-1 w-64`} value={c} onChange={(e) => setC(e.target.value)} placeholder="competitor.com"
          onKeyDown={(e) => { if (e.key === "Enter" && c.trim().length > 3) run(() => runKeywordGap(c, false)); }} />
        <datalist id="kw-gap-suggestions">{suggestions.map((x) => <option key={x} value={x} />)}</datalist>
      </label>
      <button className={btn} disabled={pending || c.trim().length < 4} onClick={() => run(() => runKeywordGap(c, false))}>
        {pending && <Loader2 className="size-4 animate-spin" />} Find content gaps <span className="opacity-70">(≈$0.03)</span>
      </button>
      {note}
    </div>
  );
}

/** Choose how competitors are picked, add your own, and hide ones that aren't real rivals. */
export function CompetitorManager({ canEdit, mode, manual, excluded, suggestions }: {
  canEdit: boolean; mode: "auto" | "manual"; manual: string[]; excluded: string[]; suggestions: string[];
}) {
  const { pending, run, note } = useRun();
  const [m, setM] = useState(mode);
  const [list, setList] = useState(manual);
  const [hidden, setHidden] = useState(excluded);
  const [draft, setDraft] = useState("");
  const dirty = m !== mode || list.join() !== manual.join() || hidden.join() !== excluded.join();
  const add = (d: string) => { const v = d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""); if (v.length > 3 && !list.includes(v)) setList([...list, v]); setHidden(hidden.filter((h) => h !== v)); setDraft(""); };

  return (
    <fieldset disabled={!canEdit || pending} className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        {([["auto", "Automatic: your picks plus the strongest overlapping competitors"], ["manual", "Manual: only the competitors I list"]] as const).map(([v, label]) => (
          <label key={v} className="flex items-start gap-2"><input type="radio" name="comp-mode" className="mt-1 accent-[var(--accent)]" checked={m === v} onChange={() => setM(v)} />{label}</label>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">Competitors you track</p>
        <ul className="flex flex-wrap gap-1.5">
          {list.map((d) => (
            <li key={d} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs">{d}
              <button type="button" aria-label={`Remove ${d}`} onClick={() => setList(list.filter((x) => x !== d))} className="rounded-full p-0.5 hover:bg-border"><X className="size-3" aria-hidden /></button></li>
          ))}
          {list.length === 0 && <li className="text-xs text-muted">None yet.</li>}
        </ul>
        <div className="mt-2 flex gap-2">
          <input className={`${field} max-w-xs`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="competitor.com" aria-label="Add a competitor domain"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }} />
          <button type="button" className={btn2} onClick={() => add(draft)} disabled={draft.trim().length < 4}><Plus className="size-4" aria-hidden /> Add</button>
        </div>
        {suggestions.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">Suggested:
            {suggestions.filter((d) => !list.includes(d)).slice(0, 6).map((d) => <button key={d} type="button" onClick={() => add(d)} className="rounded-full border border-border px-2 py-0.5 hover:bg-surface-muted">+ {d}</button>)}
          </p>
        )}
      </div>
      {hidden.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium">Hidden from automatic picks</p>
          <ul className="flex flex-wrap gap-1.5">{hidden.map((d) => (
            <li key={d} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted">{d}
              <button type="button" onClick={() => setHidden(hidden.filter((x) => x !== d))} className="underline hover:text-foreground">restore</button></li>
          ))}</ul>
        </div>
      )}
      <p className="text-xs text-muted">Up to 5 competitors are tracked. Each adds about 3 cents a day to the analysis, so fewer, closer rivals give a sharper and cheaper picture.</p>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && <button type="button" className={btn} disabled={!dirty || pending} onClick={() => run(() => saveCompetitors({ mode: m, competitors: list.join(","), excluded: hidden }))}>
          {pending && <Loader2 className="size-4 animate-spin" />} Save competitors</button>}
        {note}
      </div>
    </fieldset>
  );
}

/** Per-row actions in the "discovered competitors" table: track it, or hide it from automatic picks. */
export function DiscoveredActions({ canEdit, domain, mode, manual, excluded }: { canEdit: boolean; domain: string; mode: "auto" | "manual"; manual: string[]; excluded: string[] }) {
  const { pending, run } = useRun();
  if (!canEdit) return null;
  const tracked = manual.includes(domain);
  return (
    <span className="inline-flex gap-1.5">
      <button className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-surface-muted disabled:opacity-60" disabled={pending}
        onClick={() => run(() => saveCompetitors({ mode, competitors: (tracked ? manual.filter((d) => d !== domain) : [...manual, domain]).join(","), excluded: excluded.filter((d) => d !== domain) }))}>
        {tracked ? "Untrack" : "Track"}
      </button>
      {!excluded.includes(domain) && !tracked && (
        <button className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-muted disabled:opacity-60" disabled={pending}
          onClick={() => run(() => saveCompetitors({ mode, competitors: manual.join(","), excluded: [...excluded, domain] }))}>Hide</button>
      )}
    </span>
  );
}
