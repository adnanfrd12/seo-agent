"use client";

import { useMemo, useState } from "react";
import { useStored } from "./stored";
import { cn } from "@/lib/utils";
import type { QuickWin } from "@/lib/ga4x/quickwins";
import { CopyButton } from "./info";
import { Tag } from "./table";

const KEY = "ga4x:qw-done";
const parse = (v: string | null): Record<string, string> => { try { return (JSON.parse(v ?? "{}") as Record<string, string>) ?? {}; } catch { return {}; } };

/** Every quick win as a card, with type / effort filters, search, Done ticks (saved in this browser), copy and CSV. */
export function QwList({ wins, scope, unit = "leads/mo" }: { wins: QuickWin[]; scope: string; unit?: string }) {
  const [type, setType] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [raw, store] = useStored(`${KEY}:${scope}`);
  const done = parse(raw);
  const toggle = (k: string) => { const n = { ...done }; if (n[k]) delete n[k]; else n[k] = new Date().toISOString().slice(0, 10); store(JSON.stringify(n)); };
  const types = useMemo(() => { const m = new Map<string, number>(); for (const w of wins) m.set(w.type, (m.get(w.type) ?? 0) + 1); return [...m]; }, [wins]);
  const shown = wins.filter((w) => (!type || w.type === type) && (!effort || w.effort === effort) && (!q || `${w.title} ${w.page} ${w.why}`.toLowerCase().includes(q.toLowerCase())));
  const tasks = shown.map((w) => `${w.rank}. ${w.title} (${w.page}, ${w.where}) · +${w.gain} ${unit}`).join("\n");
  const csv = ["rank,type,title,page,where,gain,effort,confidence,done", ...shown.map((w) => [w.rank, w.type, w.title, w.page, w.where, w.gain, w.effort, w.conf, done[w.key] ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
  return (
    <div>
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <Chip on={!type} onClick={() => setType(null)}>All <b className="text-faint">{wins.length}</b></Chip>
          {types.map(([t, n]) => <Chip key={t} on={type === t} onClick={() => setType(t)}>{t} <b className="text-faint">{n}</b></Chip>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {["Low", "Medium", "High"].map((e) => <Chip key={e} on={effort === e} onClick={() => setEffort(effort === e ? null : e)}>{e} effort</Chip>)}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search changes or pages" aria-label="Search quick wins" className="h-7 rounded-md border border-border bg-surface px-2 text-xs" />
          <CopyButton text={tasks} label="Copy as task list" />
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="quick-wins.csv" className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-muted">Export CSV</a>
          <span className="text-xs text-muted">{shown.length} of {wins.length}</span>
        </div>
      </div>
      <div className="space-y-3">
        {shown.map((w) => (
          <article key={w.key} className={cn("rounded-lg border border-border p-4", done[w.key] && "opacity-60")}>
            <header className="flex flex-wrap items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold">{w.rank}</span>
              <div className="min-w-0 flex-1">
                <h3 className={cn("text-[15px] font-semibold", done[w.key] && "line-through")}>{w.title}</h3>
                <div className="mt-1 flex flex-wrap gap-1.5"><Tag tone="acc">{w.type}</Tag><Tag tone={w.effort === "Low" ? "good" : w.effort === "Medium" ? "warn" : "bad"}>{w.effort} effort</Tag><Tag>{w.conf} confidence</Tag><span className="font-mono text-[11px] text-muted">{w.page}</span></div>
              </div>
              <div className="text-right"><div className="text-2xl font-semibold tabular-nums text-positive">+{w.gain}</div><div className="text-xs text-muted">{unit}</div></div>
            </header>
            <div className="mt-3 grid gap-4 text-[13px] md:grid-cols-2">
              <div className="space-y-2">
                <p><b className="text-xs uppercase tracking-wide text-faint">Where</b><br />{w.where}</p>
                <p><b className="text-xs uppercase tracking-wide text-faint">Why</b><br />{w.why}</p>
                {w.evidence && <table className="w-full text-xs"><tbody className="divide-y divide-hairline">{w.evidence.map(([k, v]) => <tr key={k}><td className="py-1 text-muted">{k}</td><td className="py-1 text-right tabular-nums">{v}</td></tr>)}</tbody></table>}
              </div>
              <div className="space-y-2">
                <div><b className="text-xs uppercase tracking-wide text-faint">Steps</b><ol className="ml-4 mt-1 list-decimal space-y-1">{w.steps.map((s) => <li key={s}>{s}</li>)}</ol></div>
                {w.suggest && <div><b className="text-xs uppercase tracking-wide text-faint">Suggested change</b><pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-sunken p-2 font-mono text-xs">{w.suggest}</pre><div className="mt-1"><CopyButton text={w.suggest} /></div></div>}
              </div>
            </div>
            <footer className="mt-3 flex flex-wrap items-center gap-3 border-t border-hairline pt-3 text-xs">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!done[w.key]} onChange={() => toggle(w.key)} /> Done{done[w.key] ? ` on ${done[w.key]}` : ""}</label>
              <span className="text-muted">Measure: {w.measure ?? "Lead rate on this page, 28 days after the change"}</span>
            </footer>
          </article>
        ))}
        {!shown.length && <p className="py-6 text-center text-sm text-muted">No quick wins match.</p>}
      </div>
    </div>
  );
}

/** "Done" tile: how many quick wins are ticked in this browser. */
export function QwDone({ scope, total }: { scope: string; total: number }) {
  const [raw] = useStored(`${KEY}:${scope}`);
  const n = Object.keys(parse(raw)).length;
  return <><div className="mt-1.5 text-2xl font-semibold tabular-nums">{n}</div><div className="mt-1 text-xs text-muted">{total ? `${((n / total) * 100).toFixed(2)}% complete` : "nothing to do"}</div></>;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-foreground bg-foreground text-background" : "border-border text-secondary hover:bg-surface-muted")}>{children}</button>;
}
