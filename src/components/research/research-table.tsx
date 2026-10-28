"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColType = "text" | "int" | "dec" | "usd" | "date" | "url" | "bool" | "badge" | "spark" | "change" | "spam";
export interface Col { key: string; label: string; type?: ColType; hint?: string }
export interface Preset { label: string; where: { key: string; op: "lte" | "gte" | "eq" | "true"; value?: number | string | boolean }[] }
type Row = Record<string, unknown>;

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-muted">—</span>;
  const max = Math.max(...values, 1), w = 64, h = 18;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`12-month trend, latest ${values.at(-1)}`} className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Cell({ col, row }: { col: Col; row: Row }) {
  const v = row[col.key];
  switch (col.type) {
    case "int": return <>{isNum(v) ? nf.format(v) : "—"}</>;
    case "dec": return <>{isNum(v) ? v.toFixed(1) : "—"}</>;
    case "usd": return <>{isNum(v) ? `$${v.toFixed(2)}` : "—"}</>;
    case "bool": return <>{v === true ? "Yes" : v === false ? "No" : "—"}</>;
    case "date": return <>{typeof v === "string" ? v : "—"}</>;
    case "spark": return <Spark values={Array.isArray(v) ? (v as number[]) : []} />;
    case "badge": return typeof v === "string" && v ? <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] capitalize">{v}</span> : <>—</>;
    case "spam":
      return isNum(v) ? <span className={cn("tabular-nums", v >= 50 ? "font-semibold text-negative" : v >= 30 ? "text-[#D4970A]" : "")}>{v}</span> : <>—</>;
    case "change": {
      // v = previous position; row.position = current. Lower position number is better.
      const cur = row.position;
      if (row.is_new === true) return <span className="text-positive">new</span>;
      if (!isNum(v) || !isNum(cur) || v === cur) return <span className="text-muted">—</span>;
      const d = v - cur;
      return <span className={d > 0 ? "text-positive" : "text-negative"}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}</span>;
    }
    case "url": {
      if (typeof v !== "string" || !v) return <>—</>;
      let label = v;
      try { const u = new URL(v); label = `${u.host}${u.pathname}${u.search}`; } catch { /* plain text */ }
      return /^https?:\/\//.test(v)
        ? <a href={v} target="_blank" rel="noopener noreferrer" title={v} className="break-all hover:text-accent hover:underline">{label.length > 70 ? `${label.slice(0, 70)}…` : label}</a>
        : <span className="break-all">{v}</span>;
    }
    default: return <span className="break-words">{v == null || v === "" ? "—" : String(v)}</span>;
  }
}

const passes = (row: Row, p: Preset) => p.where.every((w) => {
  const v = row[w.key];
  if (w.op === "true") return v === true;
  if (w.op === "eq") return v === w.value;
  if (!isNum(v)) return false;
  return w.op === "lte" ? v <= Number(w.value) : v >= Number(w.value);
});

/**
 * Client-side table for stored research data: search, sort, filter presets, "show more" and CSV export.
 * Everything is already in the page, so none of this ever calls an API.
 */
export function ResearchTable({ title, rows, columns, searchKeys = [], presets = [], initialSort, pageSize = 25, empty = "No data yet.", csvName, note }: {
  title: string; rows: Row[]; columns: Col[]; searchKeys?: string[]; presets?: Preset[];
  initialSort?: { key: string; dir: "asc" | "desc" }; pageSize?: number; empty?: string; csvName?: string; note?: string;
}) {
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<number>(-1);
  const [sort, setSort] = useState(initialSort ?? null);
  const [shown, setShown] = useState(pageSize);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (preset >= 0) list = list.filter((r) => passes(r, presets[preset]));
    if (needle) list = list.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)));
    if (sort) {
      const { key, dir } = sort, m = dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const x = a[key], y = b[key];
        if (x == null && y == null) return 0;
        if (x == null) return 1; // empty values always last
        if (y == null) return -1;
        return (isNum(x) && isNum(y) ? x - y : String(x).localeCompare(String(y))) * m;
      });
    }
    return list;
  }, [rows, q, preset, sort, presets, searchKeys]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(Array.isArray(v) ? v.join(" ") : v ?? "").replace(/"/g, '""')}"`;
    const csv = [columns.map((c) => esc(c.label)).join(","), ...view.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${csvName ?? title.toLowerCase().replace(/\W+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title} <span className="ml-1 font-normal text-muted">{nf.format(view.length)}{view.length !== rows.length ? ` of ${nf.format(rows.length)}` : ""}</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          {searchKeys.length > 0 && (
            <input value={q} onChange={(e) => { setQ(e.target.value); setShown(pageSize); }} placeholder="Filter…" aria-label={`Filter ${title}`}
              className="w-40 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          )}
          {rows.length > 0 && (
            <button onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-muted" title="Download the filtered rows as CSV">
              <Download className="size-3" aria-hidden /> CSV
            </button>
          )}
        </div>
      </div>
      {presets.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
          {[{ label: "All", where: [] } as Preset, ...presets].map((p, i) => (
            <button key={p.label} onClick={() => { setPreset(i - 1); setShown(pageSize); }} aria-pressed={preset === i - 1}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", preset === i - 1 ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-muted")}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">{empty}</p> : view.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Nothing matches these filters.</p>
      ) : (
        <>
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="text-left text-xs text-muted">
                  {columns.map((c) => {
                    const right = ["int", "dec", "usd", "change", "spam"].includes(c.type ?? "");
                    const active = sort?.key === c.key;
                    return (
                      <th key={c.key} className={cn("px-2 py-2 font-medium", right && "text-right")} title={c.hint}
                        aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
                        <button onClick={() => setSort(active && sort!.dir === "desc" ? { key: c.key, dir: "asc" } : { key: c.key, dir: "desc" })}
                          className={cn("inline-flex items-center gap-1 hover:text-foreground", right && "flex-row-reverse", active && "text-foreground")}>
                          {c.label}{active && (sort!.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {view.slice(0, shown).map((r, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-2 py-1.5", ["int", "dec", "usd", "change", "spam"].includes(c.type ?? "") && "text-right tabular-nums")}><Cell col={c} row={r} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.length > shown && (
            <button onClick={() => setShown((n) => n + 100)} className="mt-2 text-sm font-medium text-accent hover:underline">
              Show {Math.min(100, view.length - shown)} more ({nf.format(view.length - shown)} hidden)
            </button>
          )}
        </>
      )}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </section>
  );
}
