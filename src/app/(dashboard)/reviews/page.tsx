import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine } from "@/components/research/chrome";
import { ProfileLinksEditor, ReviewFeed, ReviewsRefresh } from "@/components/research/review-platform-controls";
import { cat } from "@/lib/charts/colors";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { FETCHABLE, loadPlatformReviews, PLATFORMS, refreshEstimate, type PlatformView } from "@/lib/reviews/platforms";
import { researchPage } from "@/lib/dataforseo/view";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const fmtRating = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

function months(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

function statusText(v: PlatformView) {
  if (v.access === "credentials") return v.url ? "Link saved · needs credentials to read reviews" : "Needs credentials";
  if (v.access === "none") return v.url ? "Link saved · no public API" : "No public API";
  if (v.status === "pending") return "Collecting…";
  if (v.status === "failed") return v.error ?? "Last collection failed";
  if (v.source === "live") return v.total === 0 || (v.total == null && !v.reviews.length) ? "No listing / no reviews found" : `Updated ${v.fetchedAt?.slice(0, 10) ?? ""}`;
  return v.url ? "Not collected yet" : "No listing link";
}

export default async function ReviewsPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, configured, budget } = page;
  const header = <TabHeader source="dfs" title="Reviews (all platforms)" description="Ratings and reviews of the business across review sites, refreshed automatically every week. Google, Trustpilot, Tripadvisor (and Yelp when DataForSEO re-enables it) are read without any login; the others need the client's credentials or have no public API." guide={[
    { term: "Combined average", text: "Average star rating weighted by each platform's review count." },
    { term: "Response rate", text: "Share of the collected reviews that have an owner reply." },
  ]} />;
  if (!configured) return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const { profiles, saved, views } = await loadPlatformReviews(await createClient(), createAdminClient(), client.id);
  const live = views.filter((v) => v.source === "live" && ((v.total ?? 0) > 0 || v.reviews.length > 0));
  const totalCount = live.reduce((a, v) => a + (v.total ?? v.reviews.length), 0);
  const weighted = live.filter((v) => v.rating != null).reduce((a, v) => ({ s: a.s + v.rating! * (v.total ?? v.reviews.length), n: a.n + (v.total ?? v.reviews.length) }), { s: 0, n: 0 });
  const combined = weighted.n ? weighted.s / weighted.n : null;
  const all = live.flatMap((v) => v.reviews.map((r) => ({ ...r, platform: v.platform, label: v.label })));
  const replied = all.filter((r) => r.reply).length;
  const responseRate = all.length ? (replied / all.length) * 100 : null;
  const last90 = all.filter((r) => r.date && r.date >= shiftDays(todayIn("UTC"), -90)).length;

  const m12 = months(12);
  const series = live.map((v, i) => ({ v, color: cat(i), counts: m12.map((m) => v.reviews.filter((r) => r.date?.startsWith(m)).length) }));
  const maxMonth = Math.max(1, ...m12.map((_, j) => series.reduce((a, s) => a + s.counts[j], 0)));
  const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: all.filter((r) => Math.round(r.rating ?? 0) === s).length }));
  const maxDist = Math.max(1, ...dist.map((d) => d.n));
  const pending = views.some((v) => v.status === "pending");
  const fetchable = views.filter((v) => (v.platform === "google" || FETCHABLE.includes(v.platform)) && v.url).length;
  const feed = [...all].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const card = "rounded-[10px] border border-border bg-surface p-4";

  return (
    <>
      {header}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <SpendLine budget={budget} />
        <ReviewsRefresh canEdit={canEdit} pending={pending} estimate={`≈$${refreshEstimate(Math.max(0, fetchable - 1)).toFixed(3)}`} />
      </div>

      <section aria-label="Headline" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Combined rating" source="Reviews" format={(n) => fmtRating(n ?? null)} value={combined} previous={null} hint="Weighted by each platform's review count." />
        <KpiCard label="Total reviews" source="Reviews" format={fmtInt} value={totalCount} previous={null} hint="Sum of the review counts each platform shows." />
        <KpiCard label="New reviews (90 days)" source="Reviews" format={fmtInt} value={last90} previous={null} hint="From the collected (newest) reviews." />
        <KpiCard label="Response rate" source="Reviews" format={(n) => pct(n ?? null)} value={responseRate} previous={null} hint="Collected reviews with an owner reply." />
      </section>

      <section aria-label="Platforms" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {views.map((v) => (
          <div key={v.platform} className={`${card} ${v.source === "live" ? "" : "opacity-80"}`}>
            <p className="flex items-center justify-between text-sm font-semibold">{v.label}
              {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="text-xs font-normal text-accent underline">listing</a>}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{v.source === "live" && v.rating != null ? `${v.rating.toFixed(1)} ★` : "—"}</p>
            <p className="text-xs text-muted">{v.source === "live" && v.total != null ? `${fmtInt(v.total)} reviews` : " "}</p>
            <p className={`mt-2 text-xs ${v.status === "failed" ? "text-negative" : "text-muted"}`}>{statusText(v)}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Reviews over time">
          <h2 className="text-sm font-semibold">Reviews over time</h2>
          <p className="mb-3 text-xs text-muted">New reviews per month, last 12 months, by platform (from the collected newest reviews).</p>
          <div className="flex h-40 items-end gap-1.5">
            {m12.map((m, j) => (
              <div key={m} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-col-reverse" style={{ height: "8.5rem" }}>
                  {series.map((s) => s.counts[j] > 0 && (
                    <div key={s.v.platform} title={`${s.v.label} ${m}: ${s.counts[j]}`} style={{ height: `${(s.counts[j] / maxMonth) * 100}%`, background: s.color }} className="w-full first:rounded-b-sm last:rounded-t-sm" />
                  ))}
                </div>
                <span className="text-[10px] text-muted">{m.slice(5)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted">{series.map((s) => <span key={s.v.platform} className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />{s.v.label}</span>)}</p>
        </section>

        <section className={card} aria-label="Rating distribution">
          <h2 className="text-sm font-semibold">Rating distribution</h2>
          <p className="mb-3 text-xs text-muted">All collected reviews, every platform.</p>
          <ul className="space-y-2">
            {dist.map((d) => (
              <li key={d.s} className="flex items-center gap-2 text-sm">
                <span className="w-8 tabular-nums">{d.s} ★</span>
                <span className="h-3 flex-1 rounded bg-surface-muted"><span className="block h-3 rounded bg-accent" style={{ width: `${(d.n / maxDist) * 100}%` }} /></span>
                <span className="w-10 text-right tabular-nums text-muted">{d.n}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 text-sm font-semibold">Response rate by platform</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {live.map((v) => { const n = v.reviews.length, r = v.reviews.filter((x) => x.reply).length; return (
              <li key={v.platform} className="flex justify-between"><span>{v.label}</span><span className="tabular-nums text-muted">{n ? `${Math.round((r / n) * 100)}% (${r}/${n})` : "—"}</span></li>
            ); })}
            {live.length === 0 && <li className="text-muted">No reviews collected yet.</li>}
          </ul>
        </section>
      </div>

      <section className={`${card} mt-6`} aria-label="Latest reviews">
        <h2 className="mb-3 text-sm font-semibold">Latest reviews</h2>
        <ReviewFeed items={feed} platforms={live.map((v) => ({ key: v.platform, label: v.label }))} />
      </section>

      <details className={`${card} mt-6`} open={Object.keys(saved).length === 0 && canEdit}>
        <summary className="cursor-pointer text-sm font-medium">Listing links <span className="ml-2 text-accent">{canEdit ? "Edit" : "View"}</span></summary>
        <p className="mt-2 text-xs text-muted">Paste the client&apos;s profile page on each site. &quot;auto&quot; platforms are read weekly; &quot;needs key&quot; ones need the client&apos;s credentials; &quot;link only&quot; sites have no public API and forbid scraping, so only the link is kept.</p>
        <div className="mt-3">
          <ProfileLinksEditor canEdit={canEdit} saved={saved as Record<string, string>} defaults={profiles as Record<string, string>}
            platforms={PLATFORMS.map((p) => ({ key: p.key, label: p.label, example: p.example, access: p.access }))} />
        </div>
        <ul className="mt-4 space-y-1 text-xs text-muted">{PLATFORMS.filter((p) => p.access !== "api" || p.key === "yelp").map((p) => <li key={p.key}><strong className="text-foreground">{p.label}:</strong> {p.note}</li>)}</ul>
      </details>
    </>
  );
}
