import Link from "next/link";
import { Columns, Panel } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { GeoSpread } from "@/components/charts/blog-charts";
import { Highlights } from "@/components/dashboard/highlights";
import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { getSession } from "@/lib/analytics/client-context";
import { fmtInt } from "@/lib/analytics/format";
import { resolveRange, shiftDays, todayIn } from "@/lib/analytics/range";
import { first, type SearchParams } from "@/lib/analytics/url";
import { analyseBlog, ISSUE_ORDER, ISSUES, lastMonths, loadBlog, loadBlogPerformance } from "@/lib/blog/load";
import { POST_KW_EST } from "@/lib/blog/keywords";
import { pathOf } from "@/lib/blog/parse";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { localIdentity } from "@/lib/dataforseo/local";
import { memo } from "@/lib/memo";
import { pickHighlights } from "@/lib/overview/highlights";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { BlogSync } from "./blog-sync";

export const maxDuration = 300; // the first read of a large blog runs from this page

const monthLabel = (m: string, year = false) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
// bar lists are keyed by label: repeated labels (two service pages called "Manufacturing Signs",
// two posts with one title) get their address, or a number, added
const unique = <T extends { label: string; url?: string }>(items: T[]): T[] => {
  const seen = new Map<string, number>();
  for (const i of items) seen.set(i.label, (seen.get(i.label) ?? 0) + 1);
  const used = new Set<string>();
  return items.map((i) => {
    let label = i.label;
    if ((seen.get(i.label) ?? 0) > 1 && i.url) label = `${i.label} (${pathOf(i.url) || "/"})`;
    for (let k = 2; used.has(label); k++) label = `${i.label} (${k})`;
    used.add(label);
    return { ...i, label };
  });
};
const count = <T,>(list: T[], key: (x: T) => string[]) => {
  const m = new Map<string, number>();
  for (const x of list) for (const k of new Set(key(x))) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
};

