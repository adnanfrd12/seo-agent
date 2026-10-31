import { ArrowDownRight, ArrowUpRight, Info, Minus, type LucideIcon } from "lucide-react";
import { isFavorable, pctChange, type Num } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

/** Kept for callers that still pass a colour; tiles and chapters now use the quiet ink palette. */
export const CHAPTER_COLORS = ["var(--series)", "var(--series)", "var(--series)", "var(--series)", "var(--series)", "var(--series)", "var(--series)"] as const;

/** Numbered chapter: chapter number, icon + title, subtitle and source labels. */
export function Chapter({
  n, title, subtitle, icon: Icon, sources = [], children, id,
}: {
  n: number; title: string; subtitle: string; icon: LucideIcon; sources?: string[]; children: React.ReactNode; id?: string;
}) {
  return (
    <section id={id} className="report-chapter border-t border-border pt-10 first:border-t-0 first:pt-0" aria-labelledby={`${id}-title`}>
      <header className="report-avoid-break mb-6">
        <p className="text-xs font-medium tabular-nums text-muted" aria-hidden>Chapter {String(n).padStart(2, "0")}</p>
        <div className="mt-1 min-w-0">
          <h2 id={`${id}-title`} className="flex items-center gap-2 text-xl font-semibold tracking-[-0.015em]">
            <Icon className="size-5 shrink-0 text-muted" aria-hidden /> <span className="sr-only">Chapter {n}: </span>{title}
          </h2>
          <p className="mt-1 text-sm text-secondary">{subtitle}</p>
          {sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">{sources.map((s) => <SourceTag key={s}>{s}</SourceTag>)}</div>
          )}
        </div>
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function SourceTag({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded-md bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-secondary">Source: {children}</span>;
}

function Chip({ label, current, base, higherIsBetter }: { label: string; current: Num; base: Num; higherIsBetter: boolean }) {
  const change = pctChange(current, base);
  const good = isFavorable(change, higherIsBetter);
  const Icon = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
      good === true && "text-positive", good === false && "text-negative", good === null && "text-muted")}
      title={change === null ? `${label}: no comparable data` : undefined}>
      <Icon className="size-3.5" aria-hidden />
      {change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(0)}%`} {label}
    </span>
  );
}

/** Tiny trend line for a tile (decorative; the value and chips carry the information). */
export function Sparkline({ values, color = "currentColor" }: { values: (number | null)[]; color?: string }) {
  const v = values.map((x) => x ?? 0);
  if (v.length < 2 || v.every((x) => x === 0)) return null;
  const max = Math.max(...v), min = Math.min(...v);
  const w = 80, h = 22;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - ((x - min) / (max - min || 1)) * (h - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[22px] w-20" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

/** KPI tile in the report style. MoM/YoY show "—" when there's no comparable data. */
export function StatTile({
  label, icon: Icon, value, previous, mom, yoy, format, source, hint, higherIsBetter = true, spark,
}: {
  label: string; icon: LucideIcon; value: Num; previous?: Num; mom?: Num; yoy?: Num; format: (n: Num) => string;
  /** accepted for older callers; tiles use the shared palette */
  color?: string; source: string; hint?: string; higherIsBetter?: boolean; spark?: (number | null)[];
}) {
  return (
    <div className="report-avoid-break flex min-h-[9rem] flex-col rounded-[10px] border border-border bg-surface px-4 py-3.5" title={hint}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Icon className="size-3.5 shrink-0" aria-hidden /> {label}
        </p>
        <span className="text-[11px] text-faint">{source}</span>
      </div>
      <p className="mt-2 text-[26px] font-semibold tabular-nums tracking-[-0.02em]">{format(value)}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <Chip label="MoM" current={value} base={mom ?? previous} higherIsBetter={higherIsBetter} />
        <Chip label="YoY" current={value} base={yoy} higherIsBetter={higherIsBetter} />
      </div>
      {spark && <div className="mt-auto pt-2 text-series"><Sparkline values={spark} /></div>}
    </div>
  );
}

/**
 * The last tile widens to close its row, so a count that doesn't divide by the column count never
 * leaves empty cells (2 columns below xl, 3 or 4 from xl).
 */
export const FILL_ROW_3 = "max-xl:[&>*:last-child:nth-child(odd)]:col-span-2 xl:[&>*:last-child:nth-child(3n+1)]:col-span-3 xl:[&>*:last-child:nth-child(3n+2)]:col-span-2";
export const FILL_ROW_4 = "sm:max-xl:[&>*:last-child:nth-child(odd)]:col-span-2 xl:[&>*:last-child:nth-child(4n+1)]:col-span-4 xl:[&>*:last-child:nth-child(4n+2)]:col-span-3 xl:[&>*:last-child:nth-child(4n+3)]:col-span-2";

/** Around an expanded (print) MetricTrend: an odd last chart takes the full width instead of leaving half a row empty. */
export function TrendSet({ children }: { children: React.ReactNode }) {
  return <div className="sm:[&>.grid>*:last-child:nth-child(odd)]:col-span-2">{children}</div>;
}

/** Four tiles a row on wide screens (the PDF renders at 1240px, so it keeps three); the last row is always filled. */
const TILE_FILL = "max-xl:[&>*:last-child:nth-child(odd)]:col-span-2 xl:max-2xl:[&>*:last-child:nth-child(3n+1)]:col-span-3 xl:max-2xl:[&>*:last-child:nth-child(3n+2)]:col-span-2 2xl:[&>*:last-child:nth-child(4n+1)]:col-span-4 2xl:[&>*:last-child:nth-child(4n+2)]:col-span-3 2xl:[&>*:last-child:nth-child(4n+3)]:col-span-2";

export function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className={cn("grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4", TILE_FILL)}>{children}</div>;
}

/** Two lists of findings in one card (e.g. wins and watch list), so lists of different length never leave a half-empty card. */
export function FindingsPair({ left, right }: { left: { title: string; items: string[]; tone: "good" | "bad" }; right: { title: string; items: string[]; tone: "good" | "bad" } }) {
  return (
    <div className="report-avoid-break grid items-start gap-x-8 gap-y-5 rounded-[10px] border border-border bg-surface p-5 lg:grid-cols-2">
      {[left, right].map((f) => (
        <div key={f.title} className="min-w-0">
          <p className="text-sm font-semibold">{f.title}</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {f.items.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", f.tone === "good" ? "bg-positive" : "bg-negative")} aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A clearly labelled "not available" block, never zeros. */
export function Unavailable({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="report-avoid-break flex gap-3 rounded-lg border border-dashed border-border bg-surface p-5">
      <Info className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted">{body}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/** Written findings: each line is a deterministic statement derived from the numbers. */
export function Findings({ title = "Key findings", items, tone = "neutral" }: { title?: string; items: string[]; tone?: "neutral" | "good" | "bad" }) {
  if (items.length === 0) return null;
  return (
    <div className="report-avoid-break rounded-[10px] border border-border bg-surface p-5">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone === "good" ? "bg-positive" : tone === "bad" ? "bg-negative" : "bg-faint")} aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars with value and MoM chip, like the reference's traffic-source rows. */
export function BarRows({ rows, color }: { rows: { label: string; value: number; base: number | null }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="report-avoid-break rounded-lg bg-surface-muted p-5">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(5rem,10rem)_minmax(0,1fr)_auto_auto] items-center gap-2 sm:grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_auto_auto] sm:gap-3 py-2.5 text-sm">
            <span className="truncate font-medium">{r.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-border" aria-hidden>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} />
            </span>
            <span className="w-14 text-right font-semibold tabular-nums">{r.value.toLocaleString("en-US")}</span>
            <span className="w-24 text-right"><Chip label="MoM" current={r.value} base={r.base} higherIsBetter /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact read-only table for reports. */
export function ReportTable<T>({
  title, source, columns, rows, empty,
}: {
  title: string; source?: string; empty: string; rows: T[];
  columns: { label: string; align?: "right"; render: (r: T) => React.ReactNode }[];
}) {
  return (
    <div className="report-avoid-break">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {source && <SourceTag>{source}</SourceTag>}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-surface-muted p-4 text-sm text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                {columns.map((c) => <th key={c.label} className={cn("px-2 py-2 font-semibold", c.align === "right" && "text-right")}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border">
                  {columns.map((c) => <td key={c.label} className={cn("px-2 py-2", c.align === "right" && "text-right tabular-nums")}>{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
