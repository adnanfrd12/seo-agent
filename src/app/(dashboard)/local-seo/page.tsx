import { BarList } from "@/components/charts/bar-list";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Highlights } from "@/components/dashboard/highlights";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine } from "@/components/research/chrome";
import { GridForm, LocalRefresh, RivalForm } from "@/components/research/local-controls";
import { ResearchTable } from "@/components/research/research-table";
import { Tabs } from "@/components/research/tabs";
import { fmtInt, fmtPercent } from "@/lib/analytics/format";
import { gridRivals, loadLocal, reviewStats, type Grid, type Review } from "@/lib/dataforseo/local";
import { researchPage } from "@/lib/dataforseo/view";
import type { Highlight } from "@/lib/overview/highlights";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const stars = (n: number | null) => (n == null ? "—" : `${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}`);
const cellTone = (r: number | null) => (r == null ? "bg-surface-muted text-muted" : r <= 3 ? "bg-positive/80 text-white" : r <= 10 ? "bg-[#D4970A]/80 text-white" : "bg-negative/75 text-white");

function GridCard({ g }: { g: Grid }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold">“{g.keyword}” <span className="font-normal text-muted">· {g.size}×{g.size}, {g.spacingKm} km apart · {g.checkedAt.slice(0, 10)}</span></p>
      <div className="my-3 grid max-w-xs gap-1" style={{ gridTemplateColumns: `repeat(${g.size}, minmax(0, 1fr))` }}>
        {g.points.map((p) => (
          <div key={`${p.row}-${p.col}`} title={p.rank == null ? `Not in the top 20 here. Top: ${p.top.join(", ")}` : `#${p.rank} here. Top: ${p.top.join(", ")}`}
            className={`flex aspect-square items-center justify-center rounded-md text-xs font-semibold tabular-nums ${cellTone(p.rank)} ${p.row === (g.size - 1) / 2 && p.col === (g.size - 1) / 2 ? "ring-2 ring-foreground" : ""}`}>
            {p.rank == null ? "20+" : `#${p.rank}`}
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-4 gap-2 text-center text-xs">
        {[["Found", `${g.summary.found}/${g.summary.searched}`], ["Avg rank", g.summary.average ?? "—"], ["Top 3", g.summary.top3], ["Top 10", g.summary.top10]].map(([l, v]) => (
          <div key={String(l)} className="rounded-lg bg-surface-muted p-2"><dt className="text-muted">{l}</dt><dd className="text-sm font-semibold tabular-nums">{v}</dd></div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-muted">The outlined square is the business location. Green = top 3, amber = 4-10, red = 11-20, grey = not in the top 20. Hover a square for who ranks first there.</p>
    </div>
  );
}

export default async function LocalSeoPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Local SEO & Reviews" description="The Google Business Profile as customers see it, every recent review and whether it got a reply, map rankings around the business, and how nearby competitors compare." guide={[
    { term: "Reply rate", text: "Share of the loaded reviews the owner answered. Google and customers both notice replies; aim to answer every review, especially the unhappy ones." },
    { term: "Review sentiment", text: "Based on the star rating: 4-5 stars positive, 3 neutral, 1-2 negative." },
    { term: "Review velocity", text: "How many new reviews arrive each month. A steady flow matters as much as the total." },
    { term: "Map rank grid", text: "Google Maps results change with the searcher's location. The grid searches from points around the business and shows where it appears at each one." },
    { term: "Source", text: "Profile and reviews come from Google via DataForSEO; the grid is live Google Maps searches. Nothing is fetched when you open this page." },
  ]} />;
  if (!configured) return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const local = await loadLocal(await createClient(), createAdminClient(), client.id);
  if (!local.identity) return <>{header}<EmptyState title="No Business Profile connected" body="Connect Google Business Profile (or Local Brand Manager) for this client so the business can be found on Google Maps." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const p = local.profile?.data ?? null;
  const reviews = local.reviews?.items ?? [];
  const st = reviewStats(reviews);
  const waiting = [local.reviewTask, ...local.rivals.map((r) => r.task)].some((t) => t?.status === "pending");
  const ranked = (cache.get<Row[]>("ranked_keywords")?.data ?? []) as Row[];
  const gridSuggestions = [...new Set([
    ...(p?.category ? [`${p.category.toLowerCase()} near me`] : []),
    ...ranked.filter((k) => typeof k.keyword === "string").sort((a, b) => Number(b.volume ?? 0) - Number(a.volume ?? 0)).slice(0, 6).map((k) => k.keyword as string),
  ])];

  const picks: Highlight[] = [];
  if (st.unansweredNegative) picks.push({ tone: "bad", title: `${st.unansweredNegative} unhappy review${st.unansweredNegative > 1 ? "s" : ""} without a reply`, detail: "Reviews of 3 stars or fewer that the owner hasn't answered.", action: "Reply politely and offer to make it right; future customers read these first." });
  if (st.replyRate != null && st.replyRate < 0.8 && st.loaded >= 5) picks.push({ tone: "info", title: `Only ${Math.round(st.replyRate * 100)}% of recent reviews have a reply`, detail: `${st.notReplied} of the ${st.loaded} newest reviews are unanswered.`, action: "Answer every review, good or bad, within a few days." });
  if (st.replyRate != null && st.replyRate >= 0.9 && st.loaded >= 5) picks.push({ tone: "good", title: `${Math.round(st.replyRate * 100)}% of recent reviews answered`, detail: "A strong reply habit; keep it up." });
  if (p?.claimed === false) picks.push({ tone: "bad", title: "The profile isn't claimed", detail: "Anyone can suggest edits to an unclaimed profile.", action: "Claim and verify it in Google Business Profile." });
  const lastGrid = [...local.grids].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  if (lastGrid && lastGrid.summary.found < lastGrid.summary.searched) picks.push({ tone: "info", title: `Not in the map top 20 at ${lastGrid.summary.searched - lastGrid.summary.found} of ${lastGrid.summary.searched} points for “${lastGrid.keyword}”`, detail: "Customers searching from there don't see the business on the map.", action: "Add photos, posts and reviews that mention the service and the nearby areas." });

  const reviewRows: Row[] = reviews.map((r: Review) => ({
    rating: r.rating, author: r.author, date: r.date, review: r.text, replied: r.reply ? "Replied" : "No reply", reply: r.reply, reply_date: r.replyDate,
    sentiment: r.rating == null ? null : r.rating >= 4 ? "positive" : r.rating === 3 ? "neutral" : "negative", local_guide: r.localGuide, photos: r.images,
  }));
  const googleDist = p && Object.keys(p.distribution).length ? [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: p.distribution[String(s)] ?? 0 })) : null;
  const dist = googleDist ?? st.distribution;
  const distTotal = dist.reduce((a, d) => a + d.count, 0);

  const rivalRows: Row[] = [
    ...(p ? [{ business: `${p.title ?? client.name} (you)`, rating: p.rating, reviews: p.votes, ...rivalStats(reviews), photos: p.photos, category: p.category, extra: p.additional.length, claimed: p.claimed }] : []),
    ...local.rivals.filter((r) => r.profile).map((r) => ({ business: r.profile!.title, rating: r.profile!.rating, reviews: r.profile!.votes, ...rivalStats(r.reviews?.items ?? []), photos: r.profile!.photos, category: r.profile!.category, extra: r.profile!.additional.length, claimed: r.profile!.claimed })),
  ];
  const velocity = [
    ...(st.monthly.length ? [{ key: "you", label: p?.title ?? "You", data: st.monthly.slice(-12).map((m) => ({ date: `${m.month}-01`, value: m.count })) }] : []),
    ...local.rivals.filter((r) => r.reviews?.items.length).map((r) => ({ key: r.key, label: r.profile?.title ?? r.reviews!.name, data: reviewStats(r.reviews!.items).monthly.slice(-12).map((m) => ({ date: `${m.month}-01`, value: m.count })) })),
  ];

  return (
    <>
      {header}
      <div className="mb-5 space-y-3">
        <SpendLine budget={budget} />
        <p className="text-xs text-muted">Business: <span className="font-medium text-foreground">{p?.title ?? local.identity.name}</span>{local.identity.city ? ` · ${local.identity.city}` : ""}{local.profile ? ` · profile updated ${local.profile.fetchedAt.slice(0, 10)}` : ""}{local.reviews ? ` · reviews collected ${local.reviews.fetchedAt.slice(0, 10)}` : ""}</p>
        <LocalRefresh canEdit={canEdit} waiting={waiting} hasData={Boolean(p)} />
      </div>

      {!p && !local.reviews ? (
        <EmptyState title="No profile or review data yet" body="Press the button above to load the Google Business Profile and the newest 100 reviews (about 1.5 cents). Nothing is fetched automatically when you open this page." />
      ) : (
        <>
          <Highlights items={picks.slice(0, 4)} stableNote="Nothing needs attention in the reviews right now." />
          <section aria-label="Reputation summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard label="Google rating" source="Google" format={(n) => (n == null ? "—" : n.toFixed(1))} value={p?.rating ?? local.reviews?.rating ?? null} previous={null} />
            <KpiCard label="Total reviews" source="Google" format={fmtInt} value={p?.votes ?? local.reviews?.total ?? null} previous={null} hint="All reviews on the Google profile." />
            <KpiCard label="Reviews replied" source="Google" format={fmtInt} value={st.loaded ? st.replied : null} previous={null} hint={`Of the ${st.loaded} newest reviews loaded.`} />
            <KpiCard label="Not replied" source="Google" format={fmtInt} value={st.loaded ? st.notReplied : null} previous={null} higherIsBetter={false} />
            <KpiCard label="Reply rate" source="Google" format={(n) => fmtPercent(n, 0)} value={st.replyRate} previous={null} />
            <KpiCard label="New reviews · 90 days" source="Google" format={fmtInt} value={st.loaded ? st.last90 : null} previous={null} />
          </section>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <BarList title={googleDist ? "Rating breakdown · all reviews" : "Rating breakdown · loaded reviews"} valueLabel="Reviews"
              items={dist.map((d) => ({ label: stars(d.stars), value: d.count, detail: distTotal ? `${((d.count / distTotal) * 100).toFixed(0)}%` : undefined }))} />
            <BarList title="Review sentiment · loaded reviews" valueLabel="Reviews" items={[
              { label: "Positive (4-5★)", value: st.positive }, { label: "Neutral (3★)", value: st.neutral }, { label: "Negative (1-2★)", value: st.negative },
            ]} />
            {p?.topics?.length ? <BarList title="What reviewers talk about" valueLabel="Reviews mentioning it" items={p.topics.slice(0, 10).map((t) => ({ label: t.topic, value: t.count }))} /> : null}
            <BarList title="Owner replies · loaded reviews" valueLabel="Reviews" items={[
              { label: "Replied", value: st.replied }, { label: "Not replied", value: st.notReplied },
              { label: "Unhappy (≤3★) without reply", value: st.unansweredNegative },
            ]} />
          </div>
          {st.medianReplyDays != null && <p className="mt-2 text-xs text-muted">Typical reply time: {st.medianReplyDays < 1 ? "same day" : `${Math.round(st.medianReplyDays)} days`} after the review.</p>}

          {velocity.length > 0 && velocity[0].data.length >= 2 && (
            <div className="mt-6"><MetricTrend title="New reviews per month (review velocity)" source="Google" options={velocity} /></div>
          )}

          <section className="mt-6" aria-label="Reviews">
            {reviewRows.length ? (
              <ResearchTable title="Recent reviews" rows={reviewRows} searchKeys={["author", "review", "reply"]} initialSort={{ key: "date", dir: "desc" }} pageSize={15} csvName={`reviews-${client.name}`}
                columns={[
                  { key: "rating", label: "Rating", type: "int" }, { key: "author", label: "Author" }, { key: "date", label: "Date", type: "date" },
                  { key: "review", label: "Review" }, { key: "replied", label: "Owner replied", type: "badge" }, { key: "reply", label: "Reply" },
                  { key: "sentiment", label: "Sentiment", type: "badge" }, { key: "photos", label: "Photos", type: "int" },
                ]}
                facets={[{ key: "replied", label: "Owner reply" }, { key: "sentiment", label: "Sentiment" }]} ranges={[{ key: "rating", label: "Rating" }]}
                presets={[{ label: "Not replied", where: [{ key: "replied", op: "eq", value: "No reply" }] }, { label: "Unhappy (≤3★)", where: [{ key: "rating", op: "lte", value: 3 }] }]}
                note={`The ${reviewRows.length} newest reviews on Google, newest first.`} />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">{waiting ? "Reviews are being collected." : local.reviewTask?.status === "failed" ? `Reviews couldn't be collected: ${local.reviewTask.error ?? "unknown error"}.` : "No reviews loaded yet."}</p>
            )}
          </section>

          {p && (
            <section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Business profile">
              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="mb-2 text-sm font-semibold">Profile on Google</h2>
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                  {([
                    ["Name", p.title], ["Category", [p.category, ...p.additional].filter(Boolean).join(" · ")], ["Rating", p.rating != null ? `${p.rating} from ${fmtInt(p.votes)} reviews` : null],
                    ["Address", p.address], ["Phone", p.phone], ["Website", p.url], ["Claimed", p.claimed == null ? null : p.claimed ? "Yes" : "No"], ["Status", p.status?.replace(/_/g, " ")],
                    ["Photos", p.photos != null ? fmtInt(p.photos) : null], ["Questions & answers", p.questions != null ? fmtInt(p.questions) : null], ["Price level", p.priceLevel],
                    ["Services", p.services?.length ? p.services.join(", ") : null], ["Place ID", p.placeId], ["CID", p.cid],
                  ] as const).filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}
                </dl>
                {p.description && <p className="mt-3 text-sm text-muted">{p.description}</p>}
              </div>
              <div className="space-y-4">
                {p.hours.length > 0 && (
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <h2 className="mb-2 text-sm font-semibold">Opening hours</h2>
                    <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">{p.hours.map((h) => <div key={h.day} className="contents"><dt className="capitalize text-muted">{h.day}</dt><dd>{h.open}</dd></div>)}</dl>
                  </div>
                )}
                {p.attributes.length > 0 && (
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <h2 className="mb-2 text-sm font-semibold">Attributes on the profile</h2>
                    <ul className="flex flex-wrap gap-1.5 text-xs">{p.attributes.map((a) => <li key={a} className="rounded bg-surface-muted px-2 py-0.5 capitalize">{a}</li>)}</ul>
                  </div>
                )}
                {p.alsoSearch.length > 0 && (
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <h2 className="mb-2 text-sm font-semibold">People also search for</h2>
                    <ul className="space-y-1 text-sm">{p.alsoSearch.map((a) => <li key={a.title} className="flex justify-between gap-2"><span>{a.title}</span><span className="shrink-0 text-muted">{a.rating ?? "—"}★ · {fmtInt(a.votes)} reviews</span></li>)}</ul>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <section className="mt-8 space-y-3" aria-label="Map rank grid">
        <div>
          <h2 className="text-base font-semibold">Google Maps rank grid</h2>
          <p className="text-sm text-muted">Where the business appears on Google Maps when people search from different spots around it. Each point is one live Maps search (about a quarter of a cent).</p>
        </div>
        <GridForm canEdit={canEdit} suggestions={gridSuggestions} />
        {local.grids.length === 0 ? <p className="text-sm text-muted">No map scan yet.</p> : (
          <Tabs label="Map scans" items={groupGrids(local.grids).map(([kw, list]) => ({
            key: kw, label: kw, badge: list.length,
            content: (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">{list.slice(0, 2).map((g) => <GridCard key={g.checkedAt} g={g} />)}</div>
                {list.length > 1 && <MetricTrend title={`Map visibility for “${kw}” over time`} source="Google Maps" options={[
                  { key: "found", label: "Points where found", data: [...list].reverse().map((g) => ({ date: g.checkedAt.slice(0, 10), value: g.summary.found })) },
                  { key: "top3", label: "Points in the top 3", data: [...list].reverse().map((g) => ({ date: g.checkedAt.slice(0, 10), value: g.summary.top3 })) },
                ]} />}
              </div>
            ),
          }))} />
        )}
      </section>

      <section className="mt-8 space-y-3" aria-label="Competitor profiles">
        <div>
          <h2 className="text-base font-semibold">How nearby competitors compare</h2>
          <p className="text-sm text-muted">Rating, review count, reply habit and review velocity of competing businesses, from their Google profiles and newest 50 reviews.</p>
        </div>
        <RivalForm canEdit={canEdit} suggestions={[...new Set([...(p?.alsoSearch.map((a) => a.title) ?? []), ...gridRivals(local.grids, p?.title ?? local.identity.name).map((r) => r.name)])]} />
        {rivalRows.length > 1 && (
          <ResearchTable title="Business Profile comparison" rows={rivalRows} initialSort={{ key: "reviews", dir: "desc" }} csvName={`gbp-comparison-${client.name}`}
            columns={[
              { key: "business", label: "Business" }, { key: "rating", label: "Rating", type: "dec" }, { key: "reviews", label: "Reviews", type: "int" },
              { key: "last90", label: "Reviews · 90 days", type: "int", hint: "From the newest reviews loaded" }, { key: "reply_rate", label: "Reply rate %", type: "int" },
              { key: "negative", label: "Negative (1-2★)", type: "int" }, { key: "photos", label: "Photos", type: "int" }, { key: "category", label: "Main category" },
              { key: "extra", label: "Extra categories", type: "int" }, { key: "claimed", label: "Claimed", type: "bool" },
            ]} />
        )}
        {velocity.length > 1 && <MetricTrend title="Review velocity: you vs competitors" source="Google" options={velocity} />}
      </section>
    </>
  );
}

function rivalStats(items: Review[]) {
  const s = reviewStats(items);
  return { last90: items.length ? s.last90 : null, reply_rate: s.replyRate == null ? null : Math.round(s.replyRate * 100), negative: items.length ? s.negative : null };
}

function groupGrids(grids: Grid[]): [string, Grid[]][] {
  const m = new Map<string, Grid[]>();
  for (const g of [...grids].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))) m.set(g.keyword, [...(m.get(g.keyword) ?? []), g]);
  return [...m.entries()];
}
