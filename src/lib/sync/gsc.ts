import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GSC_SEARCH_TYPES, queryGsc, type GscSearchType } from "@/lib/composio/gsc";
import type { AdapterContext, DateRange } from "@/lib/analytics/types";
import type { GscRow } from "@/lib/validation/gsc";
import type { SyncResult } from "./types";

export interface GscTarget {
  clientId: string;
  resourceId: string;
  siteUrl: string; // sc-domain:example.com or https://example.com/
}

/** Search Console reports dates in Pacific Time, regardless of the site's own time zone. */
export const GSC_TIME_ZONE = "America/Los_Angeles";

const isIso = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function upsertChunks(
  admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string,
) {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + 1000), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

/** Position is stored as position × impressions so ranges can be re-weighted exactly in SQL. */
const weighted = (r: GscRow) => r.position * r.impressions;
const kindOf = (e: unknown) => (e && typeof e === "object" && "kind" in e ? (e as { kind: string }).kind : null);

/**
 * Imports one Search Console site for `range`.
 *
 * What is stored, and its limits (all Search Console API behaviour, not choices we can undo):
 *  - gsc_daily_metrics: date × device × country totals, for every search type that returns rows.
 *    These are the authoritative totals (they include anonymized queries).
 *  - gsc_query_metrics / gsc_page_metrics: date × query|page × device × country, WEB search only. The API excludes anonymized queries, so these never sum to the daily totals.
 *  - Devices are stored lower-case (mobile/desktop/tablet); countries as the API's lower-case
 *    ISO-3166 alpha-3 codes (e.g. "usa").
 */
export async function syncGsc(
  admin: SupabaseClient, ctx: AdapterContext, t: GscTarget, range: DateRange,
): Promise<SyncResult> {
  const base = { client_id: t.clientId, resource_id: t.resourceId };
  const q = (dimensions: ("date" | "query" | "page" | "device" | "country")[], searchType: GscSearchType, maxRows?: number) =>
    queryGsc(ctx, { siteUrl: t.siteUrl, range, dimensions, searchType, dataState: "all", maxRows });

  const written: Record<string, number> = {};
  const failures: Record<string, string> = {};
  let authError: unknown | null = null;

  const step = async (name: string, run: () => Promise<number>, optional = false) => {
    if (authError) return;
    try {
      written[name] = await run();
    } catch (e) {
      const kind = kindOf(e);
      if (kind === "rate_limit") throw e; // the whole job is idempotent: retry it later with backoff
      if (kind === "auth") authError = e;
      if (!optional || kind === "auth") failures[name] = (e instanceof Error ? e.message : "failed").slice(0, 300);
    }
  };

  const dailyFor = (type: GscSearchType) => async () => {
    const rows = await q(["date", "device", "country"], type);
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const [date, device, country] = r.keys;
      if (!isIso(date)) continue;
      const row = {
        ...base, metric_date: date, search_type: type,
        device: (device ?? "").toLowerCase(), country: (country ?? "").toLowerCase(),
        clicks: r.clicks, impressions: r.impressions, position_x_impressions: weighted(r),
      };
      map.set(`${date}|${row.search_type}|${row.device}|${row.country}`, row);
    }
    return upsertChunks(admin, "gsc_daily_metrics", [...map.values()], "resource_id,metric_date,search_type,device,country");
  };

  await step("daily_web", dailyFor("web"));
  // Other search types only matter if the site has them; an empty result (or an API refusal) is fine.
  for (const type of GSC_SEARCH_TYPES.filter((x) => x !== "web")) {
    await step(`daily_${type}`, dailyFor(type), true);
  }

  await step("queries", async () => {
    const rows = await q(["date", "query", "device", "country"], "web", 500_000);
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const [date, query, device, country] = r.keys;
      if (!isIso(date) || !query) continue;
      const dev = (device ?? "").toLowerCase();
      const ctry = (country ?? "").toLowerCase();
      map.set(`${date}|${dev}|${ctry}|${query}`, {
        ...base, metric_date: date, search_type: "web", device: dev, country: ctry, query,
        clicks: r.clicks, impressions: r.impressions, position_x_impressions: weighted(r),
      });
    }
    return upsertChunks(admin, "gsc_query_metrics", [...map.values()], "resource_id,metric_date,search_type,device,country,query");
  });

  await step("pages", async () => {
    const rows = await q(["date", "page", "device", "country"], "web", 500_000);
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const [date, page, device, country] = r.keys;
      if (!isIso(date) || !page) continue;
      const dev = (device ?? "").toLowerCase();
      const ctry = (country ?? "").toLowerCase();
      map.set(`${date}|${dev}|${ctry}|${page}`, {
        ...base, metric_date: date, search_type: "web", device: dev, country: ctry, page,
        clicks: r.clicks, impressions: r.impressions, position_x_impressions: weighted(r),
      });
    }
    return upsertChunks(admin, "gsc_page_metrics", [...map.values()], "resource_id,metric_date,search_type,device,country,page");
  });

  return { written, failures, authError };
}
