import "server-only";

/**
 * Bing Webmaster Tools API (JSON endpoint), API-key auth:
 *   GET https://ssl.bing.com/webmaster/api.svc/json/{Method}?apikey=...&siteUrl=...
 * Responses are wrapped in { d: ... }; dates use the WCF format "/Date(ms)/".
 * Only read methods are used; nothing here changes the Bing account.
 */
const BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export class BingError extends Error {
  constructor(message: string, public kind: "auth" | "not_found" | "rate_limit" | "other", public status = 0) { super(message); }
}

export const cleanKey = (k: string) => k.trim();

async function call<T>(key: string, method: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}/${method}`);
  url.searchParams.set("apikey", cleanKey(key));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      return (text ? (JSON.parse(text) as { d: T }).d : (null as T));
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    // never echo the URL: it carries the API key
    const body = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 401 || res.status === 403 || /InvalidApiKey|NotAuthorized/i.test(body)) {
      throw new BingError("Bing rejected the API key. Generate a new one in Bing Webmaster Tools → Settings → API access.", "auth", res.status);
    }
    if (res.status === 404) throw new BingError(`${method} isn't available for this site.`, "not_found", 404);
    if (res.status === 429 || /ThrottleUser|quota/i.test(body)) throw new BingError("Bing API rate limit reached. The sync will retry.", "rate_limit", res.status);
    throw new BingError(`Bing API error ${res.status} on ${method}.`, "other", res.status);
  }
}

/** "/Date(1750982400000)/" -> "2025-06-27" (UTC); null for Bing's "unknown" sentinel dates. */
export function bingDate(v: unknown): string | null {
  const m = typeof v === "string" ? /\/Date\((-?\d+)/.exec(v) : null;
  if (!m) return null;
  const ms = Number(m[1]);
  return ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null;
}
export const bingDateTime = (v: unknown) => {
  const m = typeof v === "string" ? /\/Date\((-?\d+)/.exec(v) : null;
  return m && Number(m[1]) > 0 ? new Date(Number(m[1])).toISOString() : null;
};

export type BingSite = { Url: string; IsVerified: boolean };
export type BingTraffic = { Date: string; Clicks: number; Impressions: number };
export type BingQueryStat = { Date: string; Query: string; Clicks: number; Impressions: number; AvgClickPosition: number; AvgImpressionPosition: number };
export type BingCrawlStat = {
  Date: string; CrawledPages: number; CrawlErrors: number; InIndex: number; InLinks: number; Code2xx: number; Code301: number; Code302: number;
  Code4xx: number; Code5xx: number; AllOtherCodes: number; BlockedByRobotsTxt: number; DnsFailures: number; ConnectionTimeout: number; ContainsMalware: number;
};
export type BingKeywordStat = { Date: string; Query: string; Impressions: number; BroadImpressions: number };

export const userSites = (key: string) => call<BingSite[]>(key, "GetUserSites");
export const rankAndTraffic = (key: string, siteUrl: string) => call<BingTraffic[]>(key, "GetRankAndTrafficStats", { siteUrl });
export const queryStats = (key: string, siteUrl: string) => call<BingQueryStat[]>(key, "GetQueryStats", { siteUrl });
export const pageStats = (key: string, siteUrl: string) => call<BingQueryStat[]>(key, "GetPageStats", { siteUrl });
export const pageQueryStats = (key: string, siteUrl: string, page: string) => call<BingQueryStat[]>(key, "GetPageQueryStats", { siteUrl, page });
export const crawlStats = (key: string, siteUrl: string) => call<BingCrawlStat[]>(key, "GetCrawlStats", { siteUrl });
export const keywordStats = (key: string, q: string, country = "us", language = "en-US") =>
  call<BingKeywordStat[]>(key, "GetKeywordStats", { q, country, language });

/** Site-level reference data: each is optional (a method missing for a site returns null). */
const SITE_METHODS = {
  feeds: "GetFeeds", crawl_issues: "GetCrawlIssues", url_submission_quota: "GetUrlSubmissionQuota",
  content_submission_quota: "GetContentSubmissionQuota", crawl_settings: "GetCrawlSettings", blocked_urls: "GetBlockedUrls",
  query_parameters: "GetQueryParameters", connected_pages: "GetConnectedPages", country_region_settings: "GetCountryRegionSettings",
  deep_link_blocks: "GetDeepLinkBlocks", page_preview_blocks: "GetActivePagePreviewBlocks", fetched_urls: "GetFetchedUrls",
  site_moves: "GetSiteMoves",
} as const;

export async function siteDetails(key: string, siteUrl: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(Object.entries(SITE_METHODS).map(async ([name, method]) => {
    try { out[name] = await call<unknown>(key, method, { siteUrl }); } catch (e) {
      if (e instanceof BingError && e.kind === "auth") throw e;
      out[name] = null;
    }
  }));
  try { out.home_index = await call<unknown>(key, "GetUrlInfo", { siteUrl, url: siteUrl }); } catch { out.home_index = null; }
  // inbound links: pages of the site that have links pointing at them (paged)
  const links: unknown[] = [];
  try {
    for (let page = 0; page < 20; page++) {
      const r = await call<{ Links: unknown[]; TotalPages: number }>(key, "GetLinkCounts", { siteUrl, page: String(page) });
      links.push(...(r?.Links ?? []));
      if (!r || page + 1 >= (r.TotalPages ?? 0)) break;
    }
  } catch { /* optional */ }
  out.inbound_links = links;
  return out;
}
