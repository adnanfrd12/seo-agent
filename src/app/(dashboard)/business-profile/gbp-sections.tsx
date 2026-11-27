import type { SupabaseClient } from "@supabase/supabase-js";
import { Star } from "lucide-react";
import { ShareDonut } from "@/components/charts/analytics-charts";
import { MetricTrend } from "@/components/charts/metric-trend";
import { TrendChart, type TrendPoint } from "@/components/charts/trend-chart";
import { BusinessInfo } from "@/components/gbp/business-info";
import { KeywordTrends, type KeywordTrendRow } from "@/components/gbp/keyword-trends";
import { PostsGrid, type PostItem } from "@/components/gbp/posts-grid";
import { ReviewsPanel, type ReviewItem } from "@/components/gbp/reviews-panel";
import { fmtInt, fmtPercent } from "@/lib/analytics/format";
import { shiftDays } from "@/lib/analytics/range";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { allRows, bizInfo, derived, keywordTrends, loadDaily, type DailyCol, type DayTotals, type GbpResource } from "@/lib/google/gbp-view";
import { estimateCost, loadVolumes, normKw, staleKeywords } from "@/lib/google/keyword-volume";

const card = "rounded-[10px] border border-border bg-surface p-4";
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

type Review = {
  id: string; resource_id: string; rating: number | null; text: string | null; reviewer_name: string | null; reviewer_photo_url: string | null;
  reply_text: string | null; replied_at: string | null; reply_state?: string | null; reviewed_at: string | null; source?: string | null;
};
type Post = {
  id: string; summary: string | null; topic_type: string | null; state: string | null; posted_at: string | null; cta_type: string | null; cta_url: string | null;
  search_url: string | null; media: { url: string | null; thumbnail: string | null }[] | null; metrics: Record<string, number> | null;
  event: { title?: string } | null; offer: { couponCode?: string; redeemOnlineUrl?: string } | null;
};

const REVIEW_COLS = "id, resource_id, rating, text, reviewer_name, reviewer_photo_url, reply_text, replied_at, reviewed_at";
/** Reviews of these resources; the reply state / source columns come with migration 20261128000033. */
async function loadReviews(supabase: SupabaseClient, ids: string[]) {
  const q = (cols: string) => allRows<Review>((a, b) => supabase.from("gbp_reviews").select(cols).in("resource_id", ids)
    .order("reviewed_at", { ascending: false, nullsFirst: false }).range(a, b) as unknown as PromiseLike<{ data: Review[] | null; error: unknown }>, 10000);
  const full = await q(`${REVIEW_COLS}, reply_state, source`);
  return full.length ? full : q(REVIEW_COLS);
}

/**
 * Everything the direct Google API adds to the Business Profile page, read from ONE source per location (Google when
 * it has fresh data, else Local Brand Manager): a chart per metric, how customers find the profile and on which
 * devices, business information, posts, reviews with replies, and keyword trends with search volume.
 */
