import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runGa4Report } from "@/lib/composio/ga4";
import type { AdapterContext, DateRange } from "@/lib/analytics/types";
import type { Ga4Report } from "@/lib/validation/ga4";
import type { SyncResult } from "./types";

export interface Ga4Target {
  clientId: string;
  resourceId: string;
  property: string; // properties/123
}

type Rows = Ga4Report["rows"];

const num = (v: string | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
/** GA4 returns dates as YYYYMMDD. */
const isoDate = (v: string | undefined) => {
  const s = v ?? "";
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};
const dim = (r: Rows[number], i: number) => r.dimensionValues[i]?.value ?? "";
const met = (r: Rows[number], i: number) => num(r.metricValues[i]?.value);

async function upsertChunks(
  admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string,
) {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + 1000), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

interface ReportJob {
  name: string;
  run: () => Promise<number>;
  /** A failure here (e.g. a property without the feature, or a database not yet migrated) does not make the job partial. */
  optional?: boolean;
}

/**
 * Imports one GA4 property for `range`. Each report is independent: a failing report is
 * recorded and the others still run, so a job can finish as "partial".
 * All writes are idempotent upserts keyed by (resource, date, dimensions).
 */
export async function syncGa4(
  admin: SupabaseClient, ctx: AdapterContext, t: Ga4Target, range: DateRange,
): Promise<SyncResult> {
  const base = { client_id: t.clientId, resource_id: t.resourceId };
  const report = (dimensions: string[], metrics: string[], extra: { maxRows?: number; orderBys?: unknown[] } = {}) =>
    runGa4Report(ctx, { property: t.property, range, dimensions, metrics, ...extra });

  const jobs: ReportJob[] = [
    {
      name: "daily",
      run: async () => {
        const rows = await report(
          ["date"],
          ["activeUsers", "newUsers", "sessions", "engagedSessions", "userEngagementDuration", "eventCount", "keyEvents", "totalRevenue"],
        );
        const out = rows.flatMap((r) => {
          const d = isoDate(dim(r, 0));
          if (!d) return [];
          const revenue = met(r, 7);
          return [{
            ...base, metric_date: d,
            users: met(r, 0), new_users: met(r, 1), sessions: met(r, 2), engaged_sessions: met(r, 3),
            engagement_seconds: met(r, 4), event_count: met(r, 5), key_events: met(r, 6),
            revenue: revenue > 0 ? revenue : null,
          }];
        });
        return upsertChunks(admin, "ga4_daily_metrics", out, "resource_id,metric_date");
      },
    },
    {
      // date x channel x device x country: lets channel/device/country filters combine on every metric
      name: "cube",
      run: async () => {
        const rows = await report(
          ["date", "sessionDefaultChannelGroup", "deviceCategory", "country"],
          ["activeUsers", "newUsers", "sessions", "engagedSessions", "userEngagementDuration", "eventCount", "keyEvents"],
          { maxRows: 250_000 },
        );
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          if (!d) continue;
          const row = {
            ...base, metric_date: d,
            channel_group: dim(r, 1) || "(not set)", device: dim(r, 2) || "(not set)", country: dim(r, 3) || "(not set)",
            users: met(r, 0), new_users: met(r, 1), sessions: met(r, 2), engaged_sessions: met(r, 3),
            engagement_seconds: met(r, 4), event_count: met(r, 5), key_events: met(r, 6),
          };
          map.set(`${d}|${row.channel_group}|${row.device}|${row.country}`, row);
        }
        return upsertChunks(admin, "ga4_cube_metrics", [...map.values()], "resource_id,metric_date,channel_group,device,country");
      },
    },
    {
      name: "traffic_sources",
      run: async () => {
        const rows = await report(
          ["date", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium"],
          ["sessions", "activeUsers", "engagedSessions", "keyEvents"],
          { maxRows: 100_000 },
        );
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          if (!d) continue;
          const row = {
            ...base, metric_date: d,
            channel_group: dim(r, 1) || "(not set)", source: dim(r, 2) || "(not set)", medium: dim(r, 3) || "(not set)",
            sessions: met(r, 0), users: met(r, 1), engaged_sessions: met(r, 2), key_events: met(r, 3),
          };
          // de-duplicate on the unique key so one upsert statement never hits the same row twice
          map.set(`${d}|${row.channel_group}|${row.source}|${row.medium}`, row);
        }
        return upsertChunks(admin, "ga4_traffic_sources", [...map.values()], "resource_id,metric_date,channel_group,source,medium");
      },
    },
    {
      name: "pages",
      run: async () => {
        const rows = await report(
          ["date", "pagePath"],
          ["screenPageViews", "activeUsers", "userEngagementDuration", "keyEvents"],
          { maxRows: 60_000, orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }] },
        );
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          const path = dim(r, 1);
          if (!d || !path) continue;
          map.set(`${d}|${path}`, {
            ...base, metric_date: d, page_path: path, is_landing: false,
            views: met(r, 0), users: met(r, 1), engagement_seconds: met(r, 2), key_events: met(r, 3), sessions: 0,
          });
        }
        return upsertChunks(admin, "ga4_page_metrics", [...map.values()], "resource_id,metric_date,page_path,is_landing");
      },
    },
    {
      name: "landing_pages",
      run: async () => {
        const rows = await report(
          ["date", "landingPage"],
          ["sessions", "activeUsers", "userEngagementDuration", "keyEvents"],
          { maxRows: 60_000, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] },
        );
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          const path = dim(r, 1);
          if (!d || !path) continue;
          map.set(`${d}|${path}`, {
            ...base, metric_date: d, page_path: path, is_landing: true,
            sessions: met(r, 0), users: met(r, 1), engagement_seconds: met(r, 2), key_events: met(r, 3), views: 0,
          });
        }
        return upsertChunks(admin, "ga4_page_metrics", [...map.values()], "resource_id,metric_date,page_path,is_landing");
      },
    },
    ...(
      [
        ["device", "deviceCategory"],
        ["country", "country"],
        // local-SEO value: where visitors are, and whether they are new or returning
        ["city", "city"],
        ["user_type", "newVsReturning"],
      ] as const
    ).map(([dimension, ga4Dim]): ReportJob => ({
      name: dimension,
      run: async () => {
        const rows = await report(["date", ga4Dim], ["sessions", "activeUsers", "keyEvents"], { maxRows: 100_000 });
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          if (!d) continue;
          const value = dim(r, 1) || "(not set)";
          map.set(`${d}|${value}`, {
            ...base, metric_date: d, dimension, value,
            sessions: met(r, 0), users: met(r, 1), key_events: met(r, 2),
          });
        }
        return upsertChunks(admin, "ga4_dimension_metrics", [...map.values()], "resource_id,metric_date,dimension,value");
      },
    })),
    {
      name: "key_events",
      run: async () => {
        const rows = await report(["date", "eventName"], ["keyEvents"], { maxRows: 100_000 });
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          const count = met(r, 0);
          if (!d || count <= 0) continue; // only events that actually fired as key events
          map.set(`${d}|${dim(r, 1)}`, {
            ...base, metric_date: d, dimension: "key_event", value: dim(r, 1) || "(not set)",
            sessions: 0, users: 0, key_events: count,
          });
        }
        return upsertChunks(admin, "ga4_dimension_metrics", [...map.values()], "resource_id,metric_date,dimension,value");
      },
    },
    {
      // every event (page_view, scroll, form_submit, phone clicks...), like GA4's Engagement > Events report
      name: "events",
      run: async () => {
        const rows = await report(["date", "eventName"], ["eventCount", "totalUsers", "keyEvents", "totalRevenue"], { maxRows: 100_000 });
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          if (!d || met(r, 0) <= 0) continue;
          map.set(`${d}|${dim(r, 1)}`, {
            ...base, metric_date: d, dimension: "event", value: dim(r, 1) || "(not set)",
            sessions: 0, users: met(r, 1), key_events: met(r, 2), event_count: met(r, 0), revenue: Math.max(0, met(r, 3)),
          });
        }
        return upsertChunks(admin, "ga4_dimension_metrics", [...map.values()], "resource_id,metric_date,dimension,value");
      },
    },
    // Campaigns, site search and ecommerce items (generic ga4_dimension_metrics rows). Column use:
    //   campaign    (sessionCampaignName): sessions, users = activeUsers, key_events
    //   search_term (searchTerm):          event_count = eventCount, users = totalUsers
    //   item        (itemName):            event_count = itemsViewed, sessions = itemsAddedToCart,
    //                                      key_events = itemsPurchased, revenue = itemRevenue
    // Many properties have no site search or ecommerce; they simply write 0 rows.
    {
      name: "campaign",
      optional: true,
      run: async () => {
        const rows = await report(["date", "sessionCampaignName"], ["sessions", "activeUsers", "keyEvents"], { maxRows: 100_000 });
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          if (!d || met(r, 0) <= 0) continue;
          const value = dim(r, 1) || "(not set)";
          map.set(`${d}|${value}`, {
            ...base, metric_date: d, dimension: "campaign", value,
            sessions: met(r, 0), users: met(r, 1), key_events: met(r, 2),
          });
        }
        return upsertChunks(admin, "ga4_dimension_metrics", [...map.values()], "resource_id,metric_date,dimension,value");
      },
    },
    {
      name: "search_term",
      optional: true,
      run: async () => {
        const rows = await report(["date", "searchTerm"], ["eventCount", "totalUsers"], { maxRows: 100_000 });
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          // events without a search term (every non-search event) come back as "" / "(not set)"
          const term = dim(r, 1).trim().slice(0, 300);
          if (!d || !term || term === "(not set)" || met(r, 0) <= 0) continue;
          const key = `${d}|${term.toLowerCase()}`;
          const prev = map.get(key);
          map.set(key, {
            ...base, metric_date: d, dimension: "search_term", value: (prev?.value as string) ?? term,
            sessions: 0, key_events: 0,
            event_count: met(r, 0) + ((prev?.event_count as number) ?? 0), users: met(r, 1) + ((prev?.users as number) ?? 0),
          });
        }
        return upsertChunks(admin, "ga4_dimension_metrics", [...map.values()], "resource_id,metric_date,dimension,value");
      },
    },
    {
      name: "item",
      optional: true,
      run: async () => {
        const rows = await report(["date", "itemName"], ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"], { maxRows: 100_000 });
        const map = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const d = isoDate(dim(r, 0));
          const item = dim(r, 1);
          if (!d || !item || [0, 1, 2, 3].every((i) => met(r, i) === 0)) continue;
          map.set(`${d}|${item}`, {
            ...base, metric_date: d, dimension: "item", value: item, users: 0,
            event_count: met(r, 0), sessions: met(r, 1), key_events: met(r, 2), revenue: Math.max(0, met(r, 3)),
          });
        }
        return upsertChunks(admin, "ga4_dimension_metrics", [...map.values()], "resource_id,metric_date,dimension,value");
      },
    },
  ];

  const written: Record<string, number> = {};
  const failures: Record<string, string> = {};
  let authError: unknown | null = null;
  for (const job of jobs) {
    try {
      written[job.name] = await job.run();
    } catch (e) {
      const kind = e && typeof e === "object" && "kind" in e ? (e as { kind: string }).kind : null;
      // rate limited: abandon and retry the whole (idempotent) job later instead of leaving a gap
      if (kind === "rate_limit") throw e;
      if (kind === "auth") authError = e;
      if (job.optional && kind !== "auth") continue;
      failures[job.name] = (e instanceof Error ? e.message : "failed").slice(0, 300);
      if (authError) break; // no point continuing with a revoked token
    }
  }
  return { written, failures, authError };
}
