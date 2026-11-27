"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./format";
import { CsvButton } from "./ui";

export interface Column<R> {
  key: string;
  label: string;
  /** numbers are right-aligned and sort high-to-low first */
  num?: boolean;
  /** the value used to sort and, unless `csv` is given, to export */
  value: (r: R) => string | number | null;
  render?: (r: R) => React.ReactNode;
  csv?: (r: R) => unknown;
  /** header tooltip */
  hint?: string;
  className?: string;
  /** exported to CSV but not shown (detail the table shows inside another column) */
  csvOnly?: boolean;
}

/**
 * A client-side table: sort by any column, search, one optional filter, a totals row, "Show all", and CSV of the
 * rows in view (raw numbers, not the formatted text).
 */
export function SpendTable<R>({ title, sub, rows, columns, rowKey, initialSort, limit = 12, search, filter, foot, csvName, empty = "Nothing to show.", note }: {
  title: string; sub?: string; rows: R[]; columns: Column<R>[]; rowKey: (r: R) => string;
  initialSort?: { key: string; dir: "asc" | "desc" }; limit?: number;
  /** text a row is searched by */
  search?: (r: R) => string;
  filter?: { label: string; value: (r: R) => string };
  foot?: Partial<Record<string, React.ReactNode>>;
  csvName: string; empty?: string; note?: React.ReactNode;
}) {
  const id = useId();
  const [sort, setSort] = useState(initialSort ?? null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("");
  const [all, setAll] = useState(false);
  const options = useMemo(() => (filter ? [...new Set(rows.map(filter.value))].filter(Boolean).sort() : []), [rows, filter]);
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (needle && search) list = list.filter((r) => search(r).toLowerCase().includes(needle));
    if (only && filter) list = list.filter((r) => filter.value(r) === only);
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col && sort) {
      const m = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const x = col.value(a), y = col.value(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? (x === y ? 0 : x < y ? -1 : 1) : String(x).localeCompare(String(y))) * m;
      });
    }
    return list;
  }, [rows, q, only, sort, columns, search, filter]);
  const shown = all ? view : view.slice(0, limit);
  const filtered = view.length !== rows.length;
  const shownCols = columns.filter((c) => !c.csvOnly);
  const exportCsv = () => downloadCsv(csvName, columns.map((c) => c.label), view.map((r) => columns.map((c) => (c.csv ? c.csv(r) : c.value(r)))));

  return (
    <section className="min-w-0 overflow-hidden rounded-[10px] border border-border bg-surface" aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 id={`${id}-h`} className="text-[15px] font-semibold">{title} <span className="ml-1 text-[13px] font-normal tabular-nums text-muted">{view.length.toLocaleString("en-US")}{filtered ? ` of ${rows.length.toLocaleString("en-US")}` : ""}</span></h3>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {search && rows.length > 8 && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${title}`}
              className="h-7 w-40 rounded-md border border-border-strong bg-surface px-2 text-xs outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent" />
          )}
          {filter && options.length > 1 && (
            <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label={filter.label}
              className="h-7 max-w-[12rem] rounded-md border border-border-strong bg-surface px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <option value="">{filter.label}: all</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {rows.length > 0 && <CsvButton onClick={exportCsv} title={filtered ? "Download the rows in view as CSV" : "Download every row as CSV"} />}
        </div>
      </div>
      {rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p> : view.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">Nothing matches. <button type="button" onClick={() => { setQ(""); setOnly(""); }} className="font-medium text-foreground underline underline-offset-2">Clear</button></p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-[13px]">
              <thead className="bg-surface-sunken">
                <tr className="border-b border-hairline text-left text-xs text-muted">
                  {shownCols.map((c) => {
                    const active = sort?.key === c.key;
                    return (
                      <th key={c.key} scope="col" title={c.hint} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                        className={cn("whitespace-nowrap px-3 py-2 font-medium first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.num && "text-right")}>
                        <button type="button" onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === "desc" ? "asc" : "desc" } : { key: c.key, dir: c.num ? "desc" : "asc" })}
                          className={cn("inline-flex items-center gap-1 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline", c.num && "flex-row-reverse", active && "text-foreground")}>
                          {c.label}{active && (sort!.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={rowKey(r)} className="border-t border-hairline align-top first:border-t-0 hover:bg-surface-sunken">
                    {shownCols.map((c) => (
                      <td key={c.key} className={cn("px-3 py-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.num && "whitespace-nowrap text-right tabular-nums", c.className)}>
                        {c.render ? c.render(r) : (c.value(r) ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {foot && !filtered && (
                <tfoot className="border-t border-border bg-surface-sunken font-medium">
                  <tr>{shownCols.map((c) => <td key={c.key} className={cn("px-3 py-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.num && "whitespace-nowrap text-right tabular-nums")}>{foot[c.key] ?? ""}</td>)}</tr>
                </tfoot>
              )}
            </table>
          </div>
          {view.length > limit && (
            <div className="border-t border-hairline px-4 py-2.5 sm:px-5">
              <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="text-[13px] font-medium text-secondary hover:text-foreground">
                {all ? "Show fewer" : `Show all ${view.length.toLocaleString("en-US")}`}
              </button>
            </div>
          )}
        </>
      )}
      {note && <div className="border-t border-hairline px-4 py-2.5 text-xs text-muted sm:px-5">{note}</div>}
    </section>
  );
}
