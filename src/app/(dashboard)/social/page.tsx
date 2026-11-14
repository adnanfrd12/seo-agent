import { after } from "next/server";
import { CircleAlert, CircleX, ExternalLink, Info, KeyRound, Link2Off } from "lucide-react";
import { ShareDonut, StackedTimeBars, CompareBars } from "@/components/charts/analytics-charts";
import { MultiLine } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { MetricTrend, type MetricOption } from "@/components/charts/metric-trend";
import { KpiCard, StatCard } from "@/components/dashboard/kpi-card";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { ConnectOne, SocialConnect, SocialRefresh, SocialSettings } from "@/components/research/social-controls";
import { resolveRange } from "@/lib/analytics/range";
import { researchPage } from "@/lib/dataforseo/view";
import { revalidatePath } from "@/lib/revalidate";
import { composioReady, setupNote, socialConnections, type SocialConnection } from "@/lib/social/composio";
import { clientSocial, loadSocial, refreshSocial, tokenState, type SocialRow } from "@/lib/social/fetch";
import { METRICS, postEngagement, type MetricKey } from "@/lib/social/metrics";
import { combine, dailyMetrics, staleConnected, figures, followerSeries, platformColor, previousOf, seriesBy, withPrevious, type Period, type PlatformFigures } from "@/lib/social/overview";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "@/lib/social/platforms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300; // a manual refresh reads up to 8 platforms

