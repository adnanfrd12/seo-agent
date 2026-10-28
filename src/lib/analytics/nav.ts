import {
  BarChart3, CalendarCheck, Globe, Link2, ListOrdered, SearchCheck, Swords, CalendarRange, FileUp, History, LayoutDashboard, Lightbulb, MapPin, MousePointerClick, Plug,
  ScanSearch, Search, Settings, Sparkles, type LucideIcon,
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
    ],
  },
  {
    title: "SEO Research",
    items: [
      { href: "/backlinks", label: "Backlinks", icon: Link2 },
      { href: "/competitors", label: "Competitors", icon: Swords },
      { href: "/organic-keywords", label: "Organic Keywords", icon: ListOrdered },
      { href: "/keyword-research", label: "Keyword Research", icon: SearchCheck },
      { href: "/site-audit", label: "Site Audit", icon: ScanSearch },
    ],
  },
  {
    title: "AI Intelligence",
    items: [
      { href: "/insights", label: "AI SEO Insights", icon: Sparkles },
      { href: "/opportunities", label: "SEO Opportunities", icon: Lightbulb },
      { href: "/strategy", label: "30-Day Strategy", icon: CalendarCheck },
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
