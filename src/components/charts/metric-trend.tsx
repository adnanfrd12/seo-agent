"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { TrendChart, type TrendFormat, type TrendPoint, type TrendVariant } from "./trend-chart";

export interface MetricOption {
  key: string;
  label: string;
  data: TrendPoint[];
  format?: TrendFormat;
  reverseY?: boolean;
}

/**
 * One visual language for every trend: the current period in the series colour (an area for counts,
 * a line for rates and positions), the previous period as a dashed grey line. The selected metric is
 * named in the segmented switcher and the legend, so switching is clear without a new colour.
 */
const styleFor = (o: { format?: string }): { variant: TrendVariant; color: string } =>
  ({ variant: !o.format || o.format === "int" ? "area" : "line", color: "var(--series)" });

/**
 * One chart with a segmented metric switcher. Measures with different scales (e.g. clicks and
 * impressions) are shown one at a time instead of on a misleading dual axis.
 */
export function MetricTrend({ title, source, options, expanded = false }: {
  title: string; source?: string; options: MetricOption[];
  /** print/PDF: every metric as its own chart (same per-tab style and colour), no switcher */
  expanded?: boolean;
}) {
  const [active, setActive] = useState(options[0]?.key);
  const id = useId();
  const index = Math.max(0, options.findIndex((o) => o.key === active));
  const current = options[index];
  if (!current) return null;
  const style = styleFor(current);

  if (expanded) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <TrendChart key={o.key} title={`${title} · ${o.label}`} source={source} seriesLabel={o.label} data={o.data} format={o.format}
            reverseY={o.reverseY} variant={styleFor(o).variant} color={styleFor(o).color} compact />
        ))}
      </div>
    );
  }

  const switcher = (
    <div role="tablist" aria-label={`${title} metric`} className="inline-flex flex-wrap gap-0.5 rounded-lg bg-surface-muted p-[3px]">
      {options.map((o) => {
        const selected = o.key === current.key;
        return (
          <button
            key={o.key}
            id={`${id}-${o.key}`}
            role="tab"
            aria-selected={selected}
            onClick={() => setActive(o.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              selected ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-secondary hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <TrendChart
      title={title}
      source={source}
      toolbar={switcher}
      seriesLabel={current.label}
      data={current.data}
      format={current.format}
      reverseY={current.reverseY}
      variant={style.variant}
      color={style.color}
    />
  );
}
