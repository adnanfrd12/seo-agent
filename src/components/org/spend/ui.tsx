"use client";

import { useState } from "react";
import { CircleAlert, Download, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BudgetStatus, ToolStatus } from "@/lib/org/spend";
import { change, share, usd } from "./format";

/* Small building blocks of the organization spend tabs, in the dashboard's own styles. */

/** A segmented switch (range, split, chart type). */
export function Segmented<T extends string>({ label, options, value, onChange, size = "sm", className }: {
  label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md"; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-surface-muted p-[3px]", className)}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cn("rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            size === "md" ? "px-3 py-1 text-[13px]" : "px-2 py-0.5 text-xs",
            value === o.id ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-secondary hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CsvButton({ onClick, title = "Download as CSV", label = "CSV" }: { onClick: () => void; title?: string; label?: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-strong px-2 text-xs font-medium text-secondary outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
      <Download className="size-3.5" aria-hidden /> {label}
    </button>
  );
}

/** Change against the previous period; for spend, up is the costly direction. */
export function Change({ cur, prev, className }: { cur: number; prev: number; className?: string }) {
  const c = change(cur, prev);
  return (
    <span className={cn("whitespace-nowrap text-xs tabular-nums", c.tone === "up" ? "text-negative" : c.tone === "down" ? "text-positive" : "text-muted", className)}
      title={c.tone === "none" ? "Nothing spent in either period" : c.tone === "new" ? `Nothing spent in the previous period, ${usd(cur)} now` : `${usd(prev)} in the previous period`}>
      {c.text}
    </span>
  );
}

/** A colour key for an entity shown in the chart (identity, not value). */
export const Swatch = ({ color, line = false }: { color: string | null; line?: boolean }) =>
  color ? <span aria-hidden className={cn("inline-block shrink-0", line ? "h-[3px] w-3 rounded-full" : "size-2.5 rounded-[3px]")} style={{ background: color }} /> : <span aria-hidden className="inline-block size-2.5 shrink-0" />;

export interface RankedItem { key: string; label: string; value: number; color?: string | null; right?: React.ReactNode; sub?: React.ReactNode; title?: string }
/** Ranked horizontal bars in one hue (magnitude); the swatch ties a row to its colour in the chart above. */
export function RankedBars({ items, limit, empty = "Nothing spent in this period.", unit = usd }: { items: RankedItem[]; limit?: number; empty?: string; unit?: (v: number) => string }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? items.slice(0, limit) : items;
  const max = Math.max(1e-12, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <div>
      <ul className="space-y-2.5">
        {shown.map((i) => (
          <li key={i.key} className="text-[13px]" title={i.title}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {i.color !== undefined && <Swatch color={i.color} />}
                <span className="truncate" title={i.label}>{i.label}</span>
              </span>
              <span className="shrink-0 tabular-nums">{i.right ?? unit(i.value)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <div className="h-full rounded-full bg-series" style={{ width: `${i.value > 0 ? Math.max(1.5, (i.value / max) * 100) : 0}%` }} />
            </div>
            {i.sub && <div className="mt-1 text-xs text-muted">{i.sub}</div>}
          </li>
        ))}
      </ul>
      {limit != null && items.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}
          className="mt-3 h-7 rounded-md border border-border-strong px-2.5 text-xs font-medium text-secondary hover:bg-surface-muted hover:text-foreground">
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

export interface SharePart { key: string; label: string; value: number; color: string; detail?: React.ReactNode }
/**
 * One whole split into parts (a thin segmented bar); the list under it names every part with its amount and share,
 * so nothing depends on colour or hover.
 */
export function ShareBar({ parts, empty = "Nothing spent in this period." }: { parts: SharePart[]; empty?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  if (total <= 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex h-2 gap-[2px]" role="img" aria-label={shown.map((p) => `${p.label} ${usd(p.value)} (${share(p.value / total)})`).join(", ")} onMouseLeave={() => setHover(null)}>
        {shown.map((p) => (
          <span key={p.key} title={`${p.label}: ${usd(p.value)} (${share(p.value / total)})`} onMouseEnter={() => setHover(p.key)}
            className={cn("h-full min-w-[3px] rounded-full transition-opacity", hover && hover !== p.key && "opacity-50")}
            style={{ flexGrow: p.value, flexBasis: 0, background: p.color }} />
        ))}
      </div>
      <ul className="mt-3 space-y-2 text-[13px]">
        {parts.map((p) => (
          <li key={p.key} className={cn("flex items-start gap-2 rounded px-1 py-0.5", hover === p.key && "bg-surface-muted")} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
            <span className="mt-[5px]"><Swatch color={p.color} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={p.label}>{p.label}</span>
              {p.detail && <span className="block text-xs text-muted">{p.detail}</span>}
            </span>
            <span className="tabular-nums">{usd(p.value)}</span>
            <span className="w-12 text-right text-xs tabular-nums text-muted">{share(p.value / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Use of a limit: the fill turns amber from 80% and red at 100%; the label says so in words too. */
export function Meter({ value, max, className, label }: { value: number; max: number; className?: string; label?: string }) {
  const f = max > 0 ? value / max : 0;
  const tone = f >= 1 ? "bg-negative" : f >= 0.8 ? "bg-warn" : "bg-series";
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-surface-muted", className)} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100} aria-label={label ?? `${usd(value)} of ${usd(max)}`}>
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, f * 100)}%` }} />
    </div>
  );
}

const STATUS: Record<BudgetStatus, { label: string; cls: string; icon?: typeof CircleAlert }> = {
  over: { label: "Over budget", cls: "bg-negative-soft text-negative", icon: OctagonAlert },
  near: { label: "Near the limit", cls: "bg-warn-soft text-warn", icon: TriangleAlert },
  ok: { label: "Within budget", cls: "bg-surface-muted text-secondary" },
  off: { label: "Claude off ($0)", cls: "bg-surface-muted text-muted" },
};
export function BudgetTag({ status }: { status: BudgetStatus }) {
  const s = STATUS[status], Icon = s.icon;
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls)}>{Icon && <Icon className="size-3" aria-hidden />}{s.label}</span>;
}

const TOOL_STATUS: Record<ToolStatus, { label: string; cls: string }> = {
  set_up: { label: "Set up", cls: "bg-positive-soft text-positive" },
  not_set_up: { label: "Not set up", cls: "bg-surface-muted text-muted" },
  per_client: { label: "Per client", cls: "bg-series-soft text-series" },
  unknown: { label: "Unknown", cls: "bg-surface-muted text-muted" },
};
export const ToolTag = ({ status }: { status: ToolStatus }) => <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", TOOL_STATUS[status].cls)}>{TOOL_STATUS[status].label}</span>;

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", tone === "warn" ? "border-warn/30 bg-warn-soft text-warn" : "border-border bg-surface-sunken text-secondary")}>
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Two columns on wide screens, one on phones. */
export const Row = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn("grid min-w-0 gap-4 @4xl:grid-cols-2", className)}>{children}</div>;
