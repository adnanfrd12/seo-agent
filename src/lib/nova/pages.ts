import { pageAllowed } from "@/lib/org/pages";

/**
 * Nova follows the organization's page access (organizations.enabled_pages, set by platform super-admins): a tool
 * that reads or changes the data of a dashboard page is only offered, run and confirmed while at least one of its
 * pages is enabled. Tools not listed here (client settings, data sources and syncs, alerts, the user's own name,
 * data freshness) belong to every organization. Hrefs are the sidebar's (src/lib/analytics/nav.ts).
 */
const GA4 = ["/analytics"];
const GSC = ["/search-console"];
const RESEARCH = ["/backlinks", "/competitors", "/organic-keywords"];
const SITE_HEALTH = ["/site-audit", "/technical-seo"];

export const TOOL_PAGES: Record<string, readonly string[]> = {
  // data readers that belong to one area
  get_competitor_analysis: ["/competitors"],
  get_historical_performance: ["/history", "/overview"],

  // roadmap
  ...Object.fromEntries([
    "add_roadmap_task", "bulk_add_roadmap_tasks", "bulk_delete_roadmap_tasks", "bulk_update_roadmap_tasks", "create_roadmap_month",
    "delete_roadmap_month", "delete_roadmap_task", "edit_roadmap_checklist", "generate_monthly_strategy", "get_roadmap",
    "get_roadmap_history", "get_roadmap_progress", "get_roadmap_tasks", "list_roadmap_months", "mark_task_completed",
    "move_roadmap_tasks", "search_roadmap_tasks", "update_monthly_strategy", "update_roadmap_task",
  ].map((t) => [t, ["/roadmap"]])),

  // AI intelligence
  generate_ai_insights_or_strategy: ["/insights", "/strategy"],
  get_ai_insights: ["/insights"],
  set_ai_insight_status: ["/insights"],
  get_30_day_strategy: ["/strategy"],
  set_30_day_strategy_task_status: ["/strategy"],
  get_seo_coach: ["/coach"],
  run_seo_coach: ["/coach"],
  get_quick_win_runs: ["/ai-quick-wins/runs", "/ai-quick-wins"],
  get_quick_wins: ["/ai-quick-wins"],
  start_quick_wins_run: ["/ai-quick-wins"],
  update_quick_wins: ["/ai-quick-wins"],
  fetch_quick_wins_keyword_data: ["/ai-quick-wins/keywords"],
  get_ai_settings: ["/ai-quick-wins/settings"],
  update_ai_settings: ["/ai-quick-wins/settings"],

  // content and reporting
  get_blog_posts: ["/blog"],
  refresh_blog: ["/blog"],
  get_reports_and_imports: ["/reports", "/imports"],
  review_imported_figures: ["/imports"],
  find_social_profiles: ["/social"],
  get_social_media_stats: ["/social"],
  refresh_social_stats: ["/social"],
  update_social_profiles: ["/social"],

  // analytics screens
  get_search_console_report: GSC,
  get_search_console_settings: GSC,
  update_search_console_lists: GSC,
  get_lead_setup: ["/analytics/lead-setup"],
  update_lead_setup: ["/analytics/lead-setup"],
  get_clarity_recording_reviews: ["/clarity"],
  add_clarity_recording_reviews: ["/clarity"],
  edit_clarity_recording_reviews: ["/clarity"],
  get_review_platforms: ["/reviews"],
  refresh_platform_reviews: ["/reviews"],
  update_review_listing_links: ["/reviews"],

  // SEO research and site health
  get_research_results: RESEARCH,
  run_seo_research: RESEARCH,
  get_keyword_research: ["/keyword-research"],
  run_keyword_research: ["/keyword-research"],
  get_site_audit_results: SITE_HEALTH,
  start_site_audit: ["/site-audit"],
  run_site_checks: ["/technical-seo"],
  get_local_seo_results: ["/local-seo"],
  run_local_seo: ["/local-seo"],
  get_toolkit_results: ["/toolkit"],
  run_toolkit_tool: ["/toolkit"],
  sync_seosignalx: ["/seosignalx"],

  // tracking
  get_ai_visibility: ["/ai-visibility"],
  run_ai_visibility_check: ["/ai-visibility"],
  update_ai_visibility: ["/ai-visibility"],
  refresh_ai_brand_lookup: ["/ai-visibility"],
  get_brand_terms: ["/ai-visibility", ...GSC],
  set_brand_terms: ["/ai-visibility", ...GSC],
  get_competitor_tracking: ["/competitors"],
  update_competitors: ["/competitors"],
  refresh_competitor_links_pages: ["/competitors"],
  check_rankings_now: ["/rank-tracking"],
  get_rank_tracking: ["/rank-tracking"],
  update_rank_tracking: ["/rank-tracking"],
};

/** The pages behind each detailed data view of get_client_analytics (src/lib/ai/intelligence.ts DATA_VIEWS). */
export const VIEW_PAGES: Record<string, readonly string[]> = {
  search_console_overview: ["/search-console/overview", ...GSC],
  search_console_queries: ["/search-console/queries"],
  search_console_pages: ["/search-console/pages"],
  search_console_opportunities: ["/search-console/opportunities", "/search-console/quick-wins"],
  search_console_cannibalization: ["/search-console/cannibalization"],
  search_console_indexing: ["/search-console/indexing"],
  ga4_overview: ["/analytics/home", ...GA4],
  ga4_acquisition: ["/analytics/acquisition"],
  ga4_engagement: ["/analytics/engagement"],
  ga4_leads: ["/analytics/leads", "/analytics/explorer", "/analytics/lead-log"],
  business_profile: ["/business-profile"],
  bing: ["/bing"],
  clarity: ["/clarity"],
  social: ["/social"],
  keywords: ["/organic-keywords"],
  backlinks: ["/backlinks"],
  competitors: ["/competitors"],
  rank_tracking: ["/rank-tracking"],
  site_audit: SITE_HEALTH,
  ai_visibility: ["/ai-visibility"],
  local_seo: ["/local-seo", "/business-profile"],
  imported_reports: ["/imports"],
};

const anyAllowed = (enabled: readonly string[] | null | undefined, pages: readonly string[] | undefined) =>
  !enabled || !pages || pages.some((p) => pageAllowed(enabled, p));

/** Whether the organization's page access lets Nova use this tool (null pages = every page). */
export const toolAllowed = (name: string, enabled: readonly string[] | null | undefined) => anyAllowed(enabled, TOOL_PAGES[name]);

/** Whether a detailed data view of get_client_analytics is within the organization's pages. */
export const viewAllowed = (view: string, enabled: readonly string[] | null | undefined) => anyAllowed(enabled, VIEW_PAGES[view]);

/** The message Nova gets for a tool or view outside the organization's pages. */
export const NOT_IN_PLAN = "That part of the dashboard isn't available to this organization, so it can't be read or changed. Tell the user it isn't part of their workspace (a platform administrator can enable it).";
