"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { FileDown, Search, X } from "lucide-react";
import type { IntegrationCategory } from "@/lib/org/registry";
import { cn } from "@/lib/utils";
import type { FilterItem, FilterStatus } from "./types";

/**
 * The Integrations tab's search box, category chips and status filter. Every block on the page is wrapped in
 * <Filterable> with its category, status and search text, so one filter narrows the client connections, the
 * organization's credential cards and the usage cards together. The filter is kept in ?q=, ?category= and
 * ?status= (without a navigation), so a reload or a shared link shows the same view.
 */
type Category = IntegrationCategory | "all";
type Status = FilterStatus | "all";
interface FilterState { q: string; category: Category; status: Status }
const Ctx = createContext<{
  filter: FilterState; setQ: (q: string) => void; setCategory: (c: Category) => void; setStatus: (s: Status) => void; clear: () => void;
} | null>(null);


export function matches(f: FilterState, item: FilterItem): boolean {
  if (f.category !== "all" && item.category !== f.category) return false;
  if (f.status !== "all" && item.status !== f.status) return false;
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => item.search.includes(w));
}
const active = (f: FilterState) => f.category !== "all" || f.status !== "all" || f.q.trim() !== "";

export function IntegrationsFilterProvider({ initialQ = "", initialCategory = "all", initialStatus = "all", children }: {
  initialQ?: string; initialCategory?: Category; initialStatus?: Status; children: React.ReactNode;
}) {
  const [q, setQ] = useState(initialQ);
  const [category, setCategory] = useState<Category>(initialCategory);
  const [status, setStatus] = useState<Status>(initialStatus);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (q.trim()) url.searchParams.set("q", q.trim()); else url.searchParams.delete("q");
    if (category !== "all") url.searchParams.set("category", category); else url.searchParams.delete("category");
    if (status !== "all") url.searchParams.set("status", status); else url.searchParams.delete("status");
    if (url.href !== window.location.href) window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [q, category, status]);
  const value = useMemo(() => ({
    filter: { q, category, status }, setQ, setCategory, setStatus,
    clear: () => { setQ(""); setCategory("all"); setStatus("all"); },
  }), [q, category, status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hidden (not unmounted, so half-typed forms survive) while it doesn't match the filter. */
export function Filterable({ item, children, className }: { item: FilterItem; children: React.ReactNode; className?: string }) {
  const ctx = useContext(Ctx);
  return <div hidden={ctx ? !matches(ctx.filter, item) : false} className={className}>{children}</div>;
}

/** "Nothing matches" for one section, with a way out. */
export function FilterEmpty({ items, what = "integrations", className }: { items: FilterItem[]; what?: string; className?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx || !active(ctx.filter) || items.some((i) => matches(ctx.filter, i))) return null;
  return (
    <p className={cn("rounded-[10px] border border-dashed border-border-strong bg-surface px-4 py-6 text-center text-sm text-secondary", className)}>
      No {what} match {ctx.filter.q.trim() ? <>&ldquo;{ctx.filter.q.trim()}&rdquo;</> : "this filter"} here.{" "}
      <button type="button" onClick={ctx.clear} className="font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
        Clear the filter
      </button>
    </p>
  );
}

const chip = (on: boolean) => cn(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
  on ? "border-foreground bg-foreground text-background" : "border-border text-secondary hover:bg-surface-muted hover:text-foreground",
);

export interface ToolbarCount { label: string; n: number; tone: "positive" | "warn" | "muted"; status: FilterStatus }

/** Search, category chips, status counts (each one filters by that status), section links and the complete PDF guide. */
export function IntegrationsToolbar({ categories, counts, links, pdfHref }: {
  categories: { id: IntegrationCategory; label: string; count: number }[];
  counts: ToolbarCount[];
  links: { href: string; label: string }[];
  /** the complete setup guide (owners and admins) */
  pdfHref?: string;
}) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const { filter, setQ, setCategory, setStatus } = ctx;
  const total = categories.reduce((s, c) => s + c.count, 0);
  const DOT = { positive: "bg-positive", warn: "bg-warn", muted: "bg-border-strong" } as const;
  return (
    <div className="mb-6 rounded-[10px] border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="search" className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search" value={filter.q} onChange={(e) => setQ(e.target.value)} maxLength={100}
            placeholder="Search integrations, keys or features" aria-label="Search integrations"
            className="h-9 w-full rounded-lg border border-border-strong bg-surface pl-8 pr-8 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-search-cancel-button]:hidden"
          />
          {filter.q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {counts.length > 0 && (
          <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1">
            {counts.map((c) => {
              const on = filter.status === c.status;
              return (
                <button key={c.label} type="button" aria-pressed={on} onClick={() => setStatus(on ? "all" : c.status)}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                    on ? "bg-surface-muted text-foreground ring-1 ring-border-strong" : "text-secondary hover:bg-surface-muted hover:text-foreground")}>
                  <span className={cn("size-2 rounded-full", DOT[c.tone])} aria-hidden />
                  <span className="font-semibold tabular-nums text-foreground">{c.n}</span> {c.label}
                </button>
              );
            })}
          </div>
        )}
        {pdfHref && (
          <a href={pdfHref} download className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium outline-none transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent sm:ml-auto">
            <FileDown className="size-4" aria-hidden /> Download complete setup guide (PDF)
          </a>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={filter.category === "all"} onClick={() => setCategory("all")} className={chip(filter.category === "all")}>
            All <span className="tabular-nums opacity-70">{total}</span>
          </button>
          {categories.filter((c) => c.count > 0).map((c) => (
            <button key={c.id} type="button" aria-pressed={filter.category === c.id} onClick={() => setCategory(filter.category === c.id ? "all" : c.id)} className={chip(filter.category === c.id)}>
              {c.label} <span className="tabular-nums opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
        {links.length > 1 && (
          <nav aria-label="Sections" className="flex flex-wrap gap-x-3 text-[13px]">
            {links.map((l) => <a key={l.href} href={l.href} className="text-secondary underline decoration-border-strong underline-offset-2 hover:text-foreground hover:decoration-foreground">{l.label}</a>)}
          </nav>
        )}
      </div>
    </div>
  );
}
