import Link from "next/link";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { withParams, type SearchParams } from "@/lib/analytics/url";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  label: string;
  /** server-side sort key; omit to make the column non-sortable */
  sort?: string;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
}

/**
 * Server-rendered table: sorting and pagination are plain links (URL state, no client JS),
 * sorted in Postgres by the RPC. `prefix` namespaces params so several tables can share a page.
 */
export function DataTable<T>({
  title, columns, rows, total, path, sp, prefix, sort, dir, page, pageSize, csvHref, emptyText,
}: {
  title: string;
  columns: Column<T>[];
  rows: T[];
  total: number;
  path: string;
  sp: SearchParams;
  prefix: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  csvHref?: string;
  emptyText: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <section className="overflow-hidden rounded-[10px] border border-border bg-surface" aria-label={title}>
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <h2 className="text-[15px] font-semibold">{title} <span className="ml-1 text-[13px] font-normal tabular-nums text-muted">{total.toLocaleString("en-US")}</span></h2>
        {csvHref && total > 0 && (
          <a
            href={csvHref}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-[13px] font-medium text-secondary hover:bg-surface-muted hover:text-foreground"
          >
            <Download className="size-3.5" aria-hidden /> CSV
          </a>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-[13px]">
            <thead className="bg-surface-sunken">
              <tr className="border-b border-hairline text-left text-xs text-muted">
                {columns.map((c) => {
                  const active = c.sort === sort;
                  const nextDir = active && dir === "desc" ? "asc" : "desc";
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn("whitespace-nowrap px-3 py-2 font-medium first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.align === "right" && "text-right")}
                    >
                      {c.sort ? (
                        <Link
                          href={withParams(path, sp, { [`${prefix}_sort`]: c.sort, [`${prefix}_dir`]: nextDir, [`${prefix}_page`]: null })}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {c.label}
                          {active && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                        </Link>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-hairline first:border-t-0 hover:bg-surface-sunken">
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.align === "right" && "text-right tabular-nums")}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize && (
        <nav className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-xs text-muted sm:px-5" aria-label={`${title} pagination`}>
          <span className="tabular-nums">{from}–{to} of {total.toLocaleString("en-US")}</span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link className="inline-flex h-7 items-center rounded-md border border-border-strong px-2.5 font-medium text-secondary hover:bg-surface-muted hover:text-foreground"
                href={withParams(path, sp, { [`${prefix}_page`]: String(page - 1) })}>Previous</Link>
            )}
            {page < pages && (
              <Link className="inline-flex h-7 items-center rounded-md border border-border-strong px-2.5 font-medium text-secondary hover:bg-surface-muted hover:text-foreground"
                href={withParams(path, sp, { [`${prefix}_page`]: String(page + 1) })}>Next</Link>
            )}
          </span>
        </nav>
      )}
    </section>
  );
}
