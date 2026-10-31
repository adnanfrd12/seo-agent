import { Donut } from "@/components/charts/ai-charts";
import { Breakdown, FillColumns } from "@/components/charts/research-charts";
import { MetricTrend } from "@/components/charts/metric-trend";
import type { TrendPoint } from "@/components/charts/trend-chart";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine, SpikeAlert, TargetSettings } from "@/components/research/chrome";
import { LinkChangeCheck, LinkGapForm, RefreshControls } from "@/components/research/controls";
import { ResearchTable, type Col } from "@/components/research/research-table";
import { Tabs } from "@/components/research/tabs";
import { fmtInt } from "@/lib/analytics/format";
import { detectLinkSpike, estimate, TIER1, TIER2, type LinkChanges } from "@/lib/dataforseo/research";
import { pointAgo, profileSeries, researchPage } from "@/lib/dataforseo/view";

type Row = Record<string, unknown>;
type Named = { name: string; count: number };
type Summary = {
  rank: number | null; backlinks: number | null; referring_domains: number | null; referring_pages: number | null; referring_main_domains: number | null;
  spam_score: number | null; broken_backlinks: number | null; nofollow: number | null; dofollow: number | null; first_seen: string | null;
  tld: Named[]; types: Named[]; platforms: Named[]; countries: Named[]; attributes: Named[]; semantic: Named[]; referring_ips: number | null; crawled_pages: number | null;
  referring_subnets?: number | null;
};
type Month = { date: string | null; new_backlinks: number; lost_backlinks: number; new_domains: number; lost_domains: number };
type List = { total: number; rows: Row[] };

const BACKLINK_COLS: Col[] = [
  { key: "from", label: "Linking page", type: "url" }, { key: "anchor", label: "Anchor" }, { key: "to", label: "Links to", type: "url" },
  { key: "dofollow", label: "Follow", type: "bool", hint: "Yes = dofollow (passes ranking value)" }, { key: "rank", label: "Link rank", type: "int", hint: "DataForSEO rank of the link (0-1000)" },
  { key: "domain_rank", label: "Domain rank", type: "int" }, { key: "spam", label: "Spam", type: "spam", hint: "Backlink spam score, 0-100" }, { key: "first_seen", label: "First seen", type: "date" },
];
const REF_COLS: Col[] = [
  { key: "domain", label: "Domain" }, { key: "rank", label: "Rank", type: "int" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "pages", label: "Linking pages", type: "int" },
  { key: "spam", label: "Spam", type: "spam" }, { key: "first_seen", label: "First seen", type: "date" }, { key: "lost", label: "Lost", type: "date" },
];
const SPAM_PRESET = { label: "High spam (≥ 50)", where: [{ key: "spam", op: "gte" as const, value: 50 }] };

const named = (items: Named[] | undefined, total: number | null) => (items ?? []).map((x) => ({ label: x.name || "Unknown", value: x.count, detail: total ? `${((x.count / total) * 100).toFixed(0)}%` : undefined }));