const nf = (v: number | null | undefined, compact = true) => (v == null ? "—" : Intl.NumberFormat("en-US", { notation: compact && Math.abs(v) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v));
const signed = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${nf(v)}`);
const fmtMetric = (k: MetricKey, v: number | null | undefined) => (v == null ? "—" : METRICS[k].format === "percent" ? `${v.toFixed(2)}%` : METRICS[k].format === "minutes" ? `${nf(Math.round(v))} min` : nf(v));
const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const STALE_MS = 12 * 60 * 60 * 1000;

type Sp = { connected?: string; connect_error?: string; range?: string; start?: string; end?: string };

export default async function SocialPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit } = page;
  const supabase = await createClient();
  const [rows, social] = await Promise.all([loadSocial(supabase, client.id), clientSocial(createAdminClient(), client.id)]);
  const tokens = tokenState(social.tokens);
  let conns: SocialConnection[] = [];
  try { conns = await socialConnections(client.id); } catch { /* Composio unreachable: buttons still shown */ }
  const active = new Set(conns.filter((c) => c.status === "ACTIVE").map((c) => c.platform));

  // connected accounts refresh themselves: a stale one is read in the background after this page is sent
  const stale = staleConnected(rows, active, STALE_MS);
  if (stale.length) after(async () => {
    try { await refreshSocial({ admin: createAdminClient(), clientId: client.id, source: "auto" }, stale); revalidatePath("/social"); } catch { /* next view or the daily run */ }
  });

  const range = resolveRange({ range: sp.range ?? (sp.start ? undefined : "30"), start: sp.start, end: sp.end }, client.timezone, client.defaultRangeDays);
  const cur: Period = { start: range.start, end: range.end };
  const prev = previousOf(cur);
  const all = PLATFORMS.filter((p) => rows[p]).map((p) => figures(rows[p]!, active.has(p), cur, prev));
  const withData = all.filter((f) => f.row.status === "ok" || f.row.history.length > 0);

  const connectRows = PLATFORMS.map((p) => {
    const c = conns.find((x) => x.platform === p);
    return { platform: p, state: c?.status === "ACTIVE" ? "connected" as const : c ? "pending" as const : "none" as const, ready: composioReady(p), note: composioReady(p) ? null : setupNote(p) };
  });

  // combined figures (only what can be added up)
  const followers = combine(withData, (f) => f.followers, (f) => f.followersPrev);
  const growth = combine(withData, (f) => f.growth, (f) => f.growthPrev);
  const views = combine(withData, (f) => f.views, (f) => f.viewsPrev);
  const eng = combine(withData, (f) => f.engagement, (f) => f.engagementPrev);
  const posts = combine(withData.filter((f) => f.row.posts.length), (f) => f.posts, (f) => f.postsPrev);
  const perPost = posts.value ? (eng.value ?? 0) / posts.value : null;

  const followerLines = withData.map((f) => ({ key: f.platform, label: f.label, color: platformColor(f.platform), data: followerSeries(f.row).filter((x) => x.date >= cur.start && x.date <= cur.end) })).filter((s) => s.data.length);
  const viewSeries = seriesBy(withData, (f) => (f.viewsMetric ? f.row.series?.[f.viewsMetric] : undefined), cur);
  const viewDates = [...new Set(viewSeries.flatMap((s) => s.data.map((d) => d.date)))].sort();
  const viewData = viewDates.map((date) => ({ date, ...Object.fromEntries(viewSeries.map((s) => [s.f.platform, s.data.find((d) => d.date === date)?.value ?? null])) }));
  const allPosts = withData.flatMap((f) => f.postsIn.map((x) => ({ platform: f.label, title: x.title || "(no text)", url: x.url, date: x.date, views: x.views, likes: x.likes, comments: x.comments, shares: x.shares, engagement: postEngagement(x) })));
  const compareRows = withData.map((f) => ({
    platform: f.label, status: f.connected ? "Connected" : f.mode === "public" ? "Public numbers" : f.row.status === "ok" ? "Read" : "Not connected",
    followers: f.followers, growth: f.growth, views: f.views, engagement: f.engagement, posts: f.row.posts.length ? f.posts : null,
    per_post: f.posts ? Math.round(((f.engagement ?? 0) / f.posts) * 10) / 10 : null, reach: f.row.totals?.reach ?? null,
  }));
  const periodText = `${dateLabel(cur.start)} – ${dateLabel(cur.end)}`;
  const inc = (x: { platforms: string[] }) => (x.platforms.length ? `Includes ${x.platforms.join(", ")}.` : "No platform reports this yet.");

  return (
    <>
      <TabHeader source={null} eyebrow="Social media" title="Social" description="Combined performance across every connected social account first, then each platform in detail: audience, reach, views, engagement and content." guide={[
        { term: "Sources", text: "Connected accounts are read through Composio from each platform's official API (read-only) and refresh automatically every day. Accounts that aren't connected show public numbers only, or what an older token setup provides. Nothing is estimated." },
        { term: "Combined totals", text: "Only counts that can be added up are combined: followers, follower growth, views and impressions, engagement and posts. Reach counts unique people, who may overlap between days and platforms, so it is shown per platform only." },
        { term: "Previous period", text: "The same number of days just before the selected range. It is shown only when the stored data covers that period." },
        { term: "Engagement", text: "Daily interactions where the platform reports them per day (Facebook, LinkedIn, Pinterest, YouTube); otherwise the likes, comments and shares on posts published in the period." },
      ]} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted">{periodText} · compared with {dateLabel(prev.start)} – {dateLabel(prev.end)} · connected accounts refresh daily</p>
        <SocialRefresh canEdit={canEdit} />
      </div>
      {sp.connected && canEdit && !sp.connect_error && <p role="status" className="mb-4 rounded-lg border border-positive/40 bg-positive/10 px-3 py-2 text-sm">{PLATFORM_INFO[sp.connected as Platform]?.label ?? "The account"} is connected and its analytics were read.</p>}
      {sp.connect_error && canEdit && <p role="alert" className="mb-4 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-sm">{sp.connect_error.slice(0, 300)}</p>}

      {/* ---------------------------------------------------------------- combined overview */}
      <section aria-labelledby="all-platforms" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="all-platforms" className="text-lg font-semibold tracking-tight">All platforms</h2>
            <p className="text-xs text-muted">{active.size} connected · {withData.length} with data · {periodText}</p>
          </div>
        </div>
        {withData.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-border bg-surface px-6 py-10 text-center">
            <p className="text-sm font-medium">No social analytics yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">Connect an account below. Its analytics appear here and in its own section as soon as the login finishes.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              <KpiCard label="Total followers" source="Platforms" hint={`Followers added up across platforms at the end of the period (a person who follows on two platforms counts twice). ${inc(followers)}`} value={followers.value} previous={followers.previous} format={(v) => nf(v)} />
              <KpiCard label="Follower growth" source="Platforms" hint={`Net followers gained in the period. ${inc(growth)}`} value={growth.value} previous={growth.previous} format={signed} />
              <KpiCard label="Views & impressions" source="Platforms" hint={`Each platform's own content-views measure, added up: Facebook and Threads views, LinkedIn and Pinterest impressions, YouTube video views. ${inc(views)}`} value={views.value} previous={views.previous} format={(v) => nf(v)} />
              <KpiCard label="Engagement" source="Platforms" hint={`Interactions in the period. ${inc(eng)}`} value={eng.value} previous={eng.previous} format={(v) => nf(v)} />
              <KpiCard label="Posts published" source="Platforms" hint={`Posts, videos and pins published in the period, among those the platforms returned. ${inc(posts)}`} value={posts.value} previous={posts.previous} format={(v) => nf(v)} />
              <KpiCard label="Engagement per post" source="Platforms" hint="Engagement divided by posts published in the period." value={perPost} format={(v) => (v == null ? "—" : v.toFixed(1))} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <MultiLine title="Audience growth" sub="Followers per platform over the period (daily where the platform reports it, else at each refresh)" metrics={[{ key: "followers", label: "Followers", series: followerLines }]} />
              <ShareDonut title="Audience by platform" sub="Share of total followers" items={withData.filter((f) => f.followers).map((f) => ({ label: f.label, value: f.followers! }))} centerLabel="followers" top={8} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <StackedTimeBars title="Views & impressions by platform" sub="Daily, from platforms that report a daily figure" keys={viewSeries.map((s) => ({ key: s.f.platform, label: s.f.label }))} data={viewData} valueLabel="Views / impressions" bucket={viewDates.length > 45 ? "week" : "day"} />
              <CompareBars title="Engagement by platform" sub="This period against the previous one" valueLabel="Interactions" rows={withData.filter((f) => f.engagement != null).map((f) => ({ label: f.label, current: f.engagement!, previous: f.engagementPrev }))} empty="No engagement data yet." />
            </div>

            <ResearchTable title="Platform comparison" rows={compareRows as unknown as Record<string, unknown>[]} csvName={`social-platforms-${client.id}`}
              columns={[{ key: "platform", label: "Platform" }, { key: "status", label: "Data", type: "badge" }, { key: "followers", label: "Followers", type: "int" }, { key: "growth", label: "Growth", type: "int" }, { key: "views", label: "Views / impr.", type: "int" }, { key: "engagement", label: "Engagement", type: "int" }, { key: "posts", label: "Posts", type: "int" }, { key: "per_post", label: "Eng. / post", type: "int" }, { key: "reach", label: "Reach (28 days)", type: "int" }]}
              initialSort={{ key: "followers", dir: "desc" }} empty="No platform data yet." />

            <ResearchTable title="Top content across platforms" rows={allPosts as unknown as Record<string, unknown>[]} searchKeys={["title"]} csvName={`social-posts-${client.id}`}
              columns={[{ key: "platform", label: "Platform", type: "badge" }, { key: "title", label: "Post / video" }, { key: "date", label: "Date", type: "date" }, { key: "views", label: "Views", type: "int" }, { key: "likes", label: "Likes", type: "int" }, { key: "comments", label: "Comments", type: "int" }, { key: "shares", label: "Shares", type: "int" }, { key: "engagement", label: "Engagement", type: "int" }, { key: "url", label: "Open", type: "open" }]}
              facets={[{ key: "platform", label: "Platform" }]} initialSort={{ key: "engagement", dir: "desc" }}
              empty="No posts published in this period among those the platforms returned." />
          </>
        )}
      </section>

      <div className="mt-6"><SocialConnect canEdit={canEdit} rows={connectRows} /></div>

      {/* ---------------------------------------------------------------- per platform */}
      <section aria-labelledby="by-platform" className="mt-8">
        <h2 id="by-platform" className="text-lg font-semibold tracking-tight">By platform</h2>
        <nav aria-label="Platforms" className="sticky top-0 z-10 -mx-1 mt-2 flex gap-1.5 overflow-x-auto bg-background/90 px-1 py-2 backdrop-blur">
          {PLATFORMS.map((p) => (
            <a key={p} href={`#social-${p}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-surface-muted">
              <span className="size-2 rounded-full" style={{ background: active.has(p) ? platformColor(p) : "var(--border-strong)" }} aria-hidden />{PLATFORM_INFO[p].label}
            </a>
          ))}
        </nav>
        <div className="mt-3 space-y-6">
          {PLATFORMS.map((p) => {
            const f = all.find((x) => x.platform === p);
            return <PlatformSection key={p} p={p} f={f} row={rows[p]} url={social.profiles[p]} connected={active.has(p)} ready={composioReady(p)} canEdit={canEdit}
              token={tokens[p]} cur={cur} prev={prev} clientId={client.id} />;
          })}
        </div>
      </section>

      {canEdit && <div className="mt-8"><SocialSettings profiles={social.profiles} tokens={tokens} linkedinOrgId={typeof social.settings.linkedin_org_id === "string" ? social.settings.linkedin_org_id : null} /></div>}
    </>
  );
}

/* ------------------------------------------------------------------ one platform */
function PlatformSection({ p, f, row, url, connected, ready, canEdit, token, cur, prev, clientId }: {
  p: Platform; f: PlatformFigures | undefined; row: SocialRow | undefined; url: string | undefined; connected: boolean; ready: boolean; canEdit: boolean;
  token: "client" | "env" | null; cur: Period; prev: Period; clientId: string;
}) {
  const info = PLATFORM_INFO[p];
  const hasData = Boolean(row && (row.status === "ok" || row.history.length > 0));
  const badge = connected ? <span className="rounded-md bg-positive/15 px-1.5 py-0.5 text-[11px] font-medium text-positive">Connected</span>
    : row?.mode === "public" ? <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-secondary">Public numbers</span>
    : <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted">Not connected</span>;

  const metrics = row ? dailyMetrics(row) : [];
  const fs = row ? followerSeries(row) : [];
  const trendOptions: MetricOption[] = [
    ...(fs.length >= 2 ? [{ key: "followers", label: "Followers", data: withPrevious(fs, cur, prev) }] : []),
    ...metrics.filter((k) => k !== "followers").map((k) => ({ key: k, label: METRICS[k].label, data: withPrevious(row!.series![k]!, cur, prev) })),
  ].filter((o) => o.data.length >= 2);

  // KPI tiles: followers, then each daily count summed over the period, then the platform's 28-day totals
  const tiles: { label: string; value: string; sub?: string; tone?: "good" | "bad" }[] = [];
  if (f && hasData) {
    tiles.push({ label: p === "youtube" ? "Subscribers" : "Followers", value: nf(f.followers), sub: f.growth != null ? `${signed(f.growth)} in period` : row?.profile.following != null ? `Following ${nf(row.profile.following)}` : undefined, tone: f.growth == null || f.growth === 0 ? undefined : f.growth > 0 ? "good" : "bad" });
    for (const k of metrics.filter((m) => METRICS[m].additive && m !== "unfollows")) {
      const s = row!.series![k]!; const v = s.filter((x) => x.date >= cur.start && x.date <= cur.end).reduce((a, x) => a + x.value, 0);
      const pv = s.length && s[0].date <= prev.start ? s.filter((x) => x.date >= prev.start && x.date <= prev.end).reduce((a, x) => a + x.value, 0) : null;
      tiles.push({ label: METRICS[k].label, value: fmtMetric(k, v), sub: pv != null && pv > 0 ? `${v >= pv ? "▲" : "▼"} ${Math.abs(((v - pv) / pv) * 100).toFixed(1)}% vs previous` : "In period" });
    }
    for (const [k, v] of Object.entries(row!.totals ?? {}) as [MetricKey, number][]) {
      if (metrics.includes(k) && METRICS[k].additive) continue;
      tiles.push({ label: METRICS[k]?.label ?? k, value: fmtMetric(k, v), sub: ["lifetime_likes", "lifetime_views", "monthly_views"].includes(k) ? "All time" : p === "linkedin" && k !== "reach" ? "All time" : "Last 28 days" });
    }
    if (row!.posts.length) tiles.push({ label: p === "youtube" || p === "tiktok" ? "Videos in period" : p === "pinterest" ? "Pins in period" : "Posts in period", value: nf(f.posts), sub: f.posts ? `${(f.postsIn.reduce((a, x) => a + postEngagement(x), 0) / f.posts).toFixed(1)} engagement per post` : undefined });
    else if (row!.profile.posts != null) tiles.push({ label: p === "youtube" || p === "tiktok" ? "Videos" : "Posts", value: nf(row!.profile.posts), sub: "All time" });
    if (!metrics.length && !Object.keys(row!.totals ?? {}).length && row!.profile.views != null) tiles.push({ label: "Views", value: nf(row!.profile.views), sub: "Latest read" });
  }
  const postsShown = row ? (f?.postsIn.length ? f.postsIn : row.posts) : [];

  return (
    <section id={`social-${p}`} aria-label={info.label} className="scroll-mt-16 rounded-[12px] border border-border bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: platformColor(p) }} aria-hidden />
            <h3 className="text-[15px] font-semibold">{info.label}</h3>{badge}
            {row?.profile.name && <span className="text-xs text-muted">{row.profile.name}</span>}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            {url && <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">{url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}<ExternalLink className="size-3" aria-hidden /></a>}
            {row?.source && <span>{row.source}</span>}
            {row && <span>Read {dateLabel(row.fetchedAt.slice(0, 10))}</span>}
          </p>
        </div>
        {canEdit && ready && (hasData || connected) && <ConnectOne platform={p} label={connected ? "Reconnect" : "Connect"} />}
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        {row?.status === "needs" && (connected || !ready) && <Notice icon={<KeyRound className="size-3.5" />} tone="warn">{row.needs}</Notice>}
        {row?.status === "error" && <Notice icon={<CircleX className="size-3.5" />} tone="bad">{row.error}{hasData ? " The figures below are from the last successful read." : ""}</Notice>}

        {!hasData ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium">{connected ? "Connected. Reading the analytics…" : `${info.label} isn't connected`}</p>
            <p className="mx-auto mt-1 max-w-lg text-xs text-muted">
              {connected ? "The first read runs in the background and appears here within a minute or two (reload the page)."
                : ready ? `Connect the ${info.label} account to see followers, reach, views, engagement${p === "instagram" || p === "youtube" || p === "threads" ? ", audience demographics" : ""} and post performance.`
                : setupNote(p)}
            </p>
            {canEdit && ready && !connected && <div className="mt-3 flex justify-center"><ConnectOne platform={p} /></div>}
            {!url && !connected && <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-faint"><Link2Off className="size-3" />No profile link saved{token ? " · a token is set" : ""}</p>}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              {tiles.slice(0, 12).map((t) => <StatCard key={t.label} label={t.label} value={t.value} sub={t.sub} tone={t.tone} />)}
            </div>
            {trendOptions.length > 0 ? <MetricTrend title={`${info.label} over time`} source={connected ? "Composio" : undefined} options={trendOptions} />
              : <Notice icon={<Info className="size-3.5" />} tone="muted">{connected ? `${info.label} doesn't provide a daily breakdown through its API; the trend builds from the daily snapshots this dashboard stores.` : "The trend appears after the second snapshot."}</Notice>}
            {(row!.demographics?.length ?? 0) > 0 && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {row!.demographics!.map((d) => <BarList key={d.dimension} title={d.dimension} valueLabel={d.dimension.includes("%") ? "%" : "Count"} items={d.items.map((i) => ({ label: i.label, value: i.value }))} limit={6} />)}
              </div>
            )}
            {postsShown.length > 0 && (
              <ResearchTable title={f?.postsIn.length ? `${info.label} content in this period` : `Latest ${info.label} content`} csvName={`social-${p}-${clientId}`} searchKeys={["title"]}
                rows={postsShown.map((x) => ({ ...x, title: x.title || "(no text)", engagement: postEngagement(x) })) as unknown as Record<string, unknown>[]}
                columns={[{ key: "title", label: p === "youtube" || p === "tiktok" ? "Video" : p === "pinterest" ? "Pin" : "Post" }, { key: "type", label: "Type", type: "badge" }, { key: "date", label: "Date", type: "date" }, { key: "views", label: p === "pinterest" ? "Impressions" : "Views", type: "int" }, { key: "likes", label: p === "pinterest" ? "Saves" : "Likes", type: "int" }, { key: "comments", label: "Comments", type: "int" }, { key: "shares", label: p === "pinterest" ? "Clicks" : "Shares", type: "int" }, { key: "engagement", label: "Engagement", type: "int" }, { key: "url", label: "Open", type: "open" }]}
                initialSort={{ key: "engagement", dir: "desc" }} empty="No content." />
            )}
            {p === "youtube" && (row!.rankings?.length ?? 0) > 0 && (
              <ResearchTable title="YouTube search rankings for tracked keywords" rows={row!.rankings!.map((r) => ({ ...r, found: r.position != null ? "Ranks" : "Not in results", in: r.total })) as unknown as Record<string, unknown>[]} csvName={`youtube-rankings-${clientId}`}
                columns={[{ key: "keyword", label: "Keyword", type: "keyword" }, { key: "position", label: "Position", type: "int" }, { key: "found", label: "Status", type: "badge" }, { key: "title", label: "Best video" }, { key: "url", label: "Video", type: "url" }, { key: "in", label: "Videos checked", type: "int" }]}
                initialSort={{ key: "position", dir: "asc" }} empty="No rankings yet." />
            )}
            {(row!.notes?.length ?? 0) > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer select-none">Metrics not available for this account ({row!.notes!.length})</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">{row!.notes!.map((n) => <li key={n}>{n}</li>)}</ul>
              </details>
            )}
            {!connected && row?.mode !== "public" && ready && <Notice icon={<CircleAlert className="size-3.5" />} tone="muted">Connect {info.label} to add reach, views, engagement and demographics from the platform itself.</Notice>}
          </>
        )}
      </div>
    </section>
  );
}

function Notice({ icon, tone, children }: { icon: React.ReactNode; tone: "warn" | "bad" | "muted"; children: React.ReactNode }) {
  return <p className={`flex gap-1.5 text-xs ${tone === "warn" ? "text-warn" : tone === "bad" ? "text-negative" : "text-muted"}`}><span className="mt-0.5 shrink-0">{icon}</span><span>{children}</span></p>;
}
