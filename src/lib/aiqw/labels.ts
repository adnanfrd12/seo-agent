/** Plain names of the quick-win rules (server and client). */
export const RULE_LABEL: Record<string, string> = {
  dfs_keyword_gap: "Keyword gap page", dfs_striking_volume: "Volume-weighted striking distance", dfs_serp_feature: "SERP feature win",
  dfs_ai_overview: "AI Overview present", dfs_local_pack: "Local pack", dfs_backlink_gap: "Backlink gap", dfs_reviews: "Reviews",
  gbp_actions_drop: "Business Profile actions fell", gbp_keywords_site: "Business Profile searches not on the site", gbp_review_replies: "Unanswered reviews",
  bing_striking: "Bing striking distance", bing_crawl: "Bing crawl problems", clarity_ux: "Clarity frustration signals", social_reconnect: "Social account needs a login",
  social_cadence: "Social posting cadence", seosignalx_audit: "SEOSignalX failed checks",
  crawl_duplicate_title: "Duplicate titles", crawl_missing_meta: "Missing meta descriptions", crawl_missing_h1: "Missing H1", crawl_slow: "Slow pages", crawl_broken_links: "Broken internal links",
};
export const ruleLabel = (r: string) => RULE_LABEL[r] ?? (r.startsWith("gsc:") ? `Search Console: ${r.slice(4)}` : r.startsWith("ga4:") ? `GA4: ${r.slice(4)}` : r);
