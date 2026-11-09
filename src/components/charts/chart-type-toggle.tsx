"use client";

import { cn } from "@/lib/utils";

export type ChartKind = "bar" | "line" | "area";

const LABELS: Record<ChartKind, string> = { bar: "Bar", line: "Line", area: "Area" };

/** Small segmented "Bar | Line | Area" switch for time-series charts. */
export function ChartTypeToggle({ value, onChange, options = ["bar", "line"], label = "Chart type" }: {
  value: ChartKind; onChange: (k: ChartKind) => void; options?: ChartKind[]; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-surface-muted p-[3px]">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            value === o ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-secondary hover:text-foreground",
          )}
        >
          {LABELS[o]}
        </button>
      ))}
    </div>
  );
}
