"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, SlidersHorizontal } from "lucide-react";
import { toCsv } from "@/lib/analytics/csv";
import { cn } from "@/lib/utils";

export type ColType = "text" | "int" | "dec" | "usd" | "date" | "url" | "bool" | "badge" | "spark" | "change" | "spam" | "delta";
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
      <polyline points={pts} fill="none" stroke="var(--series)" strokeWidth="1.5" strokeLinejoin="round" />
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
    case "badge": return typeof v === "string" && v ? <span className="whitespace-nowrap rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium capitalize text-secondary">{v}</span> : <>—</>;
    case "spam":
      return isNum(v) ? <span className={cn("tabular-nums", v >= 50 ? "font-medium text-negative" : v >= 30 ? "text-warn" : "")}>{v}</span> : <>—</>;
    case "delta": // positive = you rank better than the competitor by N positions
      return isNum(v) && v !== 0 ? <span className={v > 0 ? "text-positive" : "text-negative"}>{v > 0 ? "▲" : "▼"} {Math.abs(v)}</span> : <span className="text-muted">—</span>;
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
        ? <a href={v} target="_blank" rel="noopener noreferrer" title={v} className="break-all underline-offset-2 hover:underline">{label.length > 70 ? `${label.slice(0, 70)}…` : label}</a>
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
export function ResearchTable({ title, rows, columns, searchKeys = [], presets = [], ranges = [], facets = [], initialSort, pageSize = 25, empty = "No data yet.", csvName, note }: {
  title: string; rows: Row[]; columns: Col[]; searchKeys?: string[]; presets?: Preset[];
  /** numeric columns that get min / max inputs */
  ranges?: { key: string; label: string }[];
  /** text columns (intent, type...) that get a dropdown of the values present in the data */
  facets?: { key: string; label: string }[];
  initialSort?: { key: string; dir: "asc" | "desc" }; pageSize?: number; empty?: string; csvName?: string; note?: string;
}) {
  const [q, setQ] = useState("");
  const [range, setRange] = useState<Record<string, { min: string; max: string }>>({});
  const [facet, setFacet] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState<number>(-1);
  const [sort, setSort] = useState(initialSort ?? null);
  const [shown, setShown] = useState(pageSize);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (preset >= 0) list = list.filter((r) => passes(r, presets[preset]));
    if (needle) list = list.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)));
    for (const [key, { min, max }] of Object.entries(range)) {
      const lo = min.trim() === "" ? null : Number(min), hi = max.trim() === "" ? null : Number(max);
      if (lo === null && hi === null) continue;
      list = list.filter((r) => { const v = r[key]; return isNum(v) && (lo === null || Number.isNaN(lo) || v >= lo) && (hi === null || Number.isNaN(hi) || v <= hi); });
    }
    for (const [key, want] of Object.entries(facet)) if (want) list = list.filter((r) => String(r[key] ?? "") === want);
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
  }, [rows, q, range, facet, preset, sort, presets, searchKeys]);
  const facetValues = useMemo(() => Object.fromEntries(facets.map((f) => [f.key, [...new Set(rows.map((r) => r[f.key]).filter((v): v is string => typeof v === "string" && v !== ""))].sort()])), [rows, facets]);
  const filtered = q.trim() !== "" || Object.values(range).some((r) => r.min !== "" || r.max !== "") || Object.values(facet).some(Boolean) || preset >= 0;
  const reset = () => { setQ(""); setRange({}); setFacet({}); setPreset(-1); setShown(pageSize); };

  const exportCsv = () => {
    // toCsv defuses spreadsheet formulas (=, +, -, @) in untrusted text such as anchors and keywords
    const csv = toCsv(columns.map((c) => c.label), view.map((r) => columns.map((c) => { const v = r[c.key]; return Array.isArray(v) ? v.join(" ") : v; })));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${csvName ?? title.toLowerCase().replace(/\W+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="overflow-hidden rounded-[10px] border border-border bg-surface" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <h2 className="text-[15px] font-semibold">{title} <span className="ml-1 text-[13px] font-normal tabular-nums text-muted">{nf.format(view.length)}{view.length !== rows.length ? ` of ${nf.format(rows.length)}` : ""}</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          {searchKeys.length > 0 && (
            <input value={q} onChange={(e) => { setQ(e.target.value); setShown(pageSize); }} placeholder="Search…" aria-label={`Search ${title}`}
              className="h-8 w-44 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent" />
          )}
          {(ranges.length > 0 || facets.some((f) => (facetValues[f.key] ?? []).length > 1)) && rows.length > 0 && (
            <button onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors",
                filtersOpen || filtered ? "border-foreground/40 text-foreground" : "border-border-strong text-secondary hover:bg-surface-muted hover:text-foreground")}>
              <SlidersHorizontal className="size-3.5" aria-hidden /> Filters{filtered && <span className="size-1.5 rounded-full bg-accent" aria-label="active" />}
            </button>
          )}
          {rows.length > 0 && (
            <button onClick={exportCsv} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-[13px] font-medium text-secondary hover:bg-surface-muted hover:text-foreground" title="Download the filtered rows as CSV">
              <Download className="size-3.5" aria-hidden /> CSV
            </button>
          )}
        </div>
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-hairline px-4 py-2.5 sm:px-5" role="group" aria-label="Quick filters">
          {[{ label: "All", where: [] } as Preset, ...presets].map((p, i) => (
            <button key={p.label} onClick={() => { setPreset(i - 1); setShown(pageSize); }} aria-pressed={preset === i - 1}
              className={cn("h-7 rounded-md px-2.5 text-xs transition-colors", preset === i - 1 ? "bg-foreground font-medium text-surface" : "bg-surface-muted text-secondary hover:text-foreground")}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {filtersOpen && (ranges.length > 0 || facets.length > 0) && rows.length > 0 && (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-hairline bg-surface-sunken px-4 py-3 sm:px-5" role="group" aria-label="Custom filters">
          {ranges.map((f) => (
            <fieldset key={f.key} className="text-xs text-muted">
              <legend className="mb-0.5">{f.label}</legend>
              <span className="flex items-center gap-1">
                <input inputMode="decimal" aria-label={`${f.label} minimum`} placeholder="min" value={range[f.key]?.min ?? ""} onChange={(e) => { setRange({ ...range, [f.key]: { min: e.target.value, max: range[f.key]?.max ?? "" } }); setShown(pageSize); }}
                  className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                <span aria-hidden>–</span>
                <input inputMode="decimal" aria-label={`${f.label} maximum`} placeholder="max" value={range[f.key]?.max ?? ""} onChange={(e) => { setRange({ ...range, [f.key]: { min: range[f.key]?.min ?? "", max: e.target.value } }); setShown(pageSize); }}
                  className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent" />
              </span>
            </fieldset>
          ))}
          {facets.filter((f) => (facetValues[f.key] ?? []).length > 1).map((f) => (
            <label key={f.key} className="text-xs text-muted">{f.label}
              <select value={facet[f.key] ?? ""} onChange={(e) => { setFacet({ ...facet, [f.key]: e.target.value }); setShown(pageSize); }}
                className="mt-0.5 block rounded-md border border-border bg-surface px-1.5 py-1 text-xs capitalize text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <option value="">All</option>
                {facetValues[f.key].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
          {filtered && <button onClick={reset} className="pb-1.5 text-xs font-medium text-secondary underline underline-offset-2 hover:text-foreground">Clear filters</button>}
        </div>
      )}
      {rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p> : view.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">Nothing matches these filters. <button onClick={reset} className="font-medium text-foreground underline underline-offset-2">Clear filters</button></p>
      ) : (
        <>
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-full min-w-[40rem] text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface-sunken">
                <tr className="border-b border-hairline text-left text-xs text-muted">
                  {columns.map((c) => {
                    const right = ["int", "dec", "usd", "change", "spam", "delta"].includes(c.type ?? "");
                    const active = sort?.key === c.key;
                    return (
                      <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 font-medium first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", right && "text-right")} title={c.hint}
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
                  <tr key={i} className="border-t border-hairline align-top first:border-t-0 hover:bg-surface-sunken">
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-3 py-2 first:min-w-44 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", ["int", "dec", "usd", "change", "spam", "delta"].includes(c.type ?? "") && "text-right tabular-nums")}><Cell col={c} row={r} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.length > shown && (
            <div className="border-t border-hairline px-4 py-2.5 sm:px-5">
              <button onClick={() => setShown((n) => n + 100)} className="text-[13px] font-medium text-secondary hover:text-foreground">
                Show {Math.min(100, view.length - shown)} more <span className="font-normal text-muted">({nf.format(view.length - shown)} hidden)</span>
              </button>
            </div>
          )}
        </>
      )}
      {note && <p className="border-t border-hairline px-4 py-2.5 text-xs text-muted sm:px-5">{note}</p>}
    </section>
  );
}
