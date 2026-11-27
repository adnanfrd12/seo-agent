"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useBrandFavicon } from "@/components/org/branding/use-brand-favicon";
import { NAV } from "@/lib/analytics/nav";
import { filterNav } from "@/lib/org/pages";
import { isRangePath } from "@/lib/analytics/range-paths";
import type { ShellBrand } from "@/lib/org/branding-theme";
import { RANGE_EVENT, savedRangeQuery } from "./range-memory";
import { SidebarBrand, SidebarBrandSquare } from "./sidebar-brand";
import { cn } from "@/lib/utils";

function activeItem(pathname: string) {
  for (const g of NAV) for (const i of g.items) {
    const child = i.children?.find((c) => c.href === pathname) ?? i.children?.find((c) => c.href !== i.href && pathname.startsWith(`${c.href}/`));
    if (child) return { group: g.title, item: { ...i, label: child.label } };
    if (pathname === i.href || pathname.startsWith(`${i.href}/`)) return { group: g.title, item: i };
  }
  return null;
}

/* Which sub-tab lists are open, remembered on this device ("1" open / "0" closed; unset = open while on that section). */
const OPEN_KEY = "seo-insights:nav-open";
const openListeners = new Set<() => void>();
function readOpen(): string {
  try { return window.localStorage.getItem(OPEN_KEY) ?? "{}"; } catch { return "{}"; }
}
function setOpen(href: string, open: boolean) {
  let m: Record<string, string> = {};
  try { m = JSON.parse(readOpen()) as Record<string, string>; } catch { /* reset */ }
  m[href] = open ? "1" : "0";
  try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(m)); } catch { /* storage blocked: only this view */ }
  openListeners.forEach((f) => f());
}
const subscribeOpen = (f: () => void) => { openListeners.add(f); return () => openListeners.delete(f); };

/*
 * Date-driven pages opened without a range are redirected by the proxy to the range the user last picked. Putting
 * that range on the sidebar links directly saves the redirect round trip on every click (same page, same range).
 */
const readRange = () => { try { return savedRangeQuery(document.cookie); } catch { return ""; } };
const subscribeRange = (f: () => void) => { window.addEventListener(RANGE_EVENT, f); return () => window.removeEventListener(RANGE_EVENT, f); };

