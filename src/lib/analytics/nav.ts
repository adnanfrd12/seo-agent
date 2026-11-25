import {
  BarChart3, CalendarCheck, Globe, Link2, ListOrdered, SearchCheck, Swords, CalendarRange, FileUp, History, LayoutDashboard, Lightbulb, MapPin, MousePointerClick, Plug,
  Bot, GraduationCap, Map as MapIcon, MessagesSquare, Newspaper, Radar, ScanSearch, Search, Settings, Share2, ShieldCheck, Sparkles, Star, TrendingUp, Wrench, Zap, type LucideIcon,
} from "lucide-react";

/** `children` are sub-tabs shown under the item; the sidebar lets them be opened and closed. */
/** A child with `group` starts a small heading above it (e.g. "Leads", "Reports"). */
export interface NavItem { href: string; label: string; icon: LucideIcon; children?: { href: string; label: string; group?: string }[] }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    title: "Analytics",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      {
        href: "/analytics", label: "Google Analytics 4", icon: BarChart3,
        children: [
          { href: "/analytics", label: "GA4 overview" },
          { href: "/analytics/quick-wins", label: "Quick wins", group: "Action plan" },
          { href: "/analytics/home", label: "Home", group: "Overview" },
          { href: "/analytics/leads", label: "Leads overview", group: "Leads" },
          { href: "/analytics/explorer", label: "Lead explorer" },
          { href: "/analytics/lead-log", label: "Lead log" },
          { href: "/analytics/lead-setup", label: "Lead setup" },
          { href: "/analytics/acquisition", label: "Acquisition", group: "Reports" },
          { href: "/analytics/engagement", label: "Engagement" },
          { href: "/analytics/audience", label: "Audience and places" },
          { href: "/analytics/tech", label: "Devices and tech" },
          { href: "/analytics/ecommerce", label: "E-commerce" },
          { href: "/analytics/funnels", label: "Funnels, paths, cohorts", group: "Explore" },
          { href: "/analytics/realtime", label: "Realtime" },
          { href: "/analytics/quality", label: "Insights and data quality", group: "Monitor" },
          { href: "/analytics/seo", label: "SEO: Search Console + GA4" },
        ],
      },
      {
        href: "/search-console", label: "Google Search Console", icon: Search,
        children: [
          { href: "/search-console", label: "GSC overview" },
          { href: "/search-console/quick-wins", label: "Quick wins", group: "Action plan" },
          { href: "/search-console/overview", label: "Overview", group: "Performance" },
          { href: "/search-console/queries", label: "Queries and regex" },
          { href: "/search-console/pages", label: "Pages" },
          { href: "/search-console/watchlists", label: "Page watchlists" },
          { href: "/search-console/segments", label: "Devices, countries, appearance" },
          { href: "/search-console/ai", label: "Questions and AI search", group: "Insights" },
          { href: "/search-console/brand", label: "Brand" },
          { href: "/search-console/opportunities", label: "Opportunities" },
          { href: "/search-console/cannibalization", label: "Cannibalization" },
          { href: "/search-console/local", label: "Local demand" },
          { href: "/search-console/indexing", label: "Indexing", group: "Index" },
          { href: "/search-console/sitemaps", label: "Sitemaps and rich results" },
          { href: "/search-console/alerts", label: "Alerts and insights", group: "Monitor" },
        ],
      },
      { href: "/business-profile", label: "Google Business Profile", icon: MapPin },
      { href: "/bing", label: "Bing Webmaster", icon: Globe },
      { href: "/clarity", label: "Microsoft Clarity", icon: MousePointerClick },
      { href: "/social", label: "Social Media", icon: Share2 },
    ],
  },
  {
    title: "SEO Research",
    items: [
      { href: "/backlinks", label: "Backlinks", icon: Link2 },
      { href: "/competitors", label: "Competitors", icon: Swords },
      { href: "/organic-keywords", label: "Organic Keywords", icon: ListOrdered },
      { href: "/keyword-research", label: "Keyword Research", icon: SearchCheck },
      { href: "/rank-tracking", label: "Rank Tracking", icon: TrendingUp },
      { href: "/local-seo", label: "Local SEO & Reviews", icon: Star },
      { href: "/reviews", label: "Reviews (all platforms)", icon: MessagesSquare },
      { href: "/ai-visibility", label: "AI Visibility", icon: Bot },
      { href: "/site-audit", label: "Site Audit", icon: ScanSearch },
      { href: "/technical-seo", label: "Technical SEO", icon: ShieldCheck },
      { href: "/blog", label: "Blog Content", icon: Newspaper },
    ],
  },
  {
    title: "SEOSignalX",
    items: [
      {
        href: "/seosignalx", label: "SEOSignalX", icon: Radar,
        children: [
          { href: "/seosignalx", label: "Dashboard" },
          { href: "/seosignalx/eeat", label: "E-E-A-T Audit" },
          { href: "/seosignalx/semantic", label: "Semantic Audit" },
          { href: "/seosignalx/speed", label: "Speed Optimization" },
          { href: "/seosignalx/robots", label: "Robots.txt Analyzer" },
          { href: "/seosignalx/crawl-optimization", label: "Crawl Optimization" },
          { href: "/seosignalx/patches", label: "Patches" },
          { href: "/seosignalx/audits", label: "All audits" },
        ],
      },
    ],
  },
  {
    title: "AI Intelligence",
    items: [
      {
        href: "/ai-quick-wins", label: "AI Quick Wins", icon: Zap,
        children: [
          { href: "/ai-quick-wins", label: "Quick wins" },
          { href: "/ai-quick-wins/keywords", label: "Keywords (GSC + DataForSEO)", group: "Data" },
          { href: "/ai-quick-wins/sources", label: "Data sources" },
          { href: "/ai-quick-wins/candidates", label: "Candidates (debug)" },
          { href: "/ai-quick-wins/runs", label: "Runs and spend", group: "Admin" },
          { href: "/ai-quick-wins/settings", label: "AI and data settings" },
          { href: "/ai-quick-wins/how-it-works", label: "How it works" },
        ],
      },
      { href: "/coach", label: "SEO Coach", icon: GraduationCap },
      { href: "/insights", label: "AI SEO Insights", icon: Sparkles },
      { href: "/opportunities", label: "SEO Opportunities", icon: Lightbulb },
      { href: "/roadmap", label: "SEO Roadmap", icon: MapIcon },
      { href: "/strategy", label: "30-Day Strategy", icon: CalendarCheck },
      { href: "/toolkit", label: "SEO Toolkit", icon: Wrench },
    ],
  },
  {
    title: "Reporting",
    items: [
      { href: "/reports", label: "Monthly Reports", icon: CalendarRange },
      { href: "/history", label: "Historical Reports", icon: History },
      { href: "/imports", label: "Import PDF Reports", icon: FileUp },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];
