import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import {
  BingError, bingDate, crawlStats, userSites, keywordStats, pageQueryStats, pageStats, queryStats, rankAndTraffic, siteDetails, type BingQueryStat,
} from "@/lib/bing/api";
import type { SyncResult } from "./types";

const TOP_PAGES_FOR_QUERIES = 25;
const TOP_QUERIES_FOR_VOLUME = 15;

async function upsert(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

const pos = (v: number | null | undefined) => (v == null || v < 0 ? null : v);

/** Sums duplicate (bucket, key) rows Bing sometimes returns, keeping an impression-weighted position. */
function weekly(rows: BingQueryStat[]) {
  const map = new Map<string, { week: string; key: string; clicks: number; impressions: number; cpos: number; ccnt: number; ipos: number; icnt: number }>();
  for (const r of rows) {
    const week = bingDate(r.Date);
    if (!week || !r.Query) continue;
    const k = `${week}|${r.Query}`;
    const o = map.get(k) ?? { week, key: r.Query, clicks: 0, impressions: 0, cpos: 0, ccnt: 0, ipos: 0, icnt: 0 };
    o.clicks += r.Clicks ?? 0;
    o.impressions += r.Impressions ?? 0;
    if (pos(r.AvgClickPosition) != null) { o.cpos += r.AvgClickPosition * Math.max(1, r.Clicks); o.ccnt += Math.max(1, r.Clicks); }
    if (pos(r.AvgImpressionPosition) != null) { o.ipos += r.AvgImpressionPosition * Math.max(1, r.Impressions); o.icnt += Math.max(1, r.Impressions); }
    map.set(k, o);
  }
  return [...map.values()].map((o) => ({
    week: o.week, key: o.key, clicks: o.clicks, impressions: o.impressions,
    avg_click_position: o.ccnt ? o.cpos / o.ccnt : null, avg_impression_position: o.icnt ? o.ipos / o.icnt : null,
  }));
}

/**
 * Imports everything Bing Webmaster Tools reports for one site. Bing returns its full available
 * history on every call (about 16 months daily, weekly query/page buckets), so each sync simply
 * re-upserts it; writes are idempotent.
 */
export async function syncBing(
  admin: SupabaseClient, t: { clientId: string; resourceId: string; connectionId: string; siteUrl: string },
): Promise<SyncResult> {
  const written: Record<string, number> = {};
  const failures: Record<string, string> = {};
  const { data: secret } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", t.connectionId).maybeSingle();
  if (!secret?.refresh_token_encrypted) return { written, failures: { key: "No Bing API key stored." }, authError: new Error("no key") };
  const key = decryptSecret(secret.refresh_token_encrypted);
  const base = { client_id: t.clientId, resource_id: t.resourceId };
  const now = new Date().toISOString();
  let topQueries: string[] = [];
  let topPages: string[] = [];

  const steps: [string, () => Promise<number>][] = [
    ["daily", async () => {
      const byDay = new Map<string, { clicks: number; impressions: number }>();
      for (const r of await rankAndTraffic(key, t.siteUrl) ?? []) {
        const d = bingDate(r.Date);
        if (!d) continue;
        const o = byDay.get(d) ?? { clicks: 0, impressions: 0 };
        o.clicks += r.Clicks ?? 0; o.impressions += r.Impressions ?? 0;
        byDay.set(d, o);
      }
      return upsert(admin, "bing_daily_metrics", [...byDay].map(([metric_date, v]) => ({ ...base, metric_date, ...v, updated_at: now })), "resource_id,metric_date");
    }],
    ["queries", async () => {
      const rows = weekly(await queryStats(key, t.siteUrl) ?? []);
      const totals = new Map<string, number>();
      for (const r of rows) totals.set(r.key, (totals.get(r.key) ?? 0) + r.impressions);
      topQueries = [...totals].sort((a, b) => b[1] - a[1]).slice(0, TOP_QUERIES_FOR_VOLUME).map(([q]) => q);
      return upsert(admin, "bing_query_metrics", rows.map(({ key: query, ...r }) => ({ ...base, ...r, query, updated_at: now })), "resource_id,week,query");
    }],
    ["pages", async () => {
      const rows = weekly(await pageStats(key, t.siteUrl) ?? []);
      const totals = new Map<string, number>();
      for (const r of rows) totals.set(r.key, (totals.get(r.key) ?? 0) + r.impressions);
      topPages = [...totals].sort((a, b) => b[1] - a[1]).slice(0, TOP_PAGES_FOR_QUERIES).map(([p]) => p);
      return upsert(admin, "bing_page_metrics", rows.map(({ key: page, ...r }) => ({ ...base, ...r, page, updated_at: now })), "resource_id,week,page");
    }],
    ["page_queries", async () => {
      let n = 0;
      for (const page of topPages) {
        const rows = weekly(await pageQueryStats(key, t.siteUrl, page) ?? []);
        n += await upsert(admin, "bing_page_query_metrics", rows.map((r) => ({
          ...base, week: r.week, page, query: r.key, clicks: r.clicks, impressions: r.impressions,
          avg_impression_position: r.avg_impression_position, updated_at: now,
        })), "resource_id,week,page,query");
      }
      return n;
    }],
    ["crawl", async () => {
      const rows = (await crawlStats(key, t.siteUrl) ?? []).flatMap((c) => {
        const metric_date = bingDate(c.Date);
        return metric_date ? [{
          ...base, metric_date, crawled_pages: c.CrawledPages, crawl_errors: c.CrawlErrors, in_index: c.InIndex, in_links: c.InLinks,
          code_2xx: c.Code2xx, code_301: c.Code301, code_302: c.Code302, code_4xx: c.Code4xx, code_5xx: c.Code5xx, all_other_codes: c.AllOtherCodes,
          blocked_by_robots: c.BlockedByRobotsTxt, dns_failures: c.DnsFailures, connection_timeout: c.ConnectionTimeout, contains_malware: c.ContainsMalware,
          updated_at: now,
        }] : [];
      });
      return upsert(admin, "bing_crawl_metrics", [...new Map(rows.map((r) => [r.metric_date, r])).values()], "resource_id,metric_date");
    }],
    ["details", async () => {
      const details = await siteDetails(key, t.siteUrl);
      // Bing search volume (weekly, US English) for the site's top queries
      const volume: Record<string, { week: string | null; impressions: number; broad: number }[]> = {};
      for (const q of topQueries) {
        try {
          volume[q] = (await keywordStats(key, q) ?? []).map((k) => ({ week: bingDate(k.Date), impressions: k.Impressions, broad: k.BroadImpressions }));
        } catch (e) { if (e instanceof BingError && e.kind === "auth") throw e; }
      }
      const { data: res } = await admin.from("integration_resources").select("metadata").eq("id", t.resourceId).maybeSingle();
      await admin.from("integration_resources").update({
        metadata: { ...(res?.metadata ?? {}), bing: details, keyword_volume: volume, details_synced_at: now },
      }).eq("id", t.resourceId);
      return Object.keys(details).length;
    }],
  ];

  let keyChecked: boolean | null = null; // is the API key itself valid? (one free call, made only when a step is refused)
  for (const [name, run] of steps) {
    try {
      written[name] = await run();
    } catch (e) {
      if (e instanceof BingError && e.kind === "auth") {
        if (keyChecked === null) keyChecked = await userSites(key).then(() => true, () => false);
        if (!keyChecked) return { written, failures: { ...failures, [name]: e.message }, authError: e };
        // the key works, so Bing only refused this report for this site: keep going with the rest
        failures[name] = `Bing didn't allow the ${name} report for this site (the API key itself is valid).`;
        continue;
      }
      failures[name] = (e instanceof Error ? e.message : "failed").slice(0, 300);
    }
  }
  return { written, failures, authError: null };
}
