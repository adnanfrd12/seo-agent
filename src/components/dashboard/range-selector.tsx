import type { DateRangeSel } from "@/lib/analytics/range";
import type { SearchParams } from "@/lib/analytics/url";

/**
 * The date range now lives in the top bar (components/layout/top-range.tsx), shared by every
 * date-driven page and driven by the same URL parameters. Pages keep calling this so their
 * markup is unchanged; it renders nothing.
 */
export function RangeSelector(_props: { path: string; sp: SearchParams; range: DateRangeSel; showCompare?: boolean }) {
  return null;
}