function NavList({ collapsed, onNavigate, enabledPages }: { collapsed: boolean; onNavigate?: () => void; enabledPages?: readonly string[] | null }) {
  // only the pages the organization may use (platform super-admins decide; null = all)
  const nav = useMemo(() => filterNav(NAV, enabledPages), [enabledPages]);
  const pathname = usePathname();
  const openRaw = useSyncExternalStore(subscribeOpen, readOpen, () => "{}");
  const openMap = (() => { try { return JSON.parse(openRaw) as Record<string, string>; } catch { return {}; } })();
  const rangeQs = useSyncExternalStore(subscribeRange, readRange, () => "");
  const to = (path: string) => (rangeQs && isRangePath(path) ? `${path}?${rangeQs}` : path);
  return (
    <nav aria-label="Main" className={cn("pb-6", collapsed ? "px-2" : "px-3")}>
      {nav.map((group, gi) => (
        <div key={group.title} className={gi ? "mt-5 short:mt-3" : "mt-2"}>
          {collapsed
            ? gi > 0 && <div className="mx-2 mb-2 border-t border-hairline" aria-hidden />
            : <p className="mb-1 px-2.5 text-[11px] font-medium tracking-[0.02em] text-faint">{group.title}</p>}
          <ul className="space-y-px">
            {group.items.map(({ href, label, icon: Icon, children }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              if (children?.length && !collapsed) {
                const open = openMap[href] ? openMap[href] === "1" : active;
                return (
                  <li key={href}>
                    {/* one row: icon, name and arrow together. A closed list opens and goes to the section's page;
                        an open list closes and stays on the current page */}
                    <Link href={to(href)} onClick={(e) => { if (open) { e.preventDefault(); setOpen(href, false); } else setOpen(href, true); }} aria-expanded={open}
                      className={cn("relative flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                        active ? "font-medium text-foreground" : "text-secondary hover:bg-surface-muted hover:text-foreground")}>
                      <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted")} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <ChevronDown className={cn("size-3.5 shrink-0 text-muted transition-transform", !open && "-rotate-90")} aria-hidden />
                    </Link>
                    {open && (
                      <ul className="ml-[17px] mt-px space-y-px pl-2">
                        {children.map((c) => {
                          // a sub-tab also stays highlighted on its own sub-pages (e.g. one audit under "All audits")
                          const on = pathname === c.href || (c.href !== href && pathname.startsWith(`${c.href}/`));
                          return (
                            <li key={c.href}>
                              <Link href={to(c.href)} onClick={onNavigate} aria-current={on ? "page" : undefined}
                                className={cn("relative flex h-7 items-center rounded-md px-2.5 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                                  on ? "bg-surface-muted font-medium text-foreground" : "text-secondary hover:bg-surface-muted hover:text-foreground")}>
                                {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--highlight,var(--accent))]" aria-hidden />}
                                <span className="truncate">{c.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              }
              return (
                <li key={href}>
                  <Link
                    href={to(href)} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}
                    className={cn(
                      "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                      active ? "bg-surface-muted font-medium text-foreground" : "text-secondary hover:bg-surface-muted hover:text-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--highlight,var(--accent))]" aria-hidden />}
                    <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted")} aria-hidden />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The application frame: a compact sidebar (brand, client switcher, navigation) and a top bar
 * (where you are, the shared date range, sync status, account). The page scrolls inside `main`.
 * `brand`: the active organization's logo, name and favicon (null = the SEO Insights look).
 */
export function AppShell({ sidebarTop, header, children, brand = null, enabledPages = null }: {
  sidebarTop: React.ReactNode; header: React.ReactNode; children: React.ReactNode; brand?: ShellBrand | null; enabledPages?: readonly string[] | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const here = activeItem(pathname);
  useBrandFavicon(brand?.favicon ?? null);

  const brandLink = (narrow: boolean) => (
    <Link href="/overview" className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <SidebarBrand brand={brand} collapsed={narrow} />
    </Link>
  );

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <aside className={cn("hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 md:flex", collapsed ? "w-14" : "w-[232px]")}>
        <div className={cn("flex h-14 items-center gap-2", collapsed ? "justify-center px-2" : "justify-between px-4")}>
          {collapsed ? (
            // collapsed: the logo, which turns into the expand button on hover or keyboard focus
            <button onClick={() => setCollapsed(false)} aria-label="Expand sidebar" title="Expand sidebar"
              className="group grid size-9 place-items-center rounded-md outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent">
              <SidebarBrandSquare brand={brand} className="group-hover:hidden group-focus-visible:hidden" />
              <PanelLeftOpen className="hidden size-4 text-foreground group-hover:block group-focus-visible:block" aria-hidden />
            </button>
          ) : (
            <>
              {brandLink(collapsed)}
              <button onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar"
                className="rounded-md p-1.5 text-muted outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
                <PanelLeftClose className="size-4" />
              </button>
            </>
          )}
        </div>
        {!collapsed && <div className="px-3 pb-1">{sidebarTop}</div>}
        <div className="flex-1 overflow-y-auto"><NavList collapsed={collapsed} enabledPages={enabledPages} /></div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between px-4">
              {brandLink(false)}
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-md p-2 hover:bg-surface-muted"><X className="size-4" /></button>
            </div>
            <div className="px-3 pb-1">{sidebarTop}</div>
            <div className="flex-1 overflow-y-auto"><NavList collapsed={false} onNavigate={() => setDrawer(false)} enabledPages={enabledPages} /></div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 md:px-6 xl:px-8 2xl:px-10">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="grid size-11 place-items-center rounded-md hover:bg-surface-muted md:hidden">
            <Menu className="size-5" />
          </button>
          <p className="min-w-0 truncate text-[13px] text-muted">
            {here ? <><span className="hidden sm:inline">{here.group}<span className="mx-1.5 text-faint">/</span></span><span className="font-medium text-foreground">{here.item.label}</span></> : null}
          </p>
          <header className="ml-auto flex items-center gap-2 md:gap-3">{header}</header>
        </div>
        <main className="relative flex-1 overflow-y-auto overscroll-contain">
          <div className="w-full px-4 py-6 md:px-6 md:py-8 xl:px-8 2xl:px-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
