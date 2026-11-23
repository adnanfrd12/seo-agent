import "server-only";
import { executeTool } from "@/lib/composio/client";
import { serverEnv } from "@/lib/env";
import type { Cell, Cube } from "./types";

/** A connected GA4 property (Composio account) to read. */
export interface Ga4xCtx { userId: string; connectedAccountId: string; property: string }

const VERSION = () => serverEnv().COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS || undefined;
const unwrap = (d: unknown): unknown => (d && typeof d === "object" && "response_data" in d ? (d as { response_data: unknown }).response_data : d);

export async function ga(ctx: Ga4xCtx, slug: string, args: Record<string, unknown>, timeoutMs = 90_000): Promise<Record<string, unknown>> {
  const out = unwrap(await executeTool({ slug, arguments: args, userId: ctx.userId, connectedAccountId: ctx.connectedAccountId, toolkitVersionEnv: VERSION(), timeoutMs }));
  return (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
}

/* GA4 Data API filter expressions */
export type Filter = Record<string, unknown>;
export const inList = (field: string, values: string[]): Filter => ({ filter: { fieldName: field, inListFilter: { values, caseSensitive: false } } });
export const regex = (field: string, value: string): Filter => ({ filter: { fieldName: field, stringFilter: { matchType: "PARTIAL_REGEXP", value, caseSensitive: false } } });
export const exact = (field: string, value: string): Filter => ({ filter: { fieldName: field, stringFilter: { matchType: "EXACT", value } } });
export const not = (f: Filter): Filter => ({ notExpression: f });
export const and = (...fs: Filter[]): Filter => ({ andGroup: { expressions: fs } });
export const or = (...fs: Filter[]): Filter => ({ orGroup: { expressions: fs } });

type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
const num = (v: string | undefined) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
/** GA4 dates come as YYYYMMDD and hours as YYYYMMDDHH; stored as YYYY-MM-DD (and YYYY-MM-DD HH). */
const fixDate = (name: string, v: string) =>
  name === "date" && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
    : name === "dateHour" && /^\d{10}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)} ${v.slice(8, 10)}` : v;

export interface ReportReq { start: string; end: string; dimensions: string[]; metrics: string[]; filter?: Filter; maxRows?: number }

/** runReport over every page (up to maxRows), as a compact cube. */
export async function report(ctx: Ga4xCtx, r: ReportReq): Promise<Cube> {
  const limit = 50_000, max = r.maxRows ?? 200_000;
  const rows: Cell[][] = [];
  let offset = 0, total = Infinity;
  while (offset < total && rows.length < max) {
    const res = await ga(ctx, "GOOGLE_ANALYTICS_RUN_REPORT", {
      property: ctx.property,
      dateRanges: [{ startDate: r.start, endDate: r.end }],
      dimensions: r.dimensions.map((name) => ({ name })),
      metrics: r.metrics.map((name) => ({ name })),
      limit, offset,
      ...(r.filter ? { dimensionFilter: r.filter } : {}),
    });
    const page = (res.rows as Row[] | undefined) ?? [];
    total = num(String(res.rowCount ?? page.length));
    for (const x of page) {
      rows.push([
        ...r.dimensions.map((d, i) => fixDate(d, x.dimensionValues?.[i]?.value ?? "")),
        ...r.metrics.map((_, i) => num(x.metricValues?.[i]?.value)),
      ]);
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return { cols: [...r.dimensions, ...r.metrics], rows, ...(rows.length >= max ? { truncated: true } : {}) };
}

/** Several runReports in one call (GA4 allows 5 per batch). Each result as plain rows of strings/numbers. */
export async function batch(ctx: Ga4xCtx, reqs: { dateRanges: { startDate: string; endDate: string }[]; dimensions: string[]; metrics: string[]; limit?: number }[]) {
  const res = await ga(ctx, "GOOGLE_ANALYTICS_BATCH_RUN_REPORTS", {
    property: ctx.property,
    requests: reqs.map((q) => ({ dateRanges: q.dateRanges, dimensions: q.dimensions.map((name) => ({ name })), metrics: q.metrics.map((name) => ({ name })), limit: q.limit ?? 10_000 })),
  });
  const reports = (res.reports as { dimensionHeaders?: { name: string }[]; rows?: Row[] }[] | undefined) ?? [];
  return reports.map((rep) => ({
    dims: (rep.dimensionHeaders ?? []).map((h) => h.name),
    rows: (rep.rows ?? []).map((x) => ({ d: (x.dimensionValues ?? []).map((v) => v.value ?? ""), m: (x.metricValues ?? []).map((v) => num(v.value)) })),
  }));
}
