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
 * Each tab gets its own chart style and colour, so switching is unmistakable: bars, area, line,
 * stepped line. The colours stay readable in light and dark mode.
 */
const STYLES: { variant: TrendVariant; color: string }[] = [
  { variant: "bar", color: "var(--accent)" },
  { variant: "area", color: "#2563EB" },
  { variant: "line", color: "#0D9488" },
  { variant: "step", color: "#7C3AED" },
];

/**
 * One chart with a segmented metric switcher. Measures with different scales (e.g. clicks and
 * impressions) are shown one at a time instead of on a misleading dual axis.
 */
export function MetricTrend({ title, source, options }: { title: string; source?: string; options: MetricOption[] }) {
  const [active, setActive] = useState(options[0]?.key);
  const id = useId();
  const index = Math.max(0, options.findIndex((o) => o.key === active));
  const current = options[index];
  if (!current) return null;
  const style = STYLES[index % STYLES.length];

  const switcher = (
    <div role="tablist" aria-label={`${title} metric`} className="inline-flex flex-wrap rounded-lg border border-border p-0.5">
      {options.map((o, i) => {
        const selected = o.key === current.key;
        const color = STYLES[i % STYLES.length].color;
        return (
          <button
            key={o.key}
            id={`${id}-${o.key}`}
            role="tab"
            aria-selected={selected}
            onClick={() => setActive(o.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              selected ? "text-white shadow-sm" : "text-foreground/80 hover:bg-surface-muted",
            )}
            style={selected ? { background: color } : undefined}
          >
            {!selected && <span className="inline-block size-2 rounded-full" style={{ background: color }} aria-hidden />}
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
