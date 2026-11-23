import "server-only";
import { ga, type Ga4xCtx } from "./api";
import { addDays } from "./model";

/** GA4 funnel report (runFunnelReport): users reaching each step, overall and by device. */
export interface FunnelResult { steps: string[]; total: number[]; byDevice: Record<string, number[]> }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function leadFunnel(ctx: Ga4xCtx, r: { start: string; end: string }, servicePaths: string[], contactPaths: string[], formEvents: string[]): Promise<FunnelResult> {
  const pageStep = (name: string, paths: string[]) => ({
    name,
    filterExpression: paths.length
      ? { andGroup: { expressions: [{ funnelEventFilter: { eventName: "page_view" } }, { funnelFieldFilter: { fieldName: "pagePath", stringFilter: { matchType: "FULL_REGEXP", value: paths.slice(0, 40).map(esc).join("|") } } }] } }
      : { funnelEventFilter: { eventName: "page_view" } },
  });
  const steps = [
    { name: "Session start", filterExpression: { funnelEventFilter: { eventName: "session_start" } } },
    pageStep("Viewed a service or city page", servicePaths),
    pageStep("Viewed contact or estimate page", contactPaths),
    { name: "form_start", filterExpression: { funnelEventFilter: { eventName: "form_start" } } },
    { name: "Form lead submitted", filterExpression: formEvents.length > 1 ? { orGroup: { expressions: formEvents.map((e) => ({ funnelEventFilter: { eventName: e } })) } } : { funnelEventFilter: { eventName: formEvents[0] ?? "generate_lead" } } },
  ];
  const res = await ga(ctx, "GOOGLE_ANALYTICS_RUN_FUNNEL_REPORT", {
    property: ctx.property, dateRanges: [{ startDate: r.start, endDate: r.end }],
    funnel: { isOpenFunnel: true, steps }, funnelBreakdown: { breakdownDimension: { name: "deviceCategory" }, limit: 5 },
  }, 90_000);
  const table = (res.funnelTable ?? {}) as { rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[] };
  const out: FunnelResult = { steps: steps.map((s) => s.name), total: steps.map(() => 0), byDevice: {} };
  for (const row of table.rows ?? []) {
    const stepName = row.dimensionValues?.[0]?.value ?? "", dev = row.dimensionValues?.[1]?.value ?? "RESERVED_TOTAL";
    const i = out.steps.findIndex((s) => stepName.endsWith(s));
    if (i < 0) continue;
    const v = Number(row.metricValues?.[0]?.value ?? 0);
    if (dev === "RESERVED_TOTAL") out.total[i] = v;
    else (out.byDevice[dev] ??= steps.map(() => 0))[i] = v;
  }
  return out;
}

/** Weekly cohorts of new users (by first visit week) and the share still active in later weeks. */
export interface Cohorts { names: string[]; weeks: number; m: (number | null)[][] }
export async function weeklyCohorts(ctx: Ga4xCtx, end: string, n = 6): Promise<Cohorts> {
  // weeks ending at `end`, oldest first
  const cohorts = Array.from({ length: n }, (_, i) => { const s = addDays(end, -7 * (n - i) + 1); return { name: s, dimension: "firstSessionDate", dateRange: { startDate: s, endDate: addDays(s, 6) } }; });
  const res = await ga(ctx, "GOOGLE_ANALYTICS_RUN_REPORT", {
    property: ctx.property, dimensions: [{ name: "cohort" }, { name: "cohortNthWeek" }], metrics: [{ name: "cohortActiveUsers" }],
    cohortSpec: { cohorts, cohortsRange: { granularity: "WEEKLY", startOffset: 0, endOffset: n - 1 } },
  });
  const rows = (res.rows as { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[] | undefined) ?? [];
  const raw = cohorts.map(() => new Array<number>(n).fill(0));
  for (const r of rows) {
    const ci = cohorts.findIndex((c) => c.name === r.dimensionValues?.[0]?.value), w = Number(r.dimensionValues?.[1]?.value ?? -1);
    if (ci >= 0 && w >= 0 && w < n) raw[ci][w] = Number(r.metricValues?.[0]?.value ?? 0);
  }
  const m = raw.map((row, ci) => row.map((v, w) => (w > n - 1 - ci ? null : row[0] ? Math.round((v / row[0]) * 1000) / 10 : 0)));
  return { names: cohorts.map((c) => c.name), weeks: n, m };
}
