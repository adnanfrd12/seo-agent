import Link from "next/link";
import type { DateRangeSel } from "@/lib/analytics/range";
import { first, withParams, type SearchParams } from "@/lib/analytics/url";
import { cn } from "@/lib/utils";

const PRESETS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "month", label: "Last month" },
] as const;

/** URL-driven range picker: presets, custom range, and previous-period comparison toggle. */
export function RangeSelector({
  path, sp, range, showCompare = true,
}: { path: string; sp: SearchParams; range: DateRangeSel; showCompare?: boolean }) {
  const compare = first(sp.compare) === "1";
  const reset = { range: null, start: null, end: null } as const;

  return (
    <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
      <div role="group" aria-label="Date range" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
        {PRESETS.map((p) => (
          <Link
            key={p.id}
            href={withParams(path, sp, { ...reset, range: p.id })}
            aria-current={range.preset === p.id ? "true" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent",
              range.preset === p.id ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-surface-muted",
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <form action={path} method="get" className="flex items-end gap-2">
        {Object.entries(sp).flatMap(([k, v]) =>
          ["range", "start", "end"].includes(k) || first(v) === undefined
            ? []
            : [<input key={k} type="hidden" name={k} value={first(v)} />],
        )}
        <label className="text-xs text-muted">
          From
          <input type="date" name="start" defaultValue={range.start} required
            className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted">
          To
          <input type="date" name="end" defaultValue={range.end} required
            className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground" />
        </label>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted">
          Apply
        </button>
      </form>

      {showCompare && (
        <Link
          href={withParams(path, sp, { compare: compare ? null : "1" })}
          aria-pressed={compare}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent",
            compare ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-muted",
          )}
        >
          Compare to previous period
        </Link>
      )}
      <p className="ml-auto text-xs text-muted">{range.start} → {range.end} ({range.days} days)</p>
    </div>
  );
}
