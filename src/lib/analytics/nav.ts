import {
  BarChart3, CalendarCheck, Globe, Link2, ListOrdered, SearchCheck, Swords, CalendarRange, FileUp, History, LayoutDashboard, Lightbulb, MapPin, MousePointerClick, Plug,
  Bot, GraduationCap, MessagesSquare, Newspaper, ScanSearch, Search, Settings, Share2, ShieldCheck, Sparkles, Star, TrendingUp, Wrench, type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    title: "Analytics",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/analytics", label: "Google Analytics 4", icon: BarChart3 },
      { href: "/search-console", label: "Google Search Console", icon: Search },
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
    title: "AI Intelligence",
    items: [
      { href: "/coach", label: "SEO Coach", icon: GraduationCap },
      { href: "/insights", label: "AI SEO Insights", icon: Sparkles },
      { href: "/opportunities", label: "SEO Opportunities", icon: Lightbulb },
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
