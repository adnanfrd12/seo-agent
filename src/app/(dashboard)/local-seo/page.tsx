import { Donut, StackedBars } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { FillColumns, RatingCompare } from "@/components/charts/research-charts";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Highlights } from "@/components/dashboard/highlights";
import { StatCard } from "@/components/dashboard/kpi-card";
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
const cellTone = (r: number | null) => (r == null ? "bg-surface-muted text-muted" : r <= 3 ? "bg-positive/80 text-white" : r <= 10 ? "bg-warn/80 text-white" : "bg-negative/75 text-white");

function GridCard({ g }: { g: Grid }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4">
      <p className="text-sm font-semibold">“{g.keyword}” <span className="font-normal text-muted">· {g.size}×{g.size}, {g.spacingKm} km apart · {g.checkedAt.slice(0, 10)}</span></p>
      <div className="mx-auto my-3 grid max-w-[15rem] gap-1" style={{ gridTemplateColumns: `repeat(${g.size}, minmax(0, 1fr))` }}>
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
      <p className="mt-2 text-[11px] text-muted">Outlined = the business · green top 3 · amber 4-10 · red 11-20 · grey not found</p>
    </div>
  );
}

export default async function LocalSeoPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Local SEO & Reviews" description="Google rating, reviews and replies, map rankings and nearby competitors." guide={[
    { term: "Reply rate", text: "Share of the newest reviews the owner answered." },
    { term: "Sentiment", text: "From the stars: 4-5 positive, 3 neutral, 1-2 negative." },
    { term: "Map grid", text: "Where the business shows on Google Maps when people search from points around it." },
    { term: "Map coverage", text: "For each scanned keyword, how many grid points put the business in the top 3, 4-10, 11-20 or nowhere in the top 20." },
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

  const stars5 = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} ★`);
  const grids = groupGrids(local.grids);
  const sentimentTotal = st.positive + st.neutral + st.negative;
  const ratingRows = rivalRows.map((r, i) => ({ label: String(r.business), rating: r.rating == null ? null : Number(r.rating), reviews: r.reviews == null ? null : Number(r.reviews), you: Boolean(p) && i === 0 }));
  const coverage = grids.map(([kw, list]) => {
    const pts = list[0].points;
    const n = (lo: number, hi: number) => pts.filter((x) => x.rank != null && x.rank >= lo && x.rank <= hi).length;
    return { label: kw, values: { top3: n(1, 3), top10: n(4, 10), top20: n(11, 20), none: pts.filter((x) => x.rank == null).length } };
  });
  const coverageChart = coverage.length > 0 && (
    <StackedBars title="Map coverage by keyword" sub="Grid points per rank band in the latest scan of each keyword" valueLabel="Grid points" percent
      keys={[{ key: "top3", label: "Top 3", color: "var(--positive)" }, { key: "top10", label: "4-10", color: "var(--warn)" }, { key: "top20", label: "11-20", color: "var(--negative)" }, { key: "none", label: "Not in top 20", color: "var(--series-prev)" }]}
      rows={coverage.map((c) => ({ ...c, note: `${c.values.top3 + c.values.top10 + c.values.top20} of ${c.values.top3 + c.values.top10 + c.values.top20 + c.values.none} found` }))} />
  );
  // who holds the map top 3 most often across the latest scans (the business itself excluded)
  const selfName = (p?.title ?? local.identity.name).toLowerCase();
  const mapLead = new Map<string, number>();
  for (const [, list] of grids) for (const pt of list[0].points) for (const t of pt.top) if (t && t.toLowerCase() !== selfName) mapLead.set(t, (mapLead.get(t) ?? 0) + 1);
  const mapLeaders = (
    <BarList title="Who shows on the map instead" valueLabel="Grid points in their top 3" emptyText="No other businesses seen yet."
      items={[...mapLead.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} />
  );
  // grid cards: 3 across when they divide evenly, else 2; a single card or an odd remainder cell gets the leaders list beside it
  const gridCols = grids.length % 3 === 0 ? 3 : grids.length % 2 === 0 ? 2 : grids.length === 1 ? 2 : 3;
  const spare = grids.length % gridCols ? gridCols - (grids.length % gridCols) : 0;
  return (
    <>
      {header}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm"><span className="font-semibold">{p?.title ?? local.identity.name}</span><span className="text-muted">{local.identity.city ? ` · ${local.identity.city}` : ""}{local.reviews ? ` · updated ${local.reviews.fetchedAt.slice(0, 10)}` : ""} · refreshes weekly</span></p>
        <LocalRefresh canEdit={canEdit} waiting={waiting} hasData={Boolean(p)} />
      </div>

      {!p && !local.reviews ? (
        <EmptyState title="No profile or review data yet" body="It loads automatically in the next daily run, or press the button above." />
      ) : (
        <>
          <section aria-label="Reputation summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Google rating" value={stars5(p?.rating ?? local.reviews?.rating ?? null)} tone={(p?.rating ?? 0) >= 4.5 ? "good" : undefined} />
            <StatCard label="Total reviews" value={fmtInt(p?.votes ?? local.reviews?.total ?? null)} />
            <StatCard label="Replied" value={st.loaded ? fmtInt(st.replied) : "—"} tone="good" />
            <StatCard label="Not replied" value={st.loaded ? fmtInt(st.notReplied) : "—"} tone={st.notReplied ? "bad" : undefined} />
            <StatCard label="Reply rate" value={fmtPercent(st.replyRate, 0)} tone={st.replyRate == null ? undefined : st.replyRate >= 0.8 ? "good" : "warn"} />
            <StatCard label="New · 90 days" value={st.loaded ? fmtInt(st.last90) : "—"} />
          </section>

          {picks.length > 0 && <div className="mt-6"><Highlights items={picks.slice(0, 3)} /></div>}

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <FillColumns title="Ratings" sub={distTotal ? `${fmtInt(distTotal)} rated reviews by stars` : "Reviews by stars"} valueLabel="Reviews" empty="No ratings yet."
              bins={dist.map((d) => ({ label: `${d.stars}★`, value: d.count, detail: stars(d.stars), color: d.stars >= 4 ? "var(--positive)" : d.stars === 3 ? "var(--series-prev)" : "var(--negative)" }))} />
            <Donut title="Sentiment" sub="From the stars: 4-5 positive, 3 neutral, 1-2 negative" center={sentimentTotal ? `${Math.round((st.positive / sentimentTotal) * 100)}%` : "—"} centerLabel="positive"
              items={[{ label: `Positive · ${fmtInt(st.positive)}`, value: st.positive, color: "var(--positive)" }, { label: `Neutral · ${fmtInt(st.neutral)}`, value: st.neutral, color: "var(--series-prev)" }, { label: `Negative · ${fmtInt(st.negative)}`, value: st.negative, color: "var(--negative)" }]} />
            <Donut title="Owner replies" sub={`${fmtInt(st.unansweredNegative)} unhappy review${st.unansweredNegative === 1 ? "" : "s"} (3★ or fewer) without a reply`} center={fmtPercent(st.replyRate, 0)} centerLabel="reply rate"
              items={[{ label: `Replied · ${fmtInt(st.replied)}`, value: st.replied, color: "var(--positive)" }, { label: `Other, no reply · ${fmtInt(st.notReplied - st.unansweredNegative)}`, value: Math.max(0, st.notReplied - st.unansweredNegative), color: "var(--series-prev)" }, { label: `Unhappy, no reply · ${fmtInt(st.unansweredNegative)}`, value: st.unansweredNegative, color: "var(--negative)" }]} />
          </div>
          <div className={`mt-4 grid gap-4 ${ratingRows.length > 1 ? "lg:grid-cols-2" : ""}`}>
            <BarList title="What reviewers mention" valueLabel="Reviews" emptyText="No topics reported." items={(p?.topics ?? []).slice(0, 6).map((t) => ({ label: t.topic, value: t.count }))} />
            {ratingRows.length > 1 && <RatingCompare title="Rating vs nearby businesses" sub="Your Google profile against the competitors on the Competitors tab" rows={ratingRows} />}
          </div>

          <div className="mt-6">
            <Tabs label="Local SEO views" items={[
              {
                key: "reviews", label: "Reviews", badge: reviewRows.length, content: (
                  <div className="space-y-4">
                    {velocity.length > 0 && velocity[0].data.length >= 2 && <MetricTrend title="New reviews per month" source="Google" options={velocity.slice(0, 1)} />}
                    {reviewRows.length ? (
                      <ResearchTable title="Recent reviews" rows={reviewRows} searchKeys={["author", "review", "reply"]} initialSort={{ key: "date", dir: "desc" }} pageSize={10} csvName={`reviews-${client.name}`}
                        columns={[
                          { key: "rating", label: "Rating", type: "int" }, { key: "author", label: "Author" }, { key: "date", label: "Date", type: "date" },
                          { key: "review", label: "Review" }, { key: "replied", label: "Owner replied", type: "badge" }, { key: "sentiment", label: "Sentiment", type: "badge" },
                        ]}
                        facets={[{ key: "replied", label: "Owner reply" }, { key: "sentiment", label: "Sentiment" }]}
                        presets={[{ label: "Not replied", where: [{ key: "replied", op: "eq", value: "No reply" }] }, { label: "Unhappy (≤3★)", where: [{ key: "rating", op: "lte", value: 3 }] }]} />
                    ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">{waiting ? "Collecting reviews…" : local.reviewTask?.status === "failed" ? `Reviews couldn't be collected: ${local.reviewTask.error ?? "unknown error"}.` : "No reviews loaded yet."}</p>}
                  </div>
                ),
              },
              {
                key: "map", label: "Map rankings", badge: grids.length, content: (
                  <div className="space-y-4">
                    {grids.length === 0 ? <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">The first map scan runs in the next daily update.</p> : (
                      <>
                        {coverageChart}
                        <div className={`grid gap-4 md:grid-cols-2 ${gridCols === 3 ? "xl:grid-cols-3" : ""}`}>
                          {grids.map(([kw, list]) => <GridCard key={kw} g={list[0]} />)}
                          {spare > 0 && <div className={`grid min-w-0 ${spare === 2 ? "xl:col-span-2" : ""}`}>{mapLeaders}</div>}
                        </div>
                        {!spare && mapLeaders}
                      </>
                    )}
                    {grids.some(([, l]) => l.length > 1) && <MetricTrend title="Map visibility over time (points in the top 3)" source="Google Maps" options={grids.filter(([, l]) => l.length > 1).map(([kw, l]) => ({ key: kw, label: kw, data: [...l].reverse().map((g) => ({ date: g.checkedAt.slice(0, 10), value: g.summary.top3 })) }))} />}
                    {canEdit && <details className="rounded-[10px] border border-border bg-surface p-4"><summary className="cursor-pointer text-sm font-medium">Scan another keyword</summary><div className="mt-3"><GridForm canEdit={canEdit} suggestions={gridSuggestions} /></div></details>}
                  </div>
                ),
              },
              {
                key: "competitors", label: "Competitors", badge: Math.max(0, rivalRows.length - 1), content: (
                  <div className="space-y-4">
                    {rivalRows.length > 1 ? (
                      <ResearchTable title="Google profile comparison" rows={rivalRows} initialSort={{ key: "reviews", dir: "desc" }} csvName={`gbp-comparison-${client.name}`}
                        columns={[
                          { key: "business", label: "Business" }, { key: "rating", label: "Rating", type: "dec" }, { key: "reviews", label: "Reviews", type: "int" },
                          { key: "last90", label: "New · 90 days", type: "int" }, { key: "reply_rate", label: "Reply rate %", type: "int" },
                          { key: "negative", label: "Negative", type: "int" }, { key: "photos", label: "Photos", type: "int" }, { key: "category", label: "Category" },
                        ]} />
                    ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Competitors are added automatically from the map scans.</p>}
                    {velocity.length > 1 && <MetricTrend title="New reviews per month: you vs competitors" source="Google" options={velocity} />}
                    {canEdit && <details className="rounded-[10px] border border-border bg-surface p-4"><summary className="cursor-pointer text-sm font-medium">Compare other businesses</summary><div className="mt-3"><RivalForm canEdit={canEdit} suggestions={[...new Set([...(p?.alsoSearch.map((a) => a.title) ?? []), ...gridRivals(local.grids, p?.title ?? local.identity.name).map((r) => r.name)])]} /></div></details>}
                  </div>
                ),
              },
              ...(p ? [{
                key: "profile", label: "Profile", content: (
                  <div className="space-y-4">
                    <div className={`grid gap-4 ${p.hours.length > 0 ? "lg:grid-cols-2" : ""}`}>
                      <div className="min-w-0 rounded-[10px] border border-border bg-surface p-4">
                        <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                          {([
                            ["Name", p.title], ["Category", [p.category, ...p.additional].filter(Boolean).join(" · ")], ["Address", p.address], ["Phone", p.phone], ["Website", p.url],
                            ["Claimed", p.claimed == null ? null : p.claimed ? "Yes" : "No"], ["Photos", p.photos != null ? fmtInt(p.photos) : null], ["Q&A", p.questions != null ? fmtInt(p.questions) : null],
                          ] as const).filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}
                        </dl>
                      </div>
                      {p.hours.length > 0 && (
                        <div className="rounded-[10px] border border-border bg-surface p-4">
                          <h3 className="mb-2 text-sm font-semibold">Opening hours</h3>
                          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">{p.hours.map((h) => <div key={h.day} className="contents"><dt className="capitalize text-muted">{h.day}</dt><dd>{h.open}</dd></div>)}</dl>
                        </div>
                      )}
                    </div>
                    {p.attributes.length > 0 && (
                      <div className="rounded-[10px] border border-border bg-surface p-4">
                        <h3 className="mb-2 text-sm font-semibold">Attributes</h3>
                        <ul className="flex flex-wrap gap-1.5 text-xs">{p.attributes.map((a) => <li key={a} className="rounded bg-surface-muted px-2 py-0.5 capitalize">{a}</li>)}</ul>
                      </div>
                    )}
                    {p.alsoSearch.length > 0 && (
                      <BarList title="People also search for" valueLabel="Google reviews · rating"
                        items={p.alsoSearch.map((a) => ({ label: a.title, value: a.votes ?? 0, detail: a.rating != null ? `${a.rating.toFixed(1)} ★` : "—" }))} />
                    )}
                  </div>
                ),
              }] : []),
            ]} />
          </div>
          <div className="mt-6"><SpendLine budget={budget} /></div>
        </>
      )}
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