export default async function BlogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client, user } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp.range) ?? (first(sp.start) ? undefined : "30"), start: first(sp.start), end: first(sp.end) }, client.timezone, client.defaultRangeDays);
  const today = todayIn(client.timezone);
  const supabase = await createClient();
  const [blog, perf, perf90, me] = await memo(`blog|${user.id}|${client.id}|${range.start}|${range.end}`, 120_000, () => Promise.all([
    loadBlog(supabase, client.id),
    loadBlogPerformance(supabase, client.id, range),
    loadBlogPerformance(supabase, client.id, { start: shiftDays(today, -90), end: today }),
    localIdentity(createAdminClient(), client.id).catch(() => null),
  ]));
  const sixtyDays = shiftDays(today, -60);
  const ownList = (p: (typeof blog.posts)[number]) => p.keywords?.dfs_source === "page";
  const actions = canEdit ? <BlogSync dfs={dfsConfigured()} perPost={POST_KW_EST}
    newPosts={blog.posts.filter((p) => !ownList(p) && (p.published_date ?? "") >= sixtyDays).length} allPosts={blog.posts.filter((p) => !ownList(p)).length} /> : undefined;
  const header = (
    <TabHeader source={null} eyebrow="Your website" title="Blog Content"
      description="Every post on the website: what it targets, which area, roads and landmarks it names, how it links to your Business Profile and service pages, and how it performs in Google."
      actions={actions}
      guide={[
        { term: "Service page", text: "The page on the site that sells the service the post is about. A post should link to it with the service as anchor text." },
        { term: "Map / CID", text: "The Google Maps link or embed in the post. Its CID should be your own Business Profile." },
        { term: "Roads and landmarks", text: "Road crossings and named places the post mentions, read from the text by Claude." },
        { term: "No Google impressions", text: "Published over 30 days ago and not shown in Google search in the last 90 days (Search Console)." },
      ]} />
  );

  if (blog.missing) return <>{header}<EmptyState title="Blog content needs one database update" body="Apply migration 20261106000023 (supabase/migrations) in the Supabase SQL editor, then reload this page." /></>;
  if (!blog.ok) return <>{header}<EmptyState title="Couldn't load blog posts" body="Please try again in a moment." /></>;
  const posts = blog.posts;
  if (!posts.length) return <>{header}<EmptyState title="No blog posts read yet" body={canEdit ? "Press “Read the blog now” above, or wait for tomorrow's automatic run." : "Posts are read automatically every day; check back tomorrow."} /></>;

  const a = analyseBlog(posts, perf90, today);
  const n = posts.length;
  const pct = (k: number) => Math.round((k / n) * 100);
  const month = today.slice(0, 7);
  const [prevMonth] = lastMonths(today, 2);
  const thisMonth = posts.filter((p) => p.published_date?.startsWith(month));
  const lastMonthCount = posts.filter((p) => p.published_date?.startsWith(prevMonth)).length;
  const withImage = posts.filter((p) => p.featured_image).length;
  const noAlt = posts.filter((p) => a.issues.get(p.id)?.includes("no_alt")).length;
  const withMap = posts.filter((p) => p.map && (p.map.embed || p.map.cid)).length;
  const toProfile = posts.filter((p) => p.map?.matches_profile).length;
  const withService = posts.filter((p) => p.target_service).length;
  const avgWords = Math.round(posts.reduce((s, p) => s + p.word_count, 0) / n);
  const read = posts.filter((p) => p.geo?.model).length;
  const has = (k: (typeof ISSUE_ORDER)[number]) => posts.filter((p) => a.issues.get(p.id)?.includes(k)).length;
  const issueRows = ISSUE_ORDER.map((k) => ({ k, value: has(k) }));
  const totals = posts.reduce((t, p) => { const f = perf.get(pathOf(p.url)); return f ? { clicks: t.clicks + f.clicks, impressions: t.impressions + f.impressions, views: t.views + f.views } : t; }, { clicks: 0, impressions: 0, views: 0 });
  const gscOn = perf.size > 0;
  const source = posts[0]?.source === "sitemap" ? "the sitemap" : "WordPress";

  const picks = pickHighlights([
    withService === 0
      ? { tone: "bad", title: `None of the ${n} posts links to a service page`, detail: "They link to the home page and contact page instead.", action: "Link each post to the service page it's about, with the service as anchor text (suggested pages are in the table)." }
      : withService < n * 0.7 && { tone: "bad", title: `${n - withService} of ${n} posts don't link to a service page`, detail: `${pct(withService)}% do.`, action: "Add a link to the matching service page in each post." },
    has("not_indexed") > 0 && { tone: "bad", title: `${has("not_indexed")} posts have no Google impressions after 30 days`, detail: "Search Console hasn't shown them in 90 days.", action: "Check indexing with URL inspection and link to them from service pages." },
    { tone: thisMonth.length ? "good" : "info", title: `${thisMonth.length} post${thisMonth.length === 1 ? "" : "s"} released in ${monthLabel(month)}`, detail: `${lastMonthCount} in ${monthLabel(prevMonth)}.` },
    withMap > 0 && toProfile === withMap && { tone: "good", title: "Every post's map points to your Business Profile", detail: `${withMap} posts embed a map and link your profile's Maps CID.` },
    withMap > 0 && toProfile < withMap && { tone: "bad", title: `${withMap - toProfile} posts link a map that isn't your profile`, detail: "Their Maps CID doesn't match your Business Profile." },
    has("thin") > 0 && { tone: "info", title: `${has("thin")} posts are under 600 words`, detail: `Average length is ${fmtInt(avgWords)} words.` },
  ]);

  // the map: neighbourhoods with coordinates, around the business (or the middle of the posts)
  const areaPts = new Map<string, { name: string; lat: number; lng: number; count: number; zip: string | null }>();
  for (const p of posts) {
    const g = p.geo;
    if (!g?.neighborhood || g.lat == null || g.lng == null) continue;
    const x = areaPts.get(g.neighborhood) ?? { name: g.neighborhood, lat: g.lat, lng: g.lng, count: 0, zip: g.zip };
    x.count++;
    areaPts.set(g.neighborhood, x);
  }
  const pts = [...areaPts.values()];
  const center = me?.lat != null && me.lng != null
    ? { lat: me.lat, lng: me.lng, label: me.name || "Your business" }
    : pts.length ? { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length, label: "Middle of the targeted areas" } : null;
  const crossings = count(posts, (p) => p.geo?.road_crossings ?? []);
  const landmarks = count(posts, (p) => p.geo?.landmarks ?? []);
  const bins = [[0, 600, "<600"], [600, 900, "600-899"], [900, 1200, "900-1,199"], [1200, 1500, "1,200-1,499"], [1500, Infinity, "1,500+"]] as const;
  const topClicks = posts.map((p) => ({ p, f: perf.get(pathOf(p.url)) })).filter((x) => x.f && x.f.clicks + x.f.impressions > 0)
    .sort((x, y) => y.f!.clicks - x.f!.clicks || y.f!.impressions - x.f!.impressions).slice(0, 10);

  // the biggest DataForSEO keywords the blog ranks for (each keyword once, at its best position)
  const kwBest = new Map<string, { volume: number; position: number | null; post: string }>();
  for (const p of posts) for (const k of p.keywords?.dfs ?? []) {
    const x = kwBest.get(k.keyword);
    if (!x || (k.position ?? 999) < (x.position ?? 999)) kwBest.set(k.keyword, { volume: k.volume ?? 0, position: k.position, post: p.title });
  }
  const topKw = [...kwBest.entries()].sort((x, y) => y[1].volume - x[1].volume).slice(0, 10);
  const kwPosts = posts.filter((p) => p.keywords?.dfs?.length).length;

  const rows = posts.map((p) => {
    const f = perf.get(pathOf(p.url));
    const issues = a.issues.get(p.id) ?? [];
    return {
      published: p.published_date ?? "", title: p.title, title_href: `/blog/${p.id}`, words: p.word_count, keyword: p.keywords?.target ?? "",
      area: p.geo?.neighborhood ?? "", zip: p.geo?.zip ?? "", crossings: p.geo?.road_crossings.length ?? 0, landmarks: p.geo?.landmarks.length ?? 0,
      places: [...(p.geo?.road_crossings ?? []), ...(p.geo?.landmarks ?? [])].join("; "),
      map: !p.map ? "none" : p.map.matches_profile ? "your profile" : p.map.matches_profile === false ? "other place" : "map",
      service: p.target_service?.title ?? "", suggested: p.target_service ? "" : p.suggested_service?.title ?? "",
      links_out: p.internal_links, links_in: a.inbound.get(pathOf(p.url))?.length ?? 0,
      clicks: f?.clicks ?? 0, impressions: f?.impressions ?? 0, position: f?.position ?? null, top_query: f?.top[0]?.query ?? "",
      dfs_kw: p.keywords?.dfs?.[0]?.keyword ?? "", dfs_volume: p.keywords?.dfs?.[0]?.volume ?? null, dfs_pos: p.keywords?.dfs?.[0]?.position ?? null, dfs_count: p.keywords?.dfs?.length ?? 0,
      issues: issues.length, month: p.published_date ? monthLabel(p.published_date.slice(0, 7), true) : "", read: p.url,
      this_month: Boolean(p.published_date?.startsWith(month)), no_service: !p.target_service, not_indexed: issues.includes("not_indexed"), orphan: issues.includes("orphan"),
    };
  });

  return (
    <>
      {header}
      <p className="mb-5 text-sm"><span className="font-semibold">{fmtInt(n)} posts</span><span className="text-muted"> · read {ago(blog.lastFetched)} from {source} · places and keywords read for {fmtInt(read)} of {fmtInt(n)} · refreshed daily</span></p>

      <section aria-label="Blog summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-8">
        <StatCard label="Posts" value={fmtInt(n)} sub={`${fmtInt(a.areas.length)} neighbourhoods`} />
        <StatCard label={`Released in ${monthLabel(month)}`} value={fmtInt(thisMonth.length)} sub={`${lastMonthCount} in ${monthLabel(prevMonth)}`} tone={thisMonth.length ? "good" : undefined} />
        <StatCard label="Average words" value={fmtInt(avgWords)} sub={`${has("thin")} under 600`} />
        <StatCard label="Featured image" value={`${pct(withImage)}%`} sub={noAlt ? `${noAlt} without alt text` : "all with alt text"} />
        <StatCard label="Map to your profile" value={`${pct(toProfile)}%`} sub={`${pct(withMap)}% have a map`} tone={toProfile === n ? "good" : toProfile < withMap ? "bad" : undefined} />
        <StatCard label="Link a service page" value={`${pct(withService)}%`} sub={`${fmtInt(n - withService)} posts don't`} tone={pct(withService) >= 70 ? "good" : "bad"} />
        <StatCard label="Clicks from Google" value={gscOn ? fmtInt(totals.clicks) : "—"} sub={gscOn ? `${fmtInt(totals.impressions)} impressions · selected period` : "Search Console not connected"} />
        <StatCard label="Blog page views" value={fmtInt(totals.views)} sub="GA4 · selected period" />
      </section>
      {picks.length > 0 && <div className="mt-6"><Highlights items={picks} /></div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><Columns title="Posts released per month" sub="Last 12 months, by publish date" valueLabel="Posts"
          bins={a.monthly.map((m) => ({ label: monthLabel(m.month), value: m.count, highlight: m.month === month }))} /></div>
        {/* this month's posts; before the first one of the month, the latest posts instead */}
        <Panel title={thisMonth.length ? `Released in ${monthLabel(month, true)}` : "Latest posts"}
          sub={thisMonth.length ? `${thisMonth.length} post${thisMonth.length === 1 ? "" : "s"}` : `None yet in ${monthLabel(month)}`}>
          {(
            <ul className="space-y-2.5 text-[13px]">
              {(thisMonth.length ? thisMonth : posts.filter((p) => p.published_date)).slice(0, 5).map((p) => (
                <li key={p.id} className="min-w-0">
                  <Link href={`/blog/${p.id}`} className="line-clamp-1 font-medium hover:underline" title={p.title}>{p.title}</Link>
                  <p className="text-xs text-muted">{day(p.published_date)} · {fmtInt(p.word_count)} words{p.geo?.neighborhood ? ` · ${p.geo.neighborhood}` : ""}</p>
                </li>
              ))}
              {thisMonth.length > 5 && <li className="text-xs text-muted">and {thisMonth.length - 5} more in the table below</li>}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <BarList title="Issues to fix" valueLabel="Posts" emptyText="No issues found."
          items={issueRows.map((x) => ({ label: ISSUES[x.k].label, value: x.value, detail: `${pct(x.value)}%` }))} />
        {a.services.length > 0
          ? <BarList title="Service pages the posts link to" valueLabel="Posts" items={unique(a.services.slice(0, 10).map((s) => ({ label: s.title, url: s.url, value: s.count })))} />
          : <BarList title="Service pages the posts should link to" valueLabel="Posts (suggested)" emptyText="No matching service pages found."
              items={unique(a.suggested.slice(0, 10).map((s) => ({ label: s.title, url: s.url, value: s.count })))} />}
        <BarList title="Neighbourhoods covered" valueLabel="Posts" emptyText="No neighbourhood found yet."
          items={a.areas.slice(0, 10).map((x) => ({ label: x.name, value: x.count }))} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {center ? <GeoSpread title="Where the posts target" sub={`${pts.length} neighbourhoods around ${center.label}`} center={center} points={pts} />
            : <Panel title="Where the posts target"><p className="text-sm text-muted">No post links a map with coordinates yet.</p></Panel>}
        </div>
        <Panel title="Roads and landmarks named" sub={`${crossings.length} road crossings · ${landmarks.length} landmarks`}>
          <div className="space-y-4 text-[13px]">
            {([["Road crossings", crossings], ["Landmarks", landmarks]] as const).map(([label, list]) => (
              <div key={label}>
                <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
                {list.length === 0 ? <p className="text-muted">{read ? "None named." : "Read after the next run."}</p> : (
                  <ul className="flex flex-wrap gap-1.5">
                    {list.slice(0, 8).map((x) => <li key={x.label} className="rounded-md bg-surface-muted px-2 py-1">{x.label}{x.value > 1 && <span className="text-muted"> ×{x.value}</span>}</li>)}
                    {list.length > 8 && <li className="px-1 py-1 text-xs text-muted">+{list.length - 8} more (table and post pages)</li>}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <BarList title="Biggest keywords the blog ranks for" valueLabel="Monthly searches (DataForSEO)"
          emptyText={kwPosts ? "No search volume yet." : "Matched daily from the DataForSEO keyword data, or fetch it per post from the DataForSEO menu."}
          items={topKw.map(([k, x]) => ({ label: `${k} · #${x.position ?? "—"}`, value: x.volume }))} />
        <BarList title="Posts with the most clicks" valueLabel="Clicks · selected period" emptyText={gscOn ? "No post had clicks or impressions in this period." : "Connect Search Console to see clicks per post."}
          items={unique(topClicks.map(({ p, f }) => ({ label: p.title, url: p.url, value: f!.clicks, detail: `${fmtInt(f!.impressions)} impr` })))} />
        <Columns title="Post length" sub="Words per post (600+ recommended)" valueLabel="Posts"
          bins={bins.map(([lo, hi, label]) => ({ label, value: posts.filter((p) => p.word_count >= lo && p.word_count < hi).length, highlight: lo >= 600 }))} />
      </div>

      <div className="mt-6">
        <ResearchTable title="All posts" rows={rows} pageSize={25} csvName={`blog-posts-${client.name.replace(/[^\w-]+/g, "-")}`}
          searchKeys={["title", "keyword", "area", "places", "top_query", "dfs_kw", "service", "suggested"]} initialSort={{ key: "published", dir: "desc" }}
          facets={[{ key: "month", label: "Month" }, { key: "map", label: "Map" }, { key: "area", label: "Neighbourhood" }]}
          presets={[
            { label: `Released in ${monthLabel(month)}`, where: [{ key: "this_month", op: "true" }] },
            { label: "No service-page link", where: [{ key: "no_service", op: "true" }] },
            { label: "No Google impressions", where: [{ key: "not_indexed", op: "true" }] },
            { label: "Under 600 words", where: [{ key: "words", op: "lte", value: 599 }] },
            { label: "No other post links here", where: [{ key: "orphan", op: "true" }] },
          ]}
          columns={[
            { key: "published", label: "Published", type: "date" }, { key: "title", label: "Post", type: "link" }, { key: "words", label: "Words", type: "int" },
            { key: "keyword", label: "Target keyword" }, { key: "area", label: "Neighbourhood" }, { key: "zip", label: "ZIP" },
            { key: "crossings", label: "Road crossings", type: "int" }, { key: "landmarks", label: "Landmarks", type: "int" }, { key: "map", label: "Map", type: "badge" },
            { key: "service", label: "Service page" }, { key: "suggested", label: "Suggested service page" },
            { key: "links_out", label: "Internal links", type: "int" }, { key: "links_in", label: "Links in", type: "int", hint: "Other posts that link to this one" },
            { key: "clicks", label: "Clicks", type: "int" }, { key: "impressions", label: "Impressions", type: "int" }, { key: "position", label: "Position", type: "dec" },
            { key: "top_query", label: "Top query" },
            { key: "dfs_kw", label: "Top keyword (DataForSEO)" }, { key: "dfs_volume", label: "Volume", type: "int" }, { key: "dfs_pos", label: "Rank", type: "int" }, { key: "dfs_count", label: "Ranking keywords", type: "int" },
            { key: "issues", label: "Issues", type: "int" }, { key: "read", label: "Read", type: "open" },
          ]} />
      </div>
    </>
  );
}