export async function GbpSections({ supabase, clientId, resources, range, compare, canEdit, replyBlocked }: {
  supabase: SupabaseClient; clientId: string; resources: GbpResource[]; range: { start: string; end: string }; compare: boolean;
  canEdit: boolean; replyBlocked: string | null;
}) {
  const ids = resources.map((r) => r.id);
  if (!ids.length) return null;
  const len = days(range.start, range.end);
  const prevStart = shiftDays(range.start, -len), prevEnd = shiftDays(range.start, -1);
  const names = new Map(resources.map((r) => [r.id, r.display_name]));

  const [daily, prevDaily, rv, ps, kwRows, volumes, dfsPosts] = await Promise.all([
    loadDaily(supabase, ids, range.start, range.end),
    compare ? loadDaily(supabase, ids, prevStart, prevEnd) : Promise.resolve(new Map<string, DayTotals>()),
    loadReviews(supabase, ids),
    supabase.from("gbp_posts").select("id, summary, topic_type, state, posted_at, cta_type, cta_url, search_url, media, metrics, event, offer")
      .in("resource_id", ids).order("posted_at", { ascending: false, nullsFirst: false }).limit(1000),
    allRows<{ month: string; keyword: string; impressions: number | null; impressions_threshold: number | null }>((a, b) =>
      supabase.from("gbp_keyword_metrics").select("month, keyword, impressions, impressions_threshold").in("resource_id", ids).order("month").range(a, b), 50000),
    loadVolumes(supabase, clientId),
    supabase.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "gbp_posts").eq("params_hash", "self").maybeSingle(),
  ]);

  /* ------------------------------------------------------------ per-metric series */
  const lastDay = [...daily.keys()].sort().pop() ?? null;
  const end = lastDay && lastDay < range.end ? lastDay : range.end;
  const dates: string[] = [];
  for (let d = range.start; d <= end && dates.length < 800; d = shiftDays(d, 1)) dates.push(d);
  const reported = (k: DailyCol) => [...daily.values()].some((t) => t[k] != null);
  const value = (t: DayTotals | undefined, k: string) => (k in derived(t) ? derived(t)[k as keyof ReturnType<typeof derived>] : t?.[k as DailyCol] ?? 0);
  const series = (k: string): TrendPoint[] => dates.map((d, i) => ({
    date: d, value: value(daily.get(d), k), previous: compare ? value(prevDaily.get(shiftDays(prevStart, i)), k) : null,
  }));
  const sum = (k: string) => [...daily.values()].reduce((a, t) => a + Number(value(t, k)), 0);
  const charts = ([
    ["website_clicks", "Website clicks"], ["call_clicks", "Call button clicks"], ["direction_requests", "Direction requests"],
    ["conversations", "Chat conversations"], ["messaging_clicks", "Messaging clicks"], ["bookings", "Bookings"],
    ["food_orders", "Food orders"], ["food_menu_clicks", "Menu clicks"],
  ] as [DailyCol, string][]).filter(([k]) => ["website_clicks", "call_clicks", "direction_requests"].includes(k) || reported(k));
  const maps = sum("impressions_maps"), search = sum("impressions_search"), desktop = sum("impressions_desktop"), mobile = sum("impressions_mobile");

  /* ------------------------------------------------------------ reviews */
  const reviews = rv;
  const rated = reviews.filter((r) => r.rating != null);
  const avg = rated.length ? rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length : null;
  const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: rated.filter((r) => r.rating === s).length }));
  const inRange = reviews.filter((r) => r.reviewed_at && r.reviewed_at.slice(0, 10) >= range.start && r.reviewed_at.slice(0, 10) <= range.end);
  const replied = reviews.filter((r) => r.reply_text).length;
  const reviewSource = reviews.some((r) => r.source === "google") ? "Google API" : "Local Brand Manager";
  const items: ReviewItem[] = reviews.map((r) => ({
    id: r.id, rating: r.rating, text: r.text, reviewer: r.reviewer_name, photo: r.reviewer_photo_url, reply: r.reply_text, repliedAt: r.replied_at,
    replyState: r.reply_state ?? null, reviewedAt: r.reviewed_at, location: resources.length > 1 ? names.get(r.resource_id) ?? null : null,
  }));

  /* ------------------------------------------------------------ posts (Google API, else DataForSEO's public copy) */
  const gPosts = (ps.error ? [] : ps.data ?? []) as Post[];
  const posts: PostItem[] = gPosts.map((p) => ({
    id: p.id, summary: p.summary, topic: p.topic_type, state: p.state, date: p.posted_at, image: p.media?.[0]?.url ?? p.media?.[0]?.thumbnail ?? null,
    ctaType: p.cta_type, ctaUrl: p.cta_url, searchUrl: p.search_url, metrics: p.metrics, mediaCount: p.media?.length ?? 0,
    event: p.event?.title ?? null, offer: p.offer?.couponCode ?? p.offer?.redeemOnlineUrl ?? null,
  }));
  let postSource = "Google API";
  if (!posts.length) {
    const d = dfsPosts.data?.data as { posts?: { date: string | null; type: string; text: string; image: string | null; cta: string | null; url: string | null; googleUrl: string | null }[] } | null;
    (d?.posts ?? []).forEach((p, i) => posts.push({
      id: `dfs-${i}`, summary: p.text, topic: p.type === "Offer" ? "OFFER" : "STANDARD", state: null, date: p.date, image: p.image, ctaType: p.cta, ctaUrl: p.url,
      searchUrl: p.googleUrl, metrics: null, mediaCount: p.image ? 1 : 0, event: null, offer: null,
    }));
    postSource = "public listing (DataForSEO)";
  }

  /* ------------------------------------------------------------ keywords */
  const kt = keywordTrends(kwRows);
  const missing = staleKeywords(kt.list.map((k) => k.keyword), volumes);
  const kwRowsOut: KeywordTrendRow[] = kt.list.map((k) => {
    const v = volumes.get(normKw(k.keyword));
    return {
      keyword: k.keyword, inPrevious: k.inPrevious, months: k.months.map((m) => ({ v: m.impressions, thr: m.threshold })),
      volume: v?.volume ?? null, volumeTrend: v?.trend ?? [], hasVolume: Boolean(v),
    };
  });

  const info = resources.length === 1 ? bizInfo(resources[0]) : null;

  return (
    <div className="mt-6 space-y-6">
      {daily.size > 0 && (
        <>
          <section aria-label="Metrics over time" className="grid gap-4 lg:grid-cols-2">
            <MetricTrend title="Profile views" source="GBP" options={[
              { key: "impressions", label: "All", data: series("impressions") },
              { key: "impressions_search", label: "Search", data: series("impressions_search") },
              { key: "impressions_maps", label: "Maps", data: series("impressions_maps") },
              { key: "impressions_mobile", label: "Mobile", data: series("impressions_mobile") },
              { key: "impressions_desktop", label: "Desktop", data: series("impressions_desktop") },
            ]} />
            {charts.map(([k, label]) => <TrendChart key={k} title={label} source="GBP" seriesLabel={label} data={series(k)} />)}
          </section>
          <section className="grid gap-4 lg:grid-cols-2" aria-label="How customers find you">
            <ShareDonut title="How customers find you" sub="Profile views by surface" centerLabel="views" keepOrder
              items={[{ label: "Google Search", value: search }, { label: "Google Maps", value: maps }]} />
            <ShareDonut title="Devices" sub="Profile views by device" centerLabel="views" keepOrder
              items={[{ label: "Mobile", value: mobile }, { label: "Desktop", value: desktop }]} />
          </section>
        </>
      )}

      {info && <BusinessInfo info={info} />}
      {!info && resources.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">{resources.map((r) => <BusinessInfo key={r.id} info={bizInfo(r)} />)}</div>
      )}

      <section className={card} aria-labelledby="posts-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="posts-h" className="text-base font-semibold">Posts</h2>
          <span className="text-xs text-muted">{posts.length ? `${fmtInt(posts.length)} posts · source: ${postSource}` : ""}</span>
        </div>
        {posts.length ? <PostsGrid posts={posts} /> : <p className="text-sm text-muted">No posts stored yet. They are imported with the direct Google connection.</p>}
      </section>

      <section className={card} aria-labelledby="reviews-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="reviews-h" className="text-base font-semibold">Google reviews</h2>
          <span className="text-xs text-muted">All reviews on record · source: {reviewSource}</span>
        </div>
        {reviews.length === 0 ? <p className="text-sm text-muted">No reviews stored yet.</p> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs font-medium text-muted">Average rating</p>
                <p className="mt-1 flex items-center gap-1 text-[26px] font-semibold tracking-[-0.02em]">{avg?.toFixed(2) ?? "—"} <Star className="size-5 fill-current text-warn" aria-hidden /></p></div>
              <div><p className="text-xs font-medium text-muted">Total reviews</p><p className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{fmtInt(reviews.length)}</p></div>
              <div><p className="text-xs font-medium text-muted">New in this period</p><p className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{fmtInt(inRange.length)}</p></div>
              <div><p className="text-xs font-medium text-muted">Owner reply rate</p><p className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{fmtPercent(replied / reviews.length, 0)}</p>
                <p className="text-xs text-muted">{fmtInt(reviews.length - replied)} not replied</p></div>
            </div>
            <ul className="my-4 max-w-md space-y-1.5 text-sm" aria-label="Rating distribution">
              {dist.map((d) => (
                <li key={d.s} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 tabular-nums">{d.s}★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full bg-warn" style={{ width: `${rated.length ? (d.n / rated.length) * 100 : 0}%` }} /></span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted">{d.n}</span>
                </li>
              ))}
            </ul>
            <ReviewsPanel reviews={items} canEdit={canEdit} replyBlocked={replyBlocked} />
          </>
        )}
      </section>

      {kt.list.length > 0 && (
        <section className={card} aria-labelledby="kw-trend-h">
          <h2 id="kw-trend-h" className="mb-1 text-base font-semibold">Search keywords: monthly trend and search volume</h2>
          <p className="mb-3 text-xs text-muted">{fmtInt(kt.list.length)} keywords over {kt.months.length} stored month{kt.months.length === 1 ? "" : "s"} · every month Google reported is kept</p>
          <KeywordTrends months={kt.months} rows={kwRowsOut} canEdit={canEdit} missing={missing} estimate={estimateCost(missing.length)} volumeAvailable={await dfsConfigured(clientId)} />
        </section>
      )}
    </div>
  );
}

