"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { NAV } from "@/lib/analytics/nav";
import { cn } from "@/lib/utils";

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5 px-3 py-4">
      {NAV.map((group) => (
        <div key={group.title}>
          {!collapsed && (
            <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</p>
          )}
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? label : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                      active ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-surface-muted",
                      collapsed && "justify-center",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
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

export function AppShell({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop / tablet sidebar */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] md:flex",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          {!collapsed && <span className="font-semibold">SEO Analytics</span>}
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-md p-1.5 text-muted outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto"><NavList collapsed={collapsed} /></div>
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="font-semibold">SEO Analytics</span>
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-md p-1.5 hover:bg-surface-muted">
                <X className="size-4" />
              </button>
            </div>
            <NavList collapsed={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:px-6">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="rounded-md p-2 hover:bg-surface-muted md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <header className="flex min-w-0 flex-1 items-center gap-3">{header}</header>
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
