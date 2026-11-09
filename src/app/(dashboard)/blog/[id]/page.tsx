import { KeywordLink } from "@/components/research/keyword-link";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Panel } from "@/components/charts/ai-charts";
import { StatCard } from "@/components/dashboard/kpi-card";
import { getSession } from "@/lib/analytics/client-context";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { analyseBlog, ISSUES, loadBlog, loadBlogPerformance } from "@/lib/blog/load";
import { pathOf, shareLinks } from "@/lib/blog/parse";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { CopyLink } from "../copy-link";

const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const SEV = { high: "bg-negative", medium: "bg-warn", low: "bg-faint" } as const;
const KIND: Record<string, string> = { home: "Home page", post: "Blog post", service: "Service page", contact: "Contact page", page: "Page", internal: "Your site", map: "Google Maps", external: "Other site" };
const chip = "rounded-md bg-surface-muted px-2 py-1 text-[13px]";
const link = "underline decoration-border-strong underline-offset-2 hover:decoration-foreground";

export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client } = await getSession();
  if (!client) return null;
  const supabase = await createClient();
  const today = todayIn(client.timezone);
  const [blog, perf] = await Promise.all([loadBlog(supabase, client.id), loadBlogPerformance(supabase, client.id, { start: shiftDays(today, -90), end: today })]);
  const post = blog.posts.find((p) => p.id === id);
  if (!post) notFound();
  const a = analyseBlog(blog.posts, perf, today);
  const path = pathOf(post.url);
  const f = perf.get(path);
  const issues = a.issues.get(post.id) ?? [];
  const inbound = a.inbound.get(path) ?? [];
  const share = shareLinks(post.url, post.title);
  const g = post.geo, m = post.map, img = post.featured_image;
  const linksOut = post.links;
  const dfsKw = post.keywords?.dfs ?? [];

  return (
    <>
      <Link href="/blog" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Blog Content</Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-4xl">
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">{post.title}</h1>
          <p className="mt-1.5 text-sm text-secondary">
            Published {day(post.published_date)}{post.modified_at && post.modified_at.slice(0, 10) !== post.published_date ? ` · updated ${day(post.modified_at)}` : ""}
            {post.categories.length ? ` · ${post.categories.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={share.read} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground hover:opacity-90">Read post <ExternalLink className="size-3.5" aria-hidden /></a>
          <CopyLink url={post.url} />
          {([["Facebook", share.facebook], ["X", share.x], ["LinkedIn", share.linkedin], ["Email", share.email]] as const).map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium hover:bg-surface-muted">{label}</a>
          ))}
        </div>
      </header>

      <section aria-label="Post summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Words" value={fmtInt(post.word_count)} sub={post.word_count < 600 ? "under 600" : "600+"} tone={post.word_count < 600 ? "warn" : undefined} />
        <StatCard label="Internal links" value={fmtInt(post.internal_links)} sub={`${fmtInt(post.external_links)} to other sites`} />
        <StatCard label="Links in" value={fmtInt(inbound.length)} sub="from other posts" tone={inbound.length ? undefined : "warn"} />
        <StatCard label="Clicks (90 days)" value={f ? fmtInt(f.clicks) : "—"} sub={f ? `${fmtInt(f.impressions)} impressions` : "Search Console"} />
        <StatCard label="Average position" value={f?.position != null ? f.position.toFixed(1) : "—"} sub={f ? `${fmtInt(f.queries)} queries` : "Search Console"} />
        <StatCard label="Page views (90 days)" value={f ? fmtInt(f.views) : "—"} sub={f ? `${fmtInt(f.sessions)} entrances` : "GA4"} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Featured image" sub={img?.width ? `${img.width} × ${img.height}` : undefined}>
          {!img ? <p className="text-sm text-negative">No featured image.</p> : img.unreadable ? <p className="text-sm text-muted">The post has a featured image, but the site doesn&apos;t share its details.</p> : (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- the client's own image, shown as published */}
              <img src={img.url} alt={img.alt} loading="lazy" className="aspect-video w-full rounded-md border border-hairline object-cover" />
              <p className="text-[13px]"><span className="text-muted">Alt text: </span>{img.alt || <span className="text-negative">missing</span>}</p>
            </div>
          )}
        </Panel>
        <Panel title="Area targeted" sub={g?.model ? "Read from the post by Claude" : "From the post's map link"}>
          {!g ? <p className="text-sm text-muted">No area found yet.</p> : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted">Neighbourhood</dt><dd>{g.neighborhood ?? "—"}</dd>
              <dt className="text-muted">City · ZIP</dt><dd>{[g.city, g.zip].filter(Boolean).join(" · ") || "—"}</dd>
              <dt className="text-muted">Coordinates</dt><dd>{g.lat != null && g.lng != null ? <a className={link} href={`https://www.google.com/maps?q=${g.lat},${g.lng}`} target="_blank" rel="noopener noreferrer">{g.lat.toFixed(5)}, {g.lng.toFixed(5)}</a> : "—"}</dd>
              <dt className="text-muted">Road crossings</dt><dd className="flex flex-wrap gap-1.5">{g.road_crossings.length ? g.road_crossings.map((x) => <span key={x} className={chip}>{x}</span>) : "—"}</dd>
              <dt className="text-muted">Landmarks</dt><dd className="flex flex-wrap gap-1.5">{g.landmarks.length ? g.landmarks.map((x) => <span key={x} className={chip}>{x}</span>) : "—"}</dd>
              {g.neighborhoods.length > 1 && <><dt className="text-muted">Also named</dt><dd>{g.neighborhoods.filter((x) => x !== g.neighborhood).join(", ")}</dd></>}
            </dl>
          )}
        </Panel>
        <Panel title="Google Maps link" sub={m?.embed ? "Map embedded in the post" : m ? "Map link, no embed" : undefined}>
          {!m ? <p className="text-sm text-negative">No Google Map in this post.</p> : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted">Maps CID</dt><dd className="break-all">{m.cid ? <a className={link} href={`https://www.google.com/maps?cid=${m.cid}`} target="_blank" rel="noopener noreferrer">{m.cid}</a> : "—"}</dd>
              <dt className="text-muted">Your profile</dt>
              <dd className={cn("font-medium", m.matches_profile ? "text-positive" : m.matches_profile === false ? "text-negative" : "text-muted")}>{m.matches_profile ? "Yes, it's your Business Profile" : m.matches_profile === false ? "No, a different place" : "Unknown (connect Business Profile)"}</dd>
              <dt className="text-muted">Anchor text</dt><dd>{m.cid_anchor ?? "—"}</dd>
              <dt className="text-muted">Place link</dt><dd>{m.place_url ? <a className={link} href={m.place_url} target="_blank" rel="noopener noreferrer">{m.place_name ?? "Open"}</a> : "—"}</dd>
            </dl>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Keywords" sub="Target from the text; queries from Search Console (last 90 days)">
          <div className="space-y-3 text-[13px]">
            <p><span className="text-muted">Target keyword: </span><span className="font-medium"><KeywordLink q={post.keywords?.target} /></span></p>
            {post.keywords?.dfs_source === "page" && dfsKw.length === 0 && <p className="text-muted">DataForSEO: no Google rankings for this address yet (checked {day(post.keywords.dfs_at ?? null)}).</p>}
            {post.keywords?.secondary?.length ? <p className="flex flex-wrap gap-1.5">{post.keywords.secondary.map((k) => <span key={k} className={chip}>{k}</span>)}</p> : null}
            {f?.top.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[22rem] text-[13px]">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Google query</th><th className="py-1 text-right font-medium">Clicks</th><th className="py-1 text-right font-medium">Impressions</th><th className="py-1 text-right font-medium">Position</th></tr></thead>
                  <tbody>{f.top.map((q) => (
                    <tr key={q.query} className="border-t border-hairline"><td className="py-1.5 pr-3"><KeywordLink q={q.query} /></td><td className="py-1.5 text-right tabular-nums">{fmtInt(q.clicks)}</td><td className="py-1.5 text-right tabular-nums">{fmtInt(q.impressions)}</td><td className="py-1.5 text-right tabular-nums">{q.position?.toFixed(1) ?? "—"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-muted">No Google queries for this post in the last 90 days.</p>}
          </div>
        </Panel>
        <Panel title="Service page" sub="Where the post should send readers who want the service">
          <div className="space-y-3 text-[13px]">
            {post.target_service
              ? <p><span className="text-muted">Links to: </span><a className={cn("font-medium", link)} href={post.target_service.url} target="_blank" rel="noopener noreferrer">{post.target_service.title}</a>{post.target_service.anchor ? <span className="text-muted"> (anchor &ldquo;{post.target_service.anchor}&rdquo;)</span> : null}</p>
              : <p className="text-negative">Doesn&apos;t link to a service page.</p>}
            {!post.target_service && (post.suggested_service
              ? <p><span className="text-muted">Best match: </span><a className={cn("font-medium", link)} href={post.suggested_service.url} target="_blank" rel="noopener noreferrer">{post.suggested_service.title}</a>{post.keywords?.target ? <span className="text-muted"> · link it with &ldquo;{post.keywords.target}&rdquo; as anchor text</span> : null}</p>
              : <p className="text-muted">No service page on the site matches this topic{post.keywords?.target ? ` (“${post.keywords.target}”)` : ""}: a candidate for a new page.</p>)}
            <div className="border-t border-hairline pt-3">
              <p className="mb-2 text-xs font-medium text-muted">Issues</p>
              {issues.length === 0 ? <p className="text-positive">No issues found.</p> : (
                <ul className="space-y-2">{issues.map((k) => (
                  <li key={k} className="flex gap-2.5"><span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEV[ISSUES[k].severity])} aria-hidden /><span><span className="font-medium">{ISSUES[k].label}.</span> <span className="text-secondary">{ISSUES[k].advice}</span></span></li>
                ))}</ul>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {dfsKw.length > 0 && (
        <div className="mt-4">
          <Panel title="Keywords this post ranks for (DataForSEO)"
            sub={`${dfsKw.length} keywords · ${post.keywords?.dfs_source === "page" ? "the post's own list" : "matched from the site's keyword list"}${post.keywords?.dfs_at ? ` · ${day(post.keywords.dfs_at)}` : ""}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-[13px]">
                <thead><tr className="text-left text-xs text-muted">{["Keyword", "Rank", "Monthly searches", "Difficulty", "CPC", "Intent"].map((h, i) => <th key={h} className={cn("py-1 font-medium", i > 0 && i < 5 && "text-right")}>{h}</th>)}</tr></thead>
                <tbody>{dfsKw.map((k) => (
                  <tr key={k.keyword} className="border-t border-hairline">
                    <td className="py-1.5 pr-3"><KeywordLink q={k.keyword} /></td><td className="py-1.5 text-right tabular-nums">{k.position ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtInt(k.volume)}</td><td className="py-1.5 text-right tabular-nums">{k.difficulty ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{k.cpc != null ? `$${k.cpc.toFixed(2)}` : "—"}</td><td className="py-1.5 pl-3 capitalize text-secondary">{k.intent ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Links in this post" sub={`${linksOut.length} links, in the order they appear`}>
          {linksOut.length === 0 ? <p className="text-sm text-muted">No links.</p> : (
            <ul className="divide-y divide-hairline text-[13px]">{linksOut.map((l, i) => (
              <li key={`${l.url}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5">
                <span className="min-w-0"><span className="font-medium">{l.anchor || "(no anchor text)"}</span><a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-muted hover:underline" title={l.url}>{l.internal ? (l.path || "/") : l.url}</a></span>
                <span className="self-center rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-secondary">{KIND[l.kind] ?? l.kind}</span>
              </li>
            ))}</ul>
          )}
        </Panel>
        <Panel title="Posts linking here" sub={inbound.length ? `${inbound.length} other post${inbound.length === 1 ? "" : "s"}` : "No other post links to this one"}>
          {inbound.length === 0 ? <p className="text-sm text-muted">Link to it from related posts so readers and Google can find it.</p> : (
            <ul className="divide-y divide-hairline text-[13px]">{inbound.map((x) => (
              <li key={x.id} className="py-1.5"><Link href={`/blog/${x.id}`} className="font-medium hover:underline">{x.title}</Link><span className="block text-xs text-muted">anchor &ldquo;{x.anchor || "—"}&rdquo;</span></li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </>
  );
}
