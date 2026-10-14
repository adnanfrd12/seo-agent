import {
  LayoutDashboard, BarChart3, Search, MapPin, CalendarRange, History, Plug, Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    title: "SEO Analytics",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/analytics", label: "Google Analytics 4", icon: BarChart3 },
      { href: "/search-console", label: "Google Search Console", icon: Search },
      { href: "/business-profile", label: "Google Business Profile", icon: MapPin },
    ],
  },
  {
    title: "Reporting",
    items: [
      { href: "/reports", label: "Monthly Reports", icon: CalendarRange },
      { href: "/history", label: "Historical Performance", icon: History },
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
