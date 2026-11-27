import Link from "next/link";
import {
  Briefcase, Building2, Coins, History, Lock, Palette, Plug, ShieldCheck, SlidersHorizontal, Sparkles, Users, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** The organization settings tabs. `admins`: owners and admins only; `all`: every active member (read-only for members and viewers). */
export const ORG_TABS = [
  { id: "general", label: "General", who: "all", icon: Building2 },
  { id: "branding", label: "Branding", who: "all", icon: Palette },
  { id: "team", label: "Team members", who: "admins", icon: Users },
  { id: "roles", label: "Roles and permissions", who: "all", icon: ShieldCheck },
  { id: "clients", label: "Clients", who: "admins", icon: Briefcase },
  { id: "integrations", label: "Integrations", who: "admins", icon: Plug },
  { id: "preferences", label: "Preferences", who: "admins", icon: SlidersHorizontal },
  { id: "security", label: "Security", who: "admins", icon: Lock },
  { id: "activity", label: "Activity and audit log", who: "admins", icon: History },
  { id: "ai-spend", label: "AI spend", who: "admins", icon: Sparkles },
  { id: "tools-spend", label: "Tools spend", who: "admins", icon: Coins },
] as const satisfies readonly { id: string; label: string; who: "all" | "admins"; icon: LucideIcon }[];
export type OrgTabId = (typeof ORG_TABS)[number]["id"];

/** Vertical list on wide screens, a scrolling row of tabs on phones. */
export function OrgNav({ active, isAdmin, href }: { active: OrgTabId; isAdmin: boolean; href: (tab: string) => string }) {
  const tabs = ORG_TABS.filter((t) => isAdmin || t.who === "all");
  return (
    <nav aria-label="Organization settings" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {tabs.map(({ id, label, icon: Icon }) => {
          const on = id === active;
          return (
            <li key={id} className="shrink-0">
              <Link href={href(id)} aria-current={on ? "page" : undefined}
                className={cn("relative flex h-9 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  on ? "bg-surface-muted font-medium text-foreground" : "text-secondary hover:bg-surface-muted hover:text-foreground")}>
                {on && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent lg:inset-x-auto lg:inset-y-2 lg:left-0 lg:h-auto lg:w-0.5" aria-hidden />}
                <Icon className={cn("size-4 shrink-0", on ? "text-foreground" : "text-muted")} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
