"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KeywordRow { keyword: string; href: string; volume: number; position: number | null; posts: number; postTitle: string; postHref: string; postUrl: string }
export interface PostRow { title: string; href: string; url: string; clicks: number; impressions: number; ctr: number | null; position: number | null; queries: number; topQuery: string | null; views: number }
export interface QueryRow { query: string; href: string; clicks: number; impressions: number; position: number | null; postTitle: string; postHref: string; postUrl: string }

const PAGE = 10;
const int = (n: number) => n.toLocaleString("en-US");
const pos = (n: number | null) => (n == null ? "—" : n.toFixed(1).replace(/\.0$/, ""));
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };

/** The page a row points at: the post's title (opens its details here) and its address (opens the live page). */
function PageCell({ title, href, url }: { title: string; href: string; url: string }) {
  return (
    <div className="min-w-0">
      <Link href={href} className="line-clamp-1 font-medium hover:underline" title={title}>{title}</Link>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-xs text-muted hover:text-accent" title={url}>
        <span className="truncate">{pathOf(url)}</span><ExternalLink className="size-3 shrink-0" aria-hidden />
      </a>
    </div>
  );
}

function rankTone(p: number | null) {
  if (p == null) return "text-muted";
  return p <= 3 ? "text-emerald-600 dark:text-emerald-400" : p <= 10 ? "text-blue-600 dark:text-blue-400" : p <= 20 ? "text-orange-600 dark:text-orange-400" : "text-muted";
}

function Pager({ page, pages, set }: { page: number; pages: number; set: (p: number) => void }) {
  if (pages <= 1) return null;
  const nums = Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - page) <= 1);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-end gap-1 border-t border-hairline px-4 py-2.5 text-xs">
      <button type="button" onClick={() => set(page - 1)} disabled={page === 0} className="rounded-md px-2 py-1 hover:bg-surface-muted disabled:opacity-40">Previous</button>
      {nums.map((i, k) => (
        <span key={i} className="flex items-center">
          {k > 0 && nums[k - 1] !== i - 1 && <span className="px-1 text-faint">…</span>}
          <button type="button" onClick={() => set(i)} aria-current={i === page ? "page" : undefined}
            className={cn("min-w-7 rounded-md px-2 py-1 tabular-nums", i === page ? "bg-foreground font-semibold text-background" : "hover:bg-surface-muted")}>{i + 1}</button>
        </span>
      ))}
      <button type="button" onClick={() => set(page + 1)} disabled={page >= pages - 1} className="rounded-md px-2 py-1 hover:bg-surface-muted disabled:opacity-40">Next</button>
    </nav>
  );
}

const th = "px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted";
const thR = `${th} text-right`;
const td = "px-4 py-2.5 align-top";
const tdR = `${td} text-right tabular-nums`;

/**
 * The blog's search data as tables, so the client sees the numbers before opening a page:
 * ranking keywords with the page that ranks, posts with their Search Console stats, and the queries
 * that bring each post its impressions. Every row links to the post's details and to the live page.
 */
