import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { geogridConfigs, geogrids, getLocation, LbmError, legacyInsights, performanceMetrics, reportsList, reviews, searchImpressions } from "@/lib/lbm/api";
import type { SyncResult } from "./types";

/** Upserts in chunks; returns rows written. */
async function upsert(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

/**
 * Imports everything Local Brand Manager offers for one location: GBP daily performance metrics,
 * monthly search keywords, all reviews, geogrid rank scans, location details and report links.
 * Every write is an idempotent upsert on the remote identity, so re-running is safe.
 */
export async function syncLbm(
  admin: SupabaseClient,
  t: { clientId: string; resourceId: string; connectionId: string; lbmId: string; gbpId: string },
): Promise<SyncResult> {
  const written: Record<string, number> = {};
  const failures: Record<string, string> = {};
  const { data: secret } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", t.connectionId).maybeSingle();
  if (!secret?.refresh_token_encrypted) return { written, failures: { token: "No Local Brand Manager token stored." }, authError: new Error("no token") };
  const token = decryptSecret(secret.refresh_token_encrypted);
  const base = { client_id: t.clientId, resource_id: t.resourceId };
  const now = () => new Date().toISOString();

  const steps: [string, () => Promise<number>][] = [
    ["daily", async () => {
      const rows = (await performanceMetrics(token, t.gbpId)).map((d) => ({
        ...base, metric_date: d.timestamp.slice(0, 10),
        impressions_desktop_maps: d.business_impressions_desktop_maps ?? null,
        impressions_desktop_search: d.business_impressions_desktop_search ?? null,
        impressions_mobile_maps: d.business_impressions_mobile_maps ?? null,
        impressions_mobile_search: d.business_impressions_mobile_search ?? null,
        conversations: d.business_conversations ?? null,
        direction_requests: d.business_direction_requests ?? null,
        call_clicks: d.call_clicks ?? null,
        website_clicks: d.website_clicks ?? null,
        updated_at: now(),
      }));
      return upsert(admin, "gbp_daily_metrics", rows, "resource_id,metric_date");
    }],
    ["keywords", async () => {
      const list = await searchImpressions(token, t.gbpId);
      const rows = [...new Map(list.map((k) => [`${k.month}|${k.search_keyword}`, k])).values()].map((k) => ({
        ...base, month: `${k.month.slice(0, 7)}-01`, keyword: k.search_keyword,
        // "less_threshold" means the real value is below insights_value
        impressions: k.less_threshold ? null : k.insights_value, impressions_threshold: k.less_threshold ? k.insights_value : null,
        updated_at: now(),
      }));
      return upsert(admin, "gbp_keyword_metrics", rows, "resource_id,month,keyword");
    }],
    ["reviews", async () => {
      const rows = (await reviews(token, t.lbmId)).map((r) => {
        const reply = typeof r.reply === "string" ? { comment: r.reply } : r.reply ?? null;
        return {
          ...base, remote_id: r.remote_id, rating: r.rating ?? null, text: r.text ?? null,
          reviewer_name: r.reviewer?.display_name ?? null, reviewer_photo_url: r.reviewer?.profile_photo_url ?? null,
          reply_text: reply?.comment ?? null, replied_at: reply && "update_time" in reply ? reply.update_time ?? null : null,
          reviewed_at: r.created_at ?? null, raw: r, updated_at: now(),
        };
      });
      return upsert(admin, "gbp_reviews", rows, "resource_id,remote_id");
    }],
    ["geogrids", async () => {
      // after the first import only newer scans are fetched
      const { data: last } = await admin.from("gbp_geogrids").select("scanned_at").eq("resource_id", t.resourceId)
        .order("scanned_at", { ascending: false }).limit(1).maybeSingle();
      const since = last?.scanned_at ? new Date(Date.parse(last.scanned_at) - 7 * 86_400_000).toISOString() : undefined;
      const rows = (await geogrids(token, t.lbmId, since)).map((g) => ({
        ...base, remote_id: g.id, search_term: g.search_term, state: g.state, scanned_at: g.finished_at ?? g.created_at,
        agr: g.agr, atgr: g.atgr, solv: g.solv, grid_size: g.grid_size, point_distance: g.grid_point_distance,
        distance_measure: g.grid_distance_measure, ranks: g.ranks, image_url: g.image_url, public_url: g.public_url,
        raw: { ...g, ranks: undefined }, updated_at: now(),
      }));
      return upsert(admin, "gbp_geogrids", rows, "resource_id,remote_id");
    }],
    ["details", async () => {
      const [loc, reports, configs, legacy] = await Promise.all([
        getLocation(token, t.lbmId), reportsList(token).catch(() => []),
        geogridConfigs(token, t.lbmId).catch(() => []), legacyInsights(token, t.gbpId).catch(() => []),
      ]);
      const mine = reports.filter((r) => r.locations.some((l) => l.name === loc.name && (!loc.address || l.address === loc.address)))
        .map((r) => ({ name: r.configuration_name, created_at: r.created_at, periods: r.periods, url: r.report_url })).slice(0, 50);
      const { data: res } = await admin.from("integration_resources").select("metadata").eq("id", t.resourceId).maybeSingle();
      await admin.from("integration_resources").update({
        display_name: loc.name,
        metadata: {
          ...(res?.metadata ?? {}), source: "lbm", lbm_id: loc.id, place_id: loc.place_id, address: loc.address,
          phone: loc.phone_number ?? null, category: loc.primary_category ?? null, website: loc.website_url ?? null,
          maps_uri: loc.gmb_url ?? null, description: loc.description ?? null, open_status: loc.states.includes("verified") ? "Verified" : null,
          lbm_reports: mine,
          // full location record (hours, service area, categories...) and rank-tracking setup, as returned
          lbm_location: loc,
          lbm_geogrid_configs: configs,
          lbm_legacy_insights: legacy,
        },
      }).eq("id", t.resourceId);
      return 1;
    }],
  ];

  for (const [name, run] of steps) {
    try {
      written[name] = await run();
    } catch (e) {
      if (e instanceof LbmError && e.kind === "auth") return { written, failures: { ...failures, [name]: e.message }, authError: e };
      failures[name] = (e instanceof Error ? e.message : "failed").slice(0, 300);
    }
  }
  return { written, failures, authError: null };
}
