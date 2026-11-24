/**
 * Screens a "this screen only" run can target: the screen key used in candidates' scope_screens, its label and the
 * page it lives on. Shared by server and client code.
 */
export const SCREENS: { key: string; label: string; path: string }[] = [
  { key: "gsc:overview", label: "Search Console: Overview", path: "/search-console/overview" },
  { key: "gsc:queries", label: "Search Console: Queries", path: "/search-console/queries" },
  { key: "gsc:pages", label: "Search Console: Pages", path: "/search-console/pages" },
  { key: "gsc:watch", label: "Search Console: Page watchlists", path: "/search-console/watchlists" },
  { key: "gsc:segments", label: "Search Console: Devices, countries, appearance", path: "/search-console/segments" },
  { key: "gsc:ai", label: "Search Console: Questions and AI search", path: "/search-console/ai" },
  { key: "gsc:brand", label: "Search Console: Brand", path: "/search-console/brand" },
  { key: "gsc:opps", label: "Search Console: Opportunities", path: "/search-console/opportunities" },
  { key: "gsc:cannibal", label: "Search Console: Cannibalization", path: "/search-console/cannibalization" },
  { key: "gsc:local", label: "Search Console: Local demand", path: "/search-console/local" },
  { key: "gsc:indexing", label: "Search Console: Indexing", path: "/search-console/indexing" },
  { key: "gsc:sitemaps", label: "Search Console: Sitemaps and rich results", path: "/search-console/sitemaps" },
  { key: "gsc:alerts", label: "Search Console: Alerts and insights", path: "/search-console/alerts" },
  { key: "ga4:home", label: "GA4: Home", path: "/analytics/home" },
  { key: "ga4:leads", label: "GA4: Leads overview", path: "/analytics/leads" },
  { key: "ga4:explorer", label: "GA4: Lead explorer", path: "/analytics/explorer" },
  { key: "ga4:leadlog", label: "GA4: Lead log", path: "/analytics/lead-log" },
  { key: "ga4:setup", label: "GA4: Lead setup", path: "/analytics/lead-setup" },
  { key: "ga4:acq", label: "GA4: Acquisition", path: "/analytics/acquisition" },
  { key: "ga4:eng", label: "GA4: Engagement", path: "/analytics/engagement" },
  { key: "ga4:geo", label: "GA4: Audience and places", path: "/analytics/audience" },
  { key: "ga4:tech", label: "GA4: Devices and tech", path: "/analytics/tech" },
  { key: "ga4:funnels", label: "GA4: Funnels, paths, cohorts", path: "/analytics/funnels" },
  { key: "ga4:quality", label: "GA4: Insights and data quality", path: "/analytics/quality" },
  { key: "ga4:seo", label: "GA4: SEO (Search Console + GA4)", path: "/analytics/seo" },
  { key: "business-profile", label: "Google Business Profile", path: "/business-profile" },
  { key: "bing", label: "Bing Webmaster", path: "/bing" },
  { key: "clarity", label: "Microsoft Clarity", path: "/clarity" },
  { key: "social", label: "Social media", path: "/social" },
  { key: "seosignalx", label: "SEOSignalX", path: "/seosignalx" },
  { key: "dfs:keywords", label: "Keywords (Search Console + DataForSEO)", path: "/ai-quick-wins/keywords" },
  { key: "dfs:backlinks", label: "Backlinks", path: "/backlinks" },
];
export const screenLabel = (key: string) => SCREENS.find((s) => s.key === key)?.label ?? key;
/** The screen key of a dashboard page, for the "Quick wins for this screen" box at its bottom. */
export const screenForPath = (path: string) => SCREENS.find((s) => s.path === path)?.key ?? null;
