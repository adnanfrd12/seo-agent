import "server-only";
import { executeTool } from "@/lib/composio/client";
import { serverEnv } from "@/lib/env";

/** A connected Search Console property (Composio account). */
export interface GscCtx { userId: string; connectedAccountId: string; site: string }

const VERSION = () => serverEnv().COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE || undefined;
const unwrap = (d: unknown): unknown => (d && typeof d === "object" && "response_data" in d ? (d as { response_data: unknown }).response_data : d);

export async function gsc(ctx: GscCtx, slug: string, args: Record<string, unknown>, timeoutMs = 90_000): Promise<Record<string, unknown>> {
  const out = unwrap(await executeTool({ slug, arguments: { site_url: ctx.site, ...args }, userId: ctx.userId, connectedAccountId: ctx.connectedAccountId, toolkitVersionEnv: VERSION(), timeoutMs }));
  return (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
}

export type Dim = "date" | "query" | "page" | "device" | "country" | "searchAppearance" | "hour";
export interface SaFilter { dimension: Exclude<Dim, "date" | "hour">; operator: "equals" | "notEquals" | "contains" | "notContains" | "includingRegex" | "excludingRegex"; expression: string }
export interface SaReq { start: string; end: string; dimensions: Dim[]; type?: string; filters?: SaFilter[]; dataState?: "all" | "final" | "hourly_all"; maxRows?: number }
/** [keys..., clicks, impressions, position × impressions] */
export type SaRow = (string | number)[];

const LIMIT = 25_000;
/** searchAnalytics.query over every page of results (up to maxRows). Position is stored × impressions so averages re-weight. */
export async function sa(ctx: GscCtx, r: SaReq): Promise<SaRow[]> {
  const out: SaRow[] = [];
  const max = r.maxRows ?? 300_000;
  for (let start = 0; out.length < max; start += LIMIT) {
    const res = await gsc(ctx, "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY", {
      start_date: r.start, end_date: r.end, dimensions: r.dimensions, search_type: r.type ?? "web", data_state: r.dataState ?? "all",
      row_limit: LIMIT, start_row: start,
      ...(r.filters?.length ? { dimension_filter_groups: [{ groupType: "and", filters: r.filters }] } : {}),
    });
    const rows = (res.rows as { keys?: string[]; clicks?: number; impressions?: number; position?: number }[] | undefined) ?? [];
    for (const x of rows) {
      const keys = (x.keys ?? []).map((k, i) => (r.dimensions[i] === "hour" ? k.slice(0, 13) : k));
      out.push([...keys, x.clicks ?? 0, x.impressions ?? 0, Math.round((x.position ?? 0) * (x.impressions ?? 0) * 100) / 100]);
    }
    if (rows.length < LIMIT) break;
  }
  return out;
}
