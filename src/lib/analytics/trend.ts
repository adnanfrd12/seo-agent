import type { TrendPoint } from "@/components/charts/trend-chart";
import { toNum } from "./format";
import { shiftDays } from "./range";

export type TrendRow = { date: string } & Record<string, unknown>;
export interface TrendData {
  current: TrendRow[];
  previous: TrendRow[];
}

/**
 * One point per day across the whole range, so charts never draw a line across days that have no
 * stored row. A missing day means "nothing happened" for counts (0), but is unknown for ratios
 * such as CTR, engagement rate or average position (left empty rather than shown as 0).
 */
export function dailySeries(
  t: TrendData | null | undefined,
  key: string,
  range: { start: string; end: string },
  kind: "count" | "ratio" = "count",
): TrendPoint[] {
  if (!t) return [];
  const cur = new Map(t.current.map((p) => [p.date, toNum(p[key])]));
  const prev = new Map(t.previous.map((p) => [p.date, toNum(p[key])]));
  const hasPrev = t.previous.length > 0;
  const empty = kind === "count" ? 0 : null;
  const out: TrendPoint[] = [];
  for (let d = range.start; d <= range.end; d = shiftDays(d, 1)) {
    out.push({
      date: d,
      value: cur.has(d) ? cur.get(d)! : empty,
      previous: hasPrev ? (prev.has(d) ? prev.get(d)! : empty) : null,
    });
    if (out.length > 800) break; // guards against a malformed range
  }
  // no stored rows at all: return [] so the chart shows its empty state instead of a flat zero line
  return t.current.length === 0 ? [] : out;
}
