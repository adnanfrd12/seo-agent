import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MetricTrend } from "@/components/charts/metric-trend";
import type { TrendPoint } from "@/components/charts/trend-chart";
import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtInt, fmtPercent } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { first, type SearchParams } from "@/lib/analytics/url";
import { loadCache } from "@/lib/dataforseo/research";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
type GscRow = { metric_date: string; page: string; clicks: number; impressions: number; position_x_impressions: number };
type BlogKw = { target?: string | null; secondary?: string[] | null; dfs?: { keyword?: string; position?: number | null; volume?: number | null }[] | null };

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Everything the stored data knows about one search keyword: which pages rank for it and where the ranking comes from. */
export default async function KeywordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 200);
  const header = (
    <TabHeader source="gsc" title={q ? `Keyword: ${q}` : "Keyword"} description="Which pages rank for this search, and where the ranking comes from: Search Console, DataForSEO rankings, rank tracking and blog posts targeting it." />
  );
  const back = (
    <Link href="/organic-keywords" className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Organic keywords
    </Link>
  );
  if (!q) return <>{back}{header}<EmptyState title="No keyword chosen" body="Click a keyword anywhere in the dashboard to see which pages rank for it." /></>;

  const range = resolveRange({ range: first(sp.range), start: first(sp.start), end: first(sp.end) }, client.timezone, client.defaultRangeDays);
  const supabase = await createClient();
  const key = norm(q);
  const variants = [...new Set([q, key])];

  const [gscRes, cache, rankKw, blogRes] = await Promise.all([
    supabase.from("gsc_query_page_metrics").select("metric_date, page, clicks, impressions, position_x_impressions")
      .eq("client_id", client.id).in("query", variants).gte("metric_date", range.start).lte("metric_date", range.end)
      .order("metric_date", { ascending: true }).limit(20000),
    loadCache(supabase, client.id).catch(() => null),
    supabase.from("rank_keywords").select("id, keyword, device").eq("client_id", client.id).ilike("keyword", q.replace(/[%_\\]/g, (m) => `\\${m}`)),
    supabase.from("blog_posts").select("id, url, title, keywords").eq("client_id", client.id).limit(2000),
  ]);

  /* ---------------------------------------------------------------- Search Console */
  const gsc = (gscRes.data ?? []) as GscRow[];
  const byPage = new Map<string, { clicks: number; impressions: number; pxi: number }>();
  const byDay = new Map<string, { clicks: number; impressions: number; pxi: number }>();
  for (const r of gsc) {
    for (const [m, k] of [[byPage, r.page], [byDay, r.metric_date]] as const) {
      const a = m.get(k) ?? { clicks: 0, impressions: 0, pxi: 0 };
      a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.pxi += num(r.position_x_impressions);
      m.set(k, a);
    }
  }
  const gscPages: Row[] = [...byPage.entries()].map(([page, a]) => ({
    page, clicks: a.clicks, impressions: a.impressions,
    ctr: a.impressions ? Math.round((a.clicks / a.impressions) * 1000) / 10 : null,
    position: a.impressions ? Math.round((a.pxi / a.impressions) * 10) / 10 : null,
  }));
  const tot = [...byPage.values()].reduce((x, a) => ({ clicks: x.clicks + a.clicks, impressions: x.impressions + a.impressions, pxi: x.pxi + a.pxi }), { clicks: 0, impressions: 0, pxi: 0 });
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dayPts = (f: (a: { clicks: number; impressions: number; pxi: number }) => number | null): TrendPoint[] => days.map(([date, a]) => ({ date, value: f(a) }));

  /* ---------------------------------------------------------------- DataForSEO ranked keywords */
  const ranked = ((cache?.get<Row[]>("ranked_keywords")?.data ?? []) as Row[]).filter((r) => norm(r.keyword) === key);
  const dfs = ranked[0];

  /* ---------------------------------------------------------------- rank tracking */
  const kws = (rankKw.data ?? []) as { id: string; keyword: string; device: string }[];
  const checks = kws.length
    ? ((await supabase.from("rank_checks").select("keyword_id, checked_on, position, url").in("keyword_id", kws.map((k) => k.id)).order("checked_on", { ascending: true }).limit(2000)).data ?? []) as { keyword_id: string; checked_on: string; position: number | null; url: string | null }[]
    : [];
  const rankOptions = kws.map((k) => ({
    key: k.id, label: kws.length > 1 ? `Position · ${k.device}` : "Position", format: "int" as const, reverseY: true,
    data: checks.filter((c) => c.keyword_id === k.id).map((c) => ({ date: c.checked_on, value: c.position })),
  }));
  const rankRows: Row[] = [...checks].reverse().map((c) => ({
    checked: c.checked_on, device: kws.find((k) => k.id === c.keyword_id)?.device ?? "", position: c.position, url: c.url,
  }));

  /* ---------------------------------------------------------------- blog posts targeting it */
  const blog: Row[] = [];
  for (const p of (blogRes.data ?? []) as { id: string; url: string; title: string; keywords: BlogKw | null }[]) {
    const k = p.keywords;
    if (!k) continue;
    const dfsHit = (k.dfs ?? []).find((d) => norm(d.keyword) === key);
    const how = norm(k.target) === key ? "Target keyword" : (k.secondary ?? []).some((s) => norm(s) === key) ? "Secondary keyword" : dfsHit ? "Ranks for it (DataForSEO)" : null;
    if (!how) continue;
    blog.push({ title: p.title || p.url, title_href: `/blog/${p.id}`, how, position: dfsHit?.position ?? null, url: p.url });
  }

  const nothing = gsc.length === 0 && ranked.length === 0 && kws.length === 0 && blog.length === 0;

  return (
    <>
      {back}
      {header}
      <section aria-label="Keyword summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clicks (Search Console)" value={fmtInt(tot.clicks)} sub={`${range.start} to ${range.end}`} />
        <StatCard label="Impressions" value={fmtInt(tot.impressions)} sub={tot.impressions ? `CTR ${fmtPercent(tot.clicks / tot.impressions, 1)}` : "No impressions"} />
        <StatCard label="Avg position (Search Console)" value={tot.impressions ? fmtDecimal(tot.pxi / tot.impressions) : "—"} sub={`${fmtInt(byPage.size)} page${byPage.size === 1 ? "" : "s"} shown`} />
        <StatCard label="Google rank (DataForSEO)" value={dfs?.position != null ? `#${dfs.position}` : "—"}
          sub={dfs ? `${fmtInt(num(dfs.volume))} searches / mo · difficulty ${dfs.difficulty ?? "—"}` : "Not in the stored ranking list"} />
      </section>

      {nothing && (
        <div className="mt-6">
          <EmptyState title="No stored data for this keyword" body="Search Console has no clicks or impressions for it in the selected range, it isn't in the DataForSEO ranking list, isn't tracked and no blog post targets it." />
        </div>
      )}

      {days.length > 0 && (
        <div className="mt-6">
          <MetricTrend title="Search Console trend for this keyword" source="GSC" options={[
            { key: "clicks", label: "Clicks", data: dayPts((a) => a.clicks) },
            { key: "impressions", label: "Impressions", data: dayPts((a) => a.impressions) },
            { key: "position", label: "Avg position", format: "decimal", reverseY: true, data: dayPts((a) => (a.impressions ? a.pxi / a.impressions : null)) },
          ]} />
        </div>
      )}

      <div className="mt-6 space-y-6">
        {gsc.length > 0 && (
          <ResearchTable title="Pages Google shows for this search (Search Console)" rows={gscPages} searchKeys={["page"]} initialSort={{ key: "clicks", dir: "desc" }}
            csvName={`keyword-pages-${key.replace(/\W+/g, "-")}`}
            columns={[
              { key: "page", label: "Page", type: "url" }, { key: "clicks", label: "Clicks", type: "int" }, { key: "impressions", label: "Impressions", type: "int" },
              { key: "ctr", label: "CTR %", type: "dec" }, { key: "position", label: "Avg position", type: "dec" },
            ]}
            note="Web search, all devices and countries, for the selected date range. Several pages for one search can mean they compete with each other." />
        )}

        {ranked.length > 0 && (
          <ResearchTable title="Google ranking (DataForSEO)" rows={ranked} initialSort={{ key: "position", dir: "asc" }}
            columns={[
              { key: "url", label: "Ranking page", type: "url" }, { key: "position", label: "Position", type: "int" }, { key: "previous", label: "Change", type: "change" },
              { key: "volume", label: "Volume / mo", type: "int" }, { key: "difficulty", label: "Difficulty", type: "int" }, { key: "cpc", label: "CPC", type: "usd" },
              { key: "traffic", label: "Est. traffic", type: "dec" }, { key: "intent", label: "Intent", type: "badge" },
            ]}
            note={`From the stored DataForSEO ranked-keywords list${cache?.get("ranked_keywords")?.fetchedAt ? `, updated ${cache.get("ranked_keywords")!.fetchedAt.slice(0, 10)}` : ""}.`} />
        )}

        {kws.length > 0 && (
          <>
            {rankOptions.some((o) => o.data.length > 0) && <MetricTrend title="Rank tracking history" source="DFS" options={rankOptions} />}
            <ResearchTable title="Rank tracking checks" rows={rankRows} initialSort={{ key: "checked", dir: "desc" }}
              columns={[
                { key: "checked", label: "Checked", type: "date" }, { key: "device", label: "Device", type: "badge" },
                { key: "position", label: "Position", type: "int" }, { key: "url", label: "Ranking page", type: "url" },
              ]}
              note="From Rank Tracking. An empty position means the site was not found in the checked results." />
          </>
        )}

        {blog.length > 0 && (
          <ResearchTable title="Blog posts targeting this keyword" rows={blog} initialSort={{ key: "position", dir: "asc" }}
            columns={[
              { key: "title", label: "Post", type: "link" }, { key: "how", label: "Why", type: "badge" },
              { key: "position", label: "Rank", type: "int" }, { key: "url", label: "Open", type: "open" },
            ]} />
        )}
      </div>

      <p className="mt-6 text-xs text-muted">
        <a className="underline underline-offset-2 hover:text-foreground" href={`https://www.google.com/search?q=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer">Search Google for “{q}” ↗</a>
        {" · "}<Link className="underline underline-offset-2 hover:text-foreground" href="/rank-tracking">Rank tracking</Link>
        {" · "}<Link className="underline underline-offset-2 hover:text-foreground" href="/search-console">Search Console</Link>
      </p>
    </>
  );
}
