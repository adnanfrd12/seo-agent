"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { TrendChart, type TrendFormat, type TrendPoint } from "./trend-chart";

export interface MetricOption {
  key: string;
  label: string;
  data: TrendPoint[];
  format?: TrendFormat;
  reverseY?: boolean;
}

/**
 * One chart with a segmented metric switcher. Measures with different scales (e.g. clicks and
 * impressions) are shown one at a time instead of on a misleading dual axis.
 */
export function MetricTrend({ title, source, options }: { title: string; source?: string; options: MetricOption[] }) {
  const [active, setActive] = useState(options[0]?.key);
  const id = useId();
  const current = options.find((o) => o.key === active) ?? options[0];
  if (!current) return null;

  const switcher = (
    <div role="tablist" aria-label={`${title} metric`} className="inline-flex rounded-lg border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          id={`${id}-${o.key}`}
          role="tab"
          aria-selected={o.key === current.key}
          onClick={() => setActive(o.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            o.key === current.key ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-surface-muted",
          )}
        >
          {o.label}
        </button>
      ))}
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
    />
  );
}
