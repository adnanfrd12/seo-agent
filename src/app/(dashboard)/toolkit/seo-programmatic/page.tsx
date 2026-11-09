import Link from "next/link";
import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { BackToToolkit, Card, day, pathLabel } from "@/components/toolkit/bits";
import { ScanRun } from "@/components/toolkit/scan-run";
import { loadBlog } from "@/lib/blog/load";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { loadScan, TK, type ProgrammaticData } from "@/lib/toolkit/site-scan";
import { cn } from "@/lib/utils";

export const maxDuration = 300;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const svcKey = (u: string) => pathLabel(u).replace(/\/$/, "");

/**
 * Service x area planner. Quality gates from the claude-seo seo-programmatic skill (MIT, github.com/AgricIDaniel/claude-seo):
 * each location page needs unique local substance (60%+ unique text, 300+ words of real local detail), no doorway pages,
 * a hard cap per batch, and only real places the business serves.
 */
export default async function ProgrammaticPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, cache } = page;
  const header = <><BackToToolkit /><TabHeader source={null} title="Service x Area Planner" description="A matrix of the website's service pages against the neighbourhoods its blog already targets: which combinations are covered by a post or page, which are gaps worth a page, and the safeguards that keep location pages from becoming thin doorway pages." guide={[
    { term: "Services", text: "WordPress pages that aren't company, legal or job pages (same rule as Blog Content), read with the free WordPress API." },
    { term: "Areas", text: "Neighbourhoods detected in the client's blog posts (Google Map embeds and the post text)." },
    { term: "Covered", text: "A blog post about that area links to (or best matches) that service, or a page URL contains both the service and the area." },
    { term: "Method", text: "Quality gates adapted from the open-source claude-seo seo-programmatic skill (MIT licence)." },
  ]} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website yet" body="Set the client's website so it can be scanned." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  const supabase = await createClient();
  const [stored, blog] = await Promise.all([loadScan<ProgrammaticData>(supabase, client.id, TK.programmatic), loadBlog(supabase, client.id)]);
  const top = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <p className="text-xs text-muted"><span className="font-medium text-foreground">{cache.target.domain}</span> · service pages read {day(stored?.fetchedAt)} · blog synced {day(blog.lastFetched)}</p>
      <ScanRun canEdit={canEdit} />
    </div>
  );
  if (!stored) return <>{header}{top}<EmptyState title="Not scanned yet" body="Run the free scan to read the service pages from WordPress." /></>;
  if (!stored.data.wp || !stored.data.services.length) return <>{header}{top}<EmptyState title="No service pages found" body="The planner needs WordPress service pages; none were found through the WordPress API." /></>;

  const posts = blog.posts;
  const areaPosts = new Map<string, typeof posts>();
  for (const p of posts) {
    const areas = new Set([p.geo?.neighborhood, ...(p.geo?.neighborhoods ?? [])].filter((x): x is string => Boolean(x)));
    for (const a of areas) areaPosts.set(a, [...(areaPosts.get(a) ?? []), p]);
  }
  const areas = [...areaPosts].sort((a, b) => b[1].length - a[1].length).slice(0, 14).map(([a]) => a);
  // service demand = how many posts already point at it; the matrix shows the 14 most-supported services first
  const svcUse = new Map<string, number>();
  for (const p of posts) { const s = p.target_service?.url ?? p.suggested_service?.url; if (s) svcUse.set(svcKey(s), (svcUse.get(svcKey(s)) ?? 0) + 1); }
  const services = [...stored.data.services].sort((a, b) => (svcUse.get(b.path) ?? 0) - (svcUse.get(a.path) ?? 0) || a.title.localeCompare(b.title));
  const shown = services.slice(0, 14);
  const pagePaths = [...stored.data.services.map((s) => s.path), ...stored.data.otherPages].map(norm);

  const cell = (svc: (typeof services)[number], area: string) => {
    const hits = (areaPosts.get(area) ?? []).filter((p) => { const s = p.target_service?.url ?? p.suggested_service?.url; return s ? svcKey(s) === svc.path : false; });
    const a = norm(area), sv = norm(svc.path.split("/").pop() ?? "");
    const pageHit = pagePaths.some((pp) => pp.includes(a) && sv && pp.includes(sv));
    return { posts: hits, page: pageHit };
  };
  const matrix = shown.map((s) => areas.map((a) => cell(s, a)));
  const covered = matrix.flat().filter((c) => c.posts.length || c.page).length;
  const gaps = shown.flatMap((s, i) => areas.map((a, j) => ({ s, a, c: matrix[i][j] }))).filter((x) => !x.c.posts.length && !x.c.page);
  // gap priority: areas with the most posts already (proven demand) x services the blog supports most
  const gapRows = gaps.map((g) => ({ service: g.s.title, service_url: g.s.url, area: g.a, area_posts: areaPosts.get(g.a)?.length ?? 0, service_posts: svcUse.get(g.s.path) ?? 0, score: (areaPosts.get(g.a)?.length ?? 0) * 2 + (svcUse.get(g.s.path) ?? 0), suggested_url: `/${(g.s.path.split("/").pop() ?? "service")}-${norm(g.a).replace(/ /g, "-")}/` })).sort((a, b) => b.score - a.score);

  return (
    <>
      {header}{top}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Service pages" value={String(services.length)} sub={`top ${shown.length} in the matrix`} />
        <StatCard label="Areas from the blog" value={String(areaPosts.size)} sub={`top ${areas.length} in the matrix`} />
        <StatCard label="Combinations covered" value={`${covered} / ${shown.length * areas.length}`} sub="by a post or page" tone={covered ? "good" : "warn"} />
        <StatCard label="Gaps" value={String(gaps.length)} sub="ranked below; build the top few, not all" tone="warn" />
      </div>
      {areas.length === 0 ? (
        <div className="mt-4"><EmptyState title="No neighbourhoods detected yet" body="The blog posts haven't been read for locations yet. Sync the blog on Blog Content; areas are taken from map embeds and the post text." action={{ href: "/blog", label: "Open Blog Content" }} /></div>
      ) : (
        <section aria-label="Service x area matrix" className="mt-4 min-w-0 rounded-[10px] border border-border bg-surface p-4">
          <h2 className="text-[15px] font-semibold">Coverage matrix</h2>
          <p className="mb-3 text-xs text-muted">Rows: service pages. Columns: neighbourhoods. Number = blog posts covering that pair; P = a dedicated page exists; empty = gap.</p>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0.5 text-xs">
              <thead><tr><th className="sticky left-0 bg-surface" />{areas.map((a) => <th key={a} className="h-28 min-w-8 align-bottom font-medium text-muted"><span className="inline-block max-w-28 -rotate-45 truncate whitespace-nowrap text-left" title={a}>{a}</span></th>)}</tr></thead>
              <tbody>{shown.map((s, i) => (
                <tr key={s.path}>
                  <th scope="row" className="sticky left-0 max-w-40 truncate bg-surface pr-2 text-left font-medium" title={s.title}><a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">{s.title}</a></th>
                  {matrix[i].map((c, j) => (
                    <td key={j} title={`${s.title} x ${areas[j]}: ${c.posts.length} posts${c.page ? ", page exists" : ""}`}
                      className={cn("size-8 rounded text-center tabular-nums", c.page ? "bg-positive/70 text-white" : c.posts.length ? "bg-positive/30" : "bg-surface-muted")}>{c.page ? "P" : c.posts.length || ""}</td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Safeguards before building location pages" sub="claude-seo seo-programmatic quality gates">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-secondary">
            <li>Each page needs real local substance: projects done in that area, photos, local landmarks/roads, permit or HOA notes. Aim for 300+ words unique to the area and 60%+ unique text overall.</li>
            <li>No swapped-city templates. Pages that differ only by the place name are doorway pages and risk a manual action.</li>
            <li>Only areas actually served (the Business Profile service area). Build in batches of 5-10, check indexing and traffic, then continue.</li>
            <li>Every new page links to its service page and the related blog posts, and is in the sitemap; keep thin or unindexed ones noindexed or merged.</li>
            <li>Prefer strengthening the existing blog post for an area (link it to the service page) over a new page when the gap is small.</li>
          </ul>
        </Card>
        <Card title="Index-bloat check">
          <p className="text-sm text-secondary">{services.length} service pages and {stored.data.otherPages.length} other pages are published. {services.length > 60 ? "That is already a large set for a local business: before adding more, check in Search Console that the existing ones are indexed and get impressions, and merge pages that overlap." : "The page count is moderate; a small number of well-made area pages is safe."}</p>
          <p className="mt-2 text-xs text-muted">Indexing per page: <Link href="/search-console" className="underline">Search Console</Link> · traffic per page: <Link href="/organic-keywords" className="underline">Organic keywords</Link>.</p>
        </Card>
      </div>
      <div className="mt-6">
        <ResearchTable title="Gaps, highest opportunity first" csvName={`service-area-gaps-${cache.target.domain}`} searchKeys={["service", "area"]}
          rows={gapRows} initialSort={{ key: "score", dir: "desc" }}
          columns={[{ key: "service", label: "Service" }, { key: "service_url", label: "Service page", type: "url" }, { key: "area", label: "Area" }, { key: "area_posts", label: "Posts about area", type: "int" }, { key: "service_posts", label: "Posts for service", type: "int" }, { key: "score", label: "Priority score", type: "int", hint: "2 x area posts + service posts" }, { key: "suggested_url", label: "Suggested URL" }]}
          facets={[{ key: "area", label: "Area" }, { key: "service", label: "Service" }]} empty="Every combination in the matrix is covered." />
      </div>
      <div className="mt-6">
        <ResearchTable title="All service pages" csvName={`service-pages-${cache.target.domain}`} searchKeys={["title", "url"]}
          rows={services.map((s) => ({ title: s.title, url: s.url, posts: svcUse.get(s.path) ?? 0 }))}
          columns={[{ key: "title", label: "Service" }, { key: "url", label: "Page", type: "url" }, { key: "posts", label: "Blog posts pointing here", type: "int" }]} />
      </div>
    </>
  );
}