export function BlogInsightTabs({ keywords, posts, queries, gscOn }: { keywords: KeywordRow[]; posts: PostRow[]; queries: QueryRow[]; gscOn: boolean }) {
  const tabs = [
    { id: "keywords", label: "Ranking keywords", count: keywords.length, sub: "Keywords the blog ranks for · monthly searches from DataForSEO · the post that ranks best" },
    { id: "posts", label: "Posts in Google", count: posts.length, sub: "Search Console · selected period · plus GA4 page views" },
    { id: "queries", label: "Top queries", count: queries.length, sub: "Search Console queries that show each post · selected period" },
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("keywords");
  const [pages, setPages] = useState<Record<string, number>>({});
  const page = pages[tab] ?? 0;
  const setPage = (p: number) => setPages({ ...pages, [tab]: p });
  const cur = tabs.find((t) => t.id === tab)!;
  const slice = <T,>(l: T[]) => l.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <section aria-label="Blog search data" className="overflow-hidden rounded-[10px] border border-border bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-hairline px-4 pt-3">
        <div role="tablist" aria-label="Blog search data" className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cn("shrink-0 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors", tab === t.id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground")}>
              {t.label} <span className="ml-1 rounded-full bg-surface-muted px-1.5 text-[11px] tabular-nums text-muted">{int(t.count)}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="px-4 pt-2.5 text-xs text-muted">{cur.sub}</p>

      <div className="overflow-x-auto">
        {tab === "keywords" && (keywords.length ? (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-hairline"><tr><th className={th}>Keyword</th><th className={thR}>Rank</th><th className={thR}>Monthly searches</th><th className={th}>Ranking page</th></tr></thead>
            <tbody className="divide-y divide-hairline">
              {slice(keywords).map((k) => (
                <tr key={k.keyword}>
                  <td className={td}><Link href={k.href} className="font-medium text-accent hover:underline">{k.keyword}</Link>{k.posts > 1 && <p className="text-xs text-muted">{k.posts} posts rank for it</p>}</td>
                  <td className={cn(tdR, "font-semibold", rankTone(k.position))}>{k.position == null ? "—" : `#${k.position}`}</td>
                  <td className={tdR}>{int(k.volume)}</td>
                  <td className={cn(td, "max-w-[22rem]")}><PageCell title={k.postTitle} href={k.postHref} url={k.postUrl} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-center text-sm text-muted">No ranking keywords yet: they&apos;re matched daily from the DataForSEO keyword data.</p>)}

        {tab === "posts" && (posts.length ? (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-hairline"><tr><th className={th}>Post</th><th className={thR}>Clicks</th><th className={thR}>Impressions</th><th className={thR}>CTR</th><th className={thR}>Avg. position</th><th className={th}>Top query</th><th className={thR}>Page views</th></tr></thead>
            <tbody className="divide-y divide-hairline">
              {slice(posts).map((p) => (
                <tr key={p.href}>
                  <td className={cn(td, "max-w-[22rem]")}><PageCell title={p.title} href={p.href} url={p.url} /></td>
                  <td className={cn(tdR, "font-semibold")}>{int(p.clicks)}</td>
                  <td className={tdR}>{int(p.impressions)}</td>
                  <td className={tdR}>{p.ctr == null ? "—" : `${(p.ctr * (p.ctr <= 1 ? 100 : 1)).toFixed(1)}%`}</td>
                  <td className={cn(tdR, rankTone(p.position))}>{pos(p.position)}</td>
                  <td className={cn(td, "max-w-[14rem]")}><span className="line-clamp-1" title={p.topQuery ?? undefined}>{p.topQuery ?? "—"}</span>{p.queries > 1 && <p className="text-xs text-muted">{int(p.queries)} queries</p>}</td>
                  <td className={tdR}>{int(p.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-center text-sm text-muted">{gscOn ? "No post was shown in Google in this period." : "Connect Search Console to see clicks per post."}</p>)}

        {tab === "queries" && (queries.length ? (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-hairline"><tr><th className={th}>Query</th><th className={thR}>Clicks</th><th className={thR}>Impressions</th><th className={thR}>Position</th><th className={th}>Page shown</th></tr></thead>
            <tbody className="divide-y divide-hairline">
              {slice(queries).map((q, i) => (
                <tr key={`${q.query}-${q.postHref}-${i}`}>
                  <td className={td}><Link href={q.href} className="font-medium text-accent hover:underline">{q.query}</Link></td>
                  <td className={cn(tdR, "font-semibold")}>{int(q.clicks)}</td>
                  <td className={tdR}>{int(q.impressions)}</td>
                  <td className={cn(tdR, rankTone(q.position))}>{pos(q.position)}</td>
                  <td className={cn(td, "max-w-[22rem]")}><PageCell title={q.postTitle} href={q.postHref} url={q.postUrl} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-center text-sm text-muted">{gscOn ? "No queries in this period." : "Connect Search Console to see the queries per post."}</p>)}
      </div>
      <Pager page={page} pages={Math.ceil(cur.count / PAGE)} set={setPage} />
    </section>
  );
}
