"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { BrandMark, BRAND_NAME } from "@/components/brand/brand-mark";
import { NAV } from "@/lib/analytics/nav";
import { cn } from "@/lib/utils";

function activeItem(pathname: string) {
  for (const g of NAV) for (const i of g.items) if (pathname === i.href || pathname.startsWith(`${i.href}/`)) return { group: g.title, item: i };
  return null;
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn("pb-6", collapsed ? "px-2" : "px-3")}>
      {NAV.map((group, gi) => (
        <div key={group.title} className={gi ? "mt-5 short:mt-3" : "mt-2"}>
          {collapsed
            ? gi > 0 && <div className="mx-2 mb-2 border-t border-hairline" aria-hidden />
            : <p className="mb-1 px-2.5 text-[11px] font-medium tracking-[0.02em] text-faint">{group.title}</p>}
          <ul className="space-y-px">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}
                    className={cn(
                      "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                      active ? "bg-surface-muted font-medium text-foreground" : "text-secondary hover:bg-surface-muted hover:text-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
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
 */
export function AppShell({ sidebarTop, header, children }: { sidebarTop: React.ReactNode; header: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const here = activeItem(pathname);

  const brand = (
    <Link href="/overview" className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <BrandMark className="h-5" />
      {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight">{BRAND_NAME}</span>}
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
              <BrandMark className="h-5 group-hover:hidden group-focus-visible:hidden" />
              <PanelLeftOpen className="hidden size-4 text-foreground group-hover:block group-focus-visible:block" aria-hidden />
            </button>
          ) : (
            <>
              {brand}
              <button onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar"
                className="rounded-md p-1.5 text-muted outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
                <PanelLeftClose className="size-4" />
              </button>
            </>
          )}
        </div>
        {!collapsed && <div className="px-3 pb-1">{sidebarTop}</div>}
        <div className="flex-1 overflow-y-auto"><NavList collapsed={collapsed} /></div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between px-4">
              {brand}
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-md p-2 hover:bg-surface-muted"><X className="size-4" /></button>
            </div>
            <div className="px-3 pb-1">{sidebarTop}</div>
            <div className="flex-1 overflow-y-auto"><NavList collapsed={false} onNavigate={() => setDrawer(false)} /></div>
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
