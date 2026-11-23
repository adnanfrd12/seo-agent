"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Delta } from "./charts";
import { fmt, type Fmt } from "./fmt";

export type V = string | number | null;
export interface Col {
  k: string; label: string; num?: boolean; f?: Fmt; bar?: string; wrap?: boolean;
  /** page: a site path linking to the live page · event: GA4 event name · tag: a coloured tag (row[`${k}Tone`] = good|bad|warn|acc|mute) · delta: change vs row[prevKey] */
  kind?: "page" | "event" | "tag" | "delta" | "mono" | "status";
  prevKey?: string;
}
export interface Facet { k: string; label: string }

const TONE: Record<string, string> = { good: "bg-positive-soft text-positive", bad: "bg-negative-soft text-negative", warn: "bg-warn-soft text-warn", acc: "bg-series-soft text-series", mute: "bg-surface-muted text-muted" };

export function Tag({ tone = "mute", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[tone] ?? TONE.mute)}>{children}</span>;
}

/** A sortable table with quick-filter chips and "Show all", as on the sample dashboard. */
export function Table({ cols, rows, limit = 25, foot, facets = [], site, empty = "No rows in this period." }: { cols: Col[]; rows: Record<string, V>[]; limit?: number; foot?: Record<string, V>; facets?: Facet[]; site?: string | null; empty?: string }) {
  const [sortK, setSortK] = useState<string | null>(null);
  const [dir, setDir] = useState(-1);
  const [f, setF] = useState<Record<string, string>>({});
  const [lim, setLim] = useState(limit);
  const match = (r: Record<string, V>, skip?: string) => facets.every((fc) => fc.k === skip || f[fc.k] == null || String(r[fc.k]) === f[fc.k]);
  const sorted = useMemo(() => {
    if (!sortK) return rows;
    return [...rows].sort((a, b) => { const x = a[sortK], y = b[sortK]; return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * dir; });
  }, [rows, sortK, dir]);
  const all = sorted.filter((r) => match(r));
  const shown = all.slice(0, lim);
  const maxes: Record<string, number> = {};
  for (const c of cols) if (c.bar) maxes[c.k] = Math.max(...rows.map((r) => Number(r[c.k]) || 0), 1);
  const cell = (c: Col, r: Record<string, V>) => {
    const v = r[c.k];
    if (c.kind === "page" && typeof v === "string") return site && v.startsWith("/") ? <a href={site.replace(/\/$/, "") + v} target="_blank" rel="noreferrer" className="break-all hover:underline">{v}</a> : <span className="break-all">{v}</span>;
    if (c.kind === "event") return <span className="font-mono text-xs">{v}</span>;
    if (c.kind === "mono") return <span className="font-mono text-xs">{v}</span>;
    if (c.kind === "tag") return v == null || v === "" || v === "–" ? <span className="text-faint">–</span> : <Tag tone={String(r[`${c.k}Tone`] ?? "acc")}>{v}</Tag>;
    if (c.kind === "status") return <span className={cn(r[`${c.k}Tone`] === "good" ? "text-positive" : r[`${c.k}Tone`] === "bad" ? "text-negative" : r[`${c.k}Tone`] === "warn" ? "text-warn" : "text-muted")}>{v}</span>;
    if (c.kind === "delta") return <Delta cur={Number(v)} prev={r[c.prevKey ?? ""] == null ? null : Number(r[c.prevKey ?? ""])} />;
    if (typeof v === "number") return fmt(c.f, v);
    return v ?? "";
  };
  return (
    <div>
      {facets.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {facets.map((fc) => {
            const cnt = new Map<string, number>();
            for (const r of rows.filter((r) => match(r, fc.k))) { const v = String(r[fc.k]); cnt.set(v, (cnt.get(v) ?? 0) + 1); }
            const keys = [...cnt.keys()].sort((a, b) => cnt.get(b)! - cnt.get(a)!);
            return (
              <div key={fc.k} className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-faint">{fc.label}</span>
                <Chip on={f[fc.k] == null} onClick={() => setF((o) => { const n = { ...o }; delete n[fc.k]; return n; })}>All</Chip>
                {keys.slice(0, 14).map((v) => <Chip key={v} on={f[fc.k] === v} onClick={() => setF((o) => ({ ...o, [fc.k]: v }))}>{v} <b className="ml-0.5 tabular-nums text-faint">{cnt.get(v)}</b></Chip>)}
              </div>
            );
          })}
          {Object.keys(f).length > 0 && <p className="text-xs text-muted">{all.length} of {rows.length} rows match. <button type="button" className="ml-1 rounded border border-border px-1.5 py-0.5 hover:bg-surface-muted" onClick={() => setF({})}>Clear filters</button></p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline">
            <tr>
              {cols.map((c) => (
                <th key={c.k} aria-sort={sortK === c.k ? (dir > 0 ? "ascending" : "descending") : "none"}
                  className={cn("cursor-pointer select-none whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-foreground", c.num ? "text-right" : "text-left")}
                  onClick={() => { setDir(sortK === c.k ? -dir : -1); setSortK(c.k); }}>
                  {c.label}{sortK === c.k ? (dir > 0 ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {shown.map((r, i) => (
              <tr key={i} className="hover:bg-surface-sunken">
                {cols.map((c) => (
                  <td key={c.k} className={cn("relative px-3 py-2 align-top", c.num ? "text-right tabular-nums" : "", c.wrap ? "min-w-[14rem]" : c.kind === "page" ? "max-w-[22rem]" : "")}>
                    {cell(c, r)}
                    {c.bar && <i className="absolute bottom-1 right-3 block h-[3px] rounded-full opacity-70" style={{ width: `calc(${(((Number(r[c.k]) || 0) / maxes[c.k]) * 100).toFixed(1)}% - 1.5rem)`, maxWidth: "calc(100% - 1.5rem)", background: c.bar }} />}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-sm text-muted">{empty}</td></tr>}
          </tbody>
          {foot && (
            <tfoot className="border-t border-border font-semibold">
              <tr>{cols.map((c) => <td key={c.k} className={cn("px-3 py-2", c.num && "text-right tabular-nums")}>{typeof foot[c.k] === "number" ? fmt(c.f, foot[c.k] as number) : foot[c.k] ?? ""}</td>)}</tr>
            </tfoot>
          )}
        </table>
      </div>
      {all.length > lim && <p className="mt-2 text-xs text-muted">Showing {lim} of {all.length} rows. <button type="button" className="ml-1 rounded border border-border px-1.5 py-0.5 hover:bg-surface-muted" onClick={() => setLim(1e9)}>Show all</button></p>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-foreground bg-foreground text-background" : "border-border text-secondary hover:bg-surface-muted")}>{children}</button>;
}