export default async function BacklinksPage() {
  const page = await researchPage();
  if (!page) return null;
  const { canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Backlinks" description="Who links to the website: authority, referring domains, new and lost links, anchors and link opportunities. Data from DataForSEO." guide={[
          { term: "Domain rank", text: "A 0-1000 strength score for the whole site's link profile. Higher means more authority." },
          { term: "Backlinks and referring domains", text: "Links pointing to you, and the number of different websites they come from. Many links from few sites are worth less than links from many." },
          { term: "Dofollow / nofollow", text: "Dofollow links pass ranking value; nofollow links don't (but still send visitors)." },
          { term: "Spam score", text: "0-100 estimate of how spammy the link profile looks. Above 50 deserves a review; spam links can be disavowed in Google Search Console." },
          { term: "Anchor text", text: "The clickable words of a link. A natural profile is mostly brand names and varied phrases." },
          { term: "Link gap", text: "Websites that link to a competitor but not to you: the best outreach targets." },
        ]} />;

  if (!configured) {
    return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  if (!cache.target) {
    return <>{header}<EmptyState title="No website to analyse yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected, or ask an owner or admin to set it." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  const { target } = cache;
  const summary = cache.get<Summary>("summary");
  const newLost = cache.get<Month[]>("new_lost");
  const history = cache.get<Row[]>("history");
  const deepAt = cache.get("backlinks")?.fetchedAt ?? null;
  const coreAt = summary?.fetchedAt ?? null;
  const controls = (
    <RefreshControls canEdit={canEdit} coreAt={coreAt} deepAt={deepAt} estCore={estimate(TIER1.filter((k) => k !== "history"))} estDeep={estimate(TIER2)} />
  );
  const chrome = (
    <div className="mb-5 space-y-3">
      <TargetSettings canEdit={canEdit} target={target} />
      <SpendLine budget={budget} />
    </div>
  );

  if (!summary) {
    return (
      <>
        {header}{chrome}
        <EmptyState title={`No backlink data for ${target.domain} yet`} body="Nothing is fetched automatically when you open this page. The first analysis costs about 10 cents and is stored; after that it refreshes weekly in the background." />
        <div className="mt-4">{controls}</div>
      </>
    );
  }

  const s = summary.data;
  const series = profileSeries(history?.data, cache.snapshots);
  const month = pointAgo(series, 28);
  const spike = detectLinkSpike(newLost?.data ?? []);
  const pts = (key: "backlinks" | "referring_domains" | "rank"): TrendPoint[] => series.filter((p) => p[key] != null).map((p) => ({ date: p.date, value: p[key] }));
  const nl = (newLost?.data ?? []).filter((m) => m.date);
  const nlPts = (key: keyof Omit<Month, "date">): TrendPoint[] => nl.map((m) => ({ date: m.date!, value: m[key] }));

  const lists = {
    backlinks: cache.get<List>("backlinks"), new: cache.get<List>("new_backlinks"), lost: cache.get<List>("lost_backlinks"),
    domains: cache.get<List>("referring_domains"), anchors: cache.get<List>("anchors"), pages: cache.get<List>("domain_pages"),
  };
  const deep = Boolean(lists.backlinks);
  const changes = cache.get<LinkChanges>("link_changes");
  const dofollowShare = s.backlinks ? ((s.dofollow ?? 0) / s.backlinks) * 100 : null;
  // derived from the stored lists (no extra calls)
  const domRows = (lists.domains?.data.rows ?? []) as Row[];
  const band = (lo: number, hi: number, key: "rank" | "spam") => domRows.filter((d) => typeof d[key] === "number" && (d[key] as number) >= lo && (d[key] as number) <= hi).length;
  const strength = [
    { label: "Strong (rank 300+)", value: band(300, 1000, "rank") }, { label: "Good (100-299)", value: band(100, 299, "rank") },
    { label: "Modest (30-99)", value: band(30, 99, "rank") }, { label: "Weak (0-29)", value: band(0, 29, "rank") },
  ];
  const spamMix = [{ label: "Clean (0-10)", value: band(0, 10, "spam") }, { label: "Watch (11-40)", value: band(11, 40, "spam") }, { label: "Toxic (41+)", value: band(41, 100, "spam") }];
  const brand = target.domain.split(".")[0].replace(/[^a-z0-9]/gi, "").toLowerCase();
  const anchorType = (a: string) => {
    const t = a.trim().toLowerCase(), flat = t.replace(/[^a-z0-9]/g, "");
    if (!t) return "No text (image or empty)";
    if (/https?:|www\.|\.(com|net|org|us)\b/.test(t)) return "Web address";
    if (brand.length > 3 && flat.includes(brand)) return "Brand name";
    if (/^(click here|here|website|visit|read more|more|link|this|source|homepage|home|view|learn more|go to)$/.test(t)) return "Generic";
    return "Keyword or phrase";
  };
  const anchorCounts = new Map<string, number>();
  for (const a of (lists.anchors?.data.rows ?? []) as Row[]) { const k = anchorType(String(a.anchor ?? "")); anchorCounts.set(k, (anchorCounts.get(k) ?? 0) + (Number(a.backlinks) || 0)); }
  const anchorTotal = [...anchorCounts.values()].reduce((x, y) => x + y, 0);
  const anchorMix = [...anchorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, detail: anchorTotal ? `${((value / anchorTotal) * 100).toFixed(0)}%` : undefined }));

  const followDonut = (
    <Donut title="Dofollow vs nofollow" sub="Only dofollow links pass ranking value" center={dofollowShare != null ? `${dofollowShare.toFixed(0)}%` : "—"} centerLabel="dofollow"
      items={[{ label: `Dofollow · ${fmtInt(s.dofollow)}`, value: s.dofollow ?? 0, color: "var(--series)" }, { label: `Nofollow · ${fmtInt(s.nofollow)}`, value: s.nofollow ?? 0, color: "var(--series-prev)" }]} />
  );

  return (
    <>
      {header}{chrome}
      {spike && <div className="mb-5"><SpikeAlert spike={spike} /></div>}

      <section aria-label="Backlink profile" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Domain rank" source="DFS" format={fmtInt} value={s.rank} previous={month?.rank ?? null} hint="DataForSEO domain rank, 0-1000. Higher means a stronger link profile." />
        <KpiCard label="Backlinks" source="DFS" format={fmtInt} value={s.backlinks} previous={month?.backlinks ?? null} />
        <KpiCard label="Referring domains" source="DFS" format={fmtInt} value={s.referring_domains} previous={month?.referring_domains ?? null} />
        <KpiCard label="Referring pages" source="DFS" format={fmtInt} value={s.referring_pages} previous={null} />
        <KpiCard label="Spam score" source="DFS" format={fmtInt} value={s.spam_score} previous={month?.spam ?? null} higherIsBetter={false} hint="0-100 estimate of how spammy the backlink profile looks. Lower is better; above 50 deserves a review." />
      </section>
      <p className="mt-2 text-xs text-muted">
        Overview data updated {coreAt?.slice(0, 10)} · {dofollowShare != null ? `${dofollowShare.toFixed(0)}% dofollow · ` : ""}{fmtInt(s.broken_backlinks)} broken backlinks · first seen {s.first_seen ?? "—"} · comparison is vs about a month ago when history exists.
      </p>
      <div className="mt-3">{controls}</div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MetricTrend title="Link profile over time" source="DFS" options={[
          { key: "backlinks", label: "Backlinks", data: pts("backlinks") },
          { key: "referring_domains", label: "Referring domains", data: pts("referring_domains") },
          { key: "rank", label: "Domain rank", data: pts("rank") },
        ]} />
        <MetricTrend title="New and lost links by month" source="DFS" options={[
          { key: "new_backlinks", label: "New backlinks", data: nlPts("new_backlinks") },
          { key: "lost_backlinks", label: "Lost backlinks", data: nlPts("lost_backlinks") },
          { key: "new_domains", label: "New domains", data: nlPts("new_domains") },
          { key: "lost_domains", label: "Lost domains", data: nlPts("lost_domains") },
        ]} />
      </div>

      {deep && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {followDonut}
          <FillColumns title="Referring domains by strength" sub="Linking domains by their domain rank" valueLabel="Domains"
            bins={strength.map((b, i) => ({ label: b.label.split(" (")[0], value: b.value, detail: b.label, color: `color-mix(in oklab, var(--series) ${100 - i * 18}%, var(--surface))` }))} />
          <Donut title="Spam score of linking domains" sub={`${fmtInt(domRows.length)} referring domains checked`} center={domRows.length ? `${Math.round((spamMix[2].value / domRows.length) * 100)}%` : "—"} centerLabel="toxic (41+)"
            items={spamMix.map((b, i) => ({ label: `${b.label} · ${fmtInt(b.value)}`, value: b.value, color: ["var(--positive)", "var(--warn)", "var(--negative)"][i] }))} />
        </div>
      )}

      {/* the breakdown's length changes with the selected list; the neighbour's columns stretch to match it */}
      <div className={`mt-6 grid gap-4 ${!deep ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : anchorMix.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <Breakdown title="Backlink profile breakdown" sub="Share of all backlinks, as reported by DataForSEO" valueLabel="Backlinks" groups={[
          { key: "attributes", label: "Attributes", items: named(s.attributes, s.backlinks) },
          { key: "types", label: "Link types", items: named(s.types, s.backlinks) },
          { key: "tld", label: "Extensions", items: named(s.tld, s.backlinks) },
          { key: "countries", label: "Countries", items: named(s.countries, s.backlinks) },
          { key: "platforms", label: "Site types", items: named(s.platforms, s.backlinks) },
          { key: "semantic", label: "Placement", items: named(s.semantic, s.backlinks) },
        ]} />
        {!deep ? followDonut : anchorMix.length > 0 && (
          <FillColumns title="Anchor text mix" sub="A natural profile is mostly brand names and varied phrases" valueLabel="Backlinks"
            bins={anchorMix.map((a) => ({ label: a.label, value: a.value, detail: a.detail }))} />
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{fmtInt(s.referring_ips)} referring IPs · {fmtInt(s.referring_main_domains)} main domains</p>

      <section className="mt-8 space-y-3" aria-label="Recent link changes">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Recent link changes</h2>
            <p className="text-sm text-muted">
              {changes
                ? `Checked ${changes.fetchedAt.slice(0, 10)}. Each daily check compares the newest and lost backlinks with the previous check, so a link appears here the day it is first detected. Strong new or lost links also raise an alert on the Overview.`
                : "Once a day the strongest new and lost backlinks are compared with the previous check, so changes appear here the day they're detected. The first check records what exists today."}
            </p>
          </div>
          <LinkChangeCheck canEdit={canEdit} />
        </div>
        {changes && (changes.data.baseline && changes.data.events.length === 0
          ? <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Baseline recorded. Changes will show from the next daily check.</p>
          : changes.data.events.length === 0
            ? <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">No new or lost links in the last 90 days of checks.</p>
            : <ResearchTable title="New and lost links" rows={changes.data.events as unknown as Row[]} columns={[
                { key: "kind", label: "Change", type: "badge" }, { key: "detected", label: "Detected", type: "date" }, { key: "domain", label: "Domain" }, { key: "from", label: "Linking page", type: "url" },
                { key: "anchor", label: "Anchor" }, { key: "rank", label: "Link rank", type: "int" }, { key: "domain_rank", label: "Domain rank", type: "int" }, { key: "spam", label: "Spam", type: "spam" },
                { key: "dofollow", label: "Follow", type: "bool" },
              ]} searchKeys={["domain", "from", "anchor"]} facets={[{ key: "kind", label: "Change" }]} ranges={[{ key: "rank", label: "Link rank" }, { key: "spam", label: "Spam" }]}
                presets={[{ label: "Strong (link rank ≥ 100)", where: [{ key: "rank", op: "gte", value: 100 }] }, SPAM_PRESET]}
                initialSort={{ key: "detected", dir: "desc" }} csvName={`link-changes-${target.domain}`}
                note="Lists the strongest links by rank; very low-value links may not be shown. Backlink databases update continuously but not every day, so some days show no change." />)}
      </section>

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold">Link details</h2>
        {!deep ? (
          <div className="rounded-[10px] border border-dashed border-border p-6 text-sm">
            <p className="font-medium">The detailed lists haven&apos;t been loaded.</p>
            <p className="mt-1 text-muted">The deep dive fetches the backlink list (top 1,000 by rank), new and lost links, referring domains, anchors, linked pages and organic competitors in one go, then stores them for 14 days.</p>
          </div>
        ) : (
          <Tabs label="Backlink lists" items={[
            { key: "backlinks", label: "Backlinks", badge: fmtInt(lists.backlinks!.data.total), content: (
              <ResearchTable title="Backlinks (top 1,000 by rank)" rows={lists.backlinks!.data.rows} columns={BACKLINK_COLS} searchKeys={["from", "anchor", "to", "domain"]}
                ranges={[{ key: "rank", label: "Link rank" }, { key: "domain_rank", label: "Domain rank" }, { key: "spam", label: "Spam" }]}
                presets={[{ label: "Dofollow", where: [{ key: "dofollow", op: "true" }] }, SPAM_PRESET, { label: "Strong (link rank ≥ 100)", where: [{ key: "rank", op: "gte", value: 100 }] }]}
                initialSort={{ key: "rank", dir: "desc" }} note={`Showing ${lists.backlinks!.data.rows.length} of ${fmtInt(lists.backlinks!.data.total)} backlinks in total.`} />) },
            { key: "new", label: "New links", badge: fmtInt(lists.new?.data.total ?? 0), content: (
              <ResearchTable title="New backlinks" rows={lists.new?.data.rows ?? []} columns={BACKLINK_COLS} searchKeys={["from", "anchor", "domain"]} presets={[SPAM_PRESET]} ranges={[{ key: "rank", label: "Link rank" }, { key: "spam", label: "Spam" }]}
                initialSort={{ key: "first_seen", dir: "desc" }} empty="No new backlinks were found." note={`Top ${lists.new?.data.rows.length ?? 0} of ${fmtInt(lists.new?.data.total ?? 0)} new backlinks, by link rank.`} />) },
            { key: "lost", label: "Lost links", badge: fmtInt(lists.lost?.data.total ?? 0), content: (
              <ResearchTable title="Lost backlinks" rows={lists.lost?.data.rows ?? []} columns={BACKLINK_COLS} searchKeys={["from", "anchor", "domain"]} ranges={[{ key: "rank", label: "Link rank" }, { key: "spam", label: "Spam" }]}
                initialSort={{ key: "rank", dir: "desc" }} empty="No lost backlinks were found." />) },
            { key: "domains", label: "Referring domains", badge: fmtInt(lists.domains?.data.total ?? 0), content: (
              <ResearchTable title="Referring domains (top 1,000 by rank)" rows={lists.domains?.data.rows ?? []} columns={REF_COLS} searchKeys={["domain"]} ranges={[{ key: "rank", label: "Rank" }, { key: "backlinks", label: "Backlinks" }, { key: "spam", label: "Spam" }]}
                presets={[SPAM_PRESET, { label: "Strong (rank ≥ 50)", where: [{ key: "rank", op: "gte", value: 50 }] }, { label: "Multiple links (≥ 3)", where: [{ key: "backlinks", op: "gte", value: 3 }] }]}
                initialSort={{ key: "rank", dir: "desc" }} />) },
            { key: "anchors", label: "Anchors", badge: fmtInt(lists.anchors?.data.total ?? 0), content: (
              <ResearchTable title="Anchor texts" rows={lists.anchors?.data.rows ?? []} columns={[
                { key: "anchor", label: "Anchor text" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "domains", label: "Domains", type: "int" },
                { key: "spam", label: "Spam", type: "spam" }, { key: "first_seen", label: "First seen", type: "date" },
              ]} searchKeys={["anchor"]} presets={[SPAM_PRESET]} ranges={[{ key: "backlinks", label: "Backlinks" }, { key: "domains", label: "Domains" }]} initialSort={{ key: "backlinks", dir: "desc" }}
                note="An anchor with thousands of backlinks and a high spam score usually points to a spam campaign." />) },
            { key: "pages", label: "Linked pages", badge: fmtInt(lists.pages?.data.total ?? 0), content: (
              <ResearchTable title="Pages receiving links" rows={lists.pages?.data.rows ?? []} columns={[
                { key: "page", label: "Page", type: "url" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "domains", label: "Domains", type: "int" },
                { key: "rank", label: "Rank", type: "int" }, { key: "status", label: "HTTP status", type: "int" },
              ]} searchKeys={["page"]} presets={[{ label: "Broken (4xx/5xx)", where: [{ key: "status", op: "gte", value: 400 }] }]} initialSort={{ key: "backlinks", dir: "desc" }}
                note="Pages with an error status that still receive links are quick wins: redirect them to a working page." />) },
          ]} />
        )}
      </div>

      <div className="mt-8 space-y-3">
        <h2 className="text-base font-semibold">Link gap</h2>
        <p className="text-sm text-muted">Sites that link to a competitor but not to {target.domain}: the best outreach targets. Each competitor costs about 4 cents once and is stored for 14 days.</p>
        <LinkGapForm canEdit={canEdit} competitors={target.competitors} />
        {cache.gaps.length === 0 ? <p className="text-sm text-muted">No link gap run yet.</p> : (
          <Tabs label="Link gap by competitor" items={cache.gaps.map((g) => ({
            key: g.competitor, label: g.competitor, badge: fmtInt(g.data.total),
            content: <ResearchTable title={`Domains linking to ${g.competitor} but not ${target.domain}`} rows={g.data.rows} columns={[
              { key: "domain", label: "Domain" }, { key: "rank", label: "Rank", type: "int" }, { key: "backlinks", label: "Links to competitor", type: "int" },
              { key: "pages", label: "Linking pages", type: "int" }, { key: "spam", label: "Spam", type: "spam" }, { key: "first_seen", label: "First seen", type: "date" },
            ]} searchKeys={["domain"]} presets={[{ label: "Skip spam (≤ 30)", where: [{ key: "spam", op: "lte", value: 30 }] }]} initialSort={{ key: "rank", dir: "desc" }} />,
          }))} />
        )}
      </div>
    </>
  );
}
