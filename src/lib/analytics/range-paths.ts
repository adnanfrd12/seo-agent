/**
 * Pages whose numbers follow the date range: the top-bar date picker shows on them and the proxy restores
 * the range the user last picked when one is opened without it. Shared by the proxy and the top bar.
 */
const ROOTS = new Set(["/overview", "/analytics", "/search-console", "/business-profile", "/bing", "/opportunities", "/insights", "/strategy", "/blog", "/social"]);

/** GA4 and Search Console sub-tabs on a fixed window or live data, where the picker would change nothing. */
const FIXED = new Set([
  "/analytics/quick-wins", // always the last 30 days
  "/analytics/realtime", // live, last 30 minutes
  "/search-console/quick-wins", // always the last 28 days
  "/search-console/indexing", // URL Inspection state, not a date range
  "/search-console/sitemaps", // sitemaps and inspections
]);

export function isRangePath(path: string): boolean {
  if (ROOTS.has(path)) return true;
  return (path.startsWith("/analytics/") || path.startsWith("/search-console/")) && !FIXED.has(path);
}
