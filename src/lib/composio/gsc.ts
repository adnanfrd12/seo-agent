import "server-only";
import { executeTool } from "./client";
import { serverEnv } from "@/lib/env";
import { gscAnalyticsSchema, gscSitesSchema, type GscRow } from "@/lib/validation/gsc";
import type { AdapterContext, DateRange, DiscoveredResource, ProviderAdapter } from "@/lib/analytics/types";

const VERSION = () => serverEnv().COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE || undefined;
// Composio docs disagree on the max (5,000 vs 25,000); stay at the lower bound.
const ROW_LIMIT = 5_000;
const MAX_PAGES = 200; // hard stop: 1M rows per request series

function unwrap(data: unknown): unknown {
  if (data && typeof data === "object" && "response_data" in data) {
    return (data as { response_data: unknown }).response_data;
  }
  return data;
}

async function run(ctx: AdapterContext, slug: string, args: Record<string, unknown>) {
  return unwrap(
    await executeTool({
      slug, arguments: args, userId: ctx.userId,
      connectedAccountId: ctx.connectedAccountId, toolkitVersionEnv: VERSION(),
    }),
  );
}

export const gscAdapter: ProviderAdapter<DiscoveredResource> = {
  provider: "gsc",
  async listResources(ctx) {
    const sites = gscSitesSchema.parse(await run(ctx, "GOOGLE_SEARCH_CONSOLE_LIST_SITES", {}));
    return sites.siteEntry
      // unverified/limited entries cannot return analytics
      .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
      .map((s) => ({
        externalId: s.siteUrl,
        displayName: s.siteUrl,
        metadata: { permissionLevel: s.permissionLevel },
      }));
  },
};

export interface GscQuery {
  siteUrl: string;
  range: DateRange;
  /** searchAppearance cannot be combined with any other dimension (API rule); filter on it instead. */
  dimensions: ("date" | "query" | "page" | "device" | "country" | "searchAppearance")[];
  searchType?: GscSearchType;
  /** ANDed dimension filters, e.g. { dimension: "searchAppearance", expression: "PRODUCT_SNIPPETS" }. */
  filters?: { dimension: "searchAppearance" | "query" | "page" | "device" | "country"; operator?: "equals" | "notEquals" | "contains"; expression: string }[];
  /** "all" includes fresh, not-yet-final days (re-fetched by later syncs); "final" lags 2-3 days. */
  dataState?: "final" | "all";
  /** Hard stop on total rows across pages. */
  maxRows?: number;
}

export const GSC_SEARCH_TYPES = ["web", "image", "video", "news", "discover", "googleNews"] as const;
export type GscSearchType = (typeof GSC_SEARCH_TYPES)[number];

/** Paginates with start_row until a short page is returned. */
export async function queryGsc(ctx: AdapterContext, q: GscQuery): Promise<GscRow[]> {
  const rows: GscRow[] = [];
  for (let page = 0, start = 0; page < MAX_PAGES; page++, start += ROW_LIMIT) {
    const res = gscAnalyticsSchema.parse(
      await run(ctx, "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY", {
        site_url: q.siteUrl,
        start_date: q.range.start,
        end_date: q.range.end,
        dimensions: q.dimensions,
        search_type: q.searchType ?? "web",
        data_state: q.dataState ?? "all",
        row_limit: ROW_LIMIT,
        start_row: start,
        ...(q.filters?.length && {
          dimension_filter_groups: [{
            groupType: "and",
            filters: q.filters.map((f) => ({ dimension: f.dimension, operator: f.operator ?? "equals", expression: f.expression })),
          }],
        }),
      }),
    );
    rows.push(...res.rows);
    if (res.rows.length < ROW_LIMIT) break;
    if (q.maxRows && rows.length >= q.maxRows) break;
  }
  return rows;
}
