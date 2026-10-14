import "server-only";
import { executeTool } from "./client";
import { serverEnv } from "@/lib/env";
import {
  ga4AccountSummariesSchema, ga4PropertySchema, ga4ReportSchema, type Ga4Report,
} from "@/lib/validation/ga4";
import type { AdapterContext, DateRange, DiscoveredResource, ProviderAdapter } from "@/lib/analytics/types";

const VERSION = () => serverEnv().COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS || undefined;

/**
 * NOTE: the exact envelope of `data` returned by Composio per tool is confirmed in Phase 3
 * against a real connected account. `unwrap` tolerates the common `{ response_data: ... }` wrapper.
 */
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

export const ga4Adapter: ProviderAdapter<DiscoveredResource> = {
  provider: "ga4",
  async listResources(ctx) {
    const out: DiscoveredResource[] = [];
    let pageToken: string | undefined;
    do {
      const page = ga4AccountSummariesSchema.parse(
        await run(ctx, "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES", { pageSize: 200, ...(pageToken && { pageToken }) }),
      );
      for (const acc of page.accountSummaries) {
        for (const p of acc.propertySummaries) {
          const detail = ga4PropertySchema.safeParse(
            await run(ctx, "GOOGLE_ANALYTICS_GET_PROPERTY", { name: p.property }),
          );
          out.push({
            externalId: p.property,
            displayName: `${p.displayName ?? p.property}${acc.displayName ? ` (${acc.displayName})` : ""}`,
            timezone: detail.success ? detail.data.timeZone : undefined,
            metadata: { account: acc.account },
          });
        }
      }
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
    return out;
  },
};

export interface Ga4ReportRequest {
  property: string; // properties/123
  range: DateRange;
  dimensions: string[];
  metrics: string[];
  limit?: number;
  offset?: number;
  orderBys?: unknown[];
  /** Hard stop on total rows fetched across pages (protects against huge page/event cardinality). */
  maxRows?: number;
}

/** Fetch every page of a GA4 report (GA4 caps rows per request). */
export async function runGa4Report(ctx: AdapterContext, req: Ga4ReportRequest): Promise<Ga4Report["rows"]> {
  const pageSize = req.limit ?? 10_000;
  const rows: Ga4Report["rows"] = [];
  let offset = req.offset ?? 0;
  for (;;) {
    const report = ga4ReportSchema.parse(
      await run(ctx, "GOOGLE_ANALYTICS_RUN_REPORT", {
        property: req.property,
        dateRanges: [{ startDate: req.range.start, endDate: req.range.end }],
        dimensions: req.dimensions.map((name) => ({ name })),
        metrics: req.metrics.map((name) => ({ name })),
        limit: pageSize, offset,
        ...(req.orderBys && { orderBys: req.orderBys }),
      }),
    );
    rows.push(...report.rows);
    if (report.rows.length < pageSize) break;
    if (req.maxRows && rows.length >= req.maxRows) break;
    offset += pageSize;
  }
  return rows;
}
