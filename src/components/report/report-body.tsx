import Link from "next/link";
import {
  Activity, BarChart3, CalendarCheck, Eye, Flag, Gauge, Globe, MapPin, MousePointerClick, Navigation, Phone, Search, Sparkles, Target,
  TrendingDown, TrendingUp, Trophy, Users,
} from "lucide-react";
import { MetricTrend } from "@/components/charts/metric-trend";
import { AiInsightsBlock, ClarityBlock, StrategyBlock } from "./ai-sections";
import { fmtDecimal, fmtDuration, fmtInt, fmtPercent, toNum, type Num } from "@/lib/analytics/format";
import { dailySeries } from "@/lib/analytics/trend";
import { monthlyWins, notableDeclines, type Compared, type ReportData } from "@/lib/report/data";
import {
  BarRows, CHAPTER_COLORS, Chapter, Findings, ReportTable, SourceTag, StatTile, TileGrid, Unavailable,
} from "./report-ui";

type Row = Record<string, unknown>;
const pick = (c: Compared, k: string) => (c.current?.has_data ? toNum(c.current[k]) : null);
const prevOf = (c: Compared, k: string) => (c.previous?.has_data ? toNum(c.previous[k]) : null);
const momOf = (c: Compared, k: string) => (c.mom?.has_data ? toNum(c.mom[k]) : null);
const yoyOf = (c: Compared, k: string) => (c.yoy?.has_data ? toNum(c.yoy[k]) : null);
const pct2 = (n: Num) => fmtPercent(n, 2);
const str = (v: unknown) => (v == null ? "—" : String(v));
const num = (v: unknown) => toNum(v);
function urlLabel(u: unknown) {
  try { const x = new URL(String(u)); return `${x.host}${x.pathname}${x.search}`; } catch { return str(u); }
}
function changeText(label: string, cur: Num, base: Num, opts: { lowerIsBetter?: boolean; fmt?: (n: number) => string; basisLabel: string }) {
  if (cur == null || base == null || base === 0) return null;
  const pct = ((cur - base) / Math.abs(base)) * 100;
  const f = opts.fmt ?? ((n: number) => n.toLocaleString("en-US"));
  const dir = Math.abs(pct) < 1 ? "was flat" : pct > 0 ? (opts.lowerIsBetter ? "worsened" : "rose") : (opts.lowerIsBetter ? "improved" : "fell");
  return `${label} ${dir}${Math.abs(pct) >= 1 ? ` ${Math.abs(pct).toFixed(0)}%` : ""} ${opts.basisLabel} (${f(base)} → ${f(cur)}).`;
}

const CH = {
  overall: "Overall Performance & Monthly Wins", traffic: "Website Traffic & Sources", gbp: "Google Business Profile Performance",
  gsc: "Search Console & Keyword Performance", bing: "Bing Search Performance", behavior: "User Behavior & Conversion Analysis",
  ai: "AI SEO Insights", strategy: "30-Day SEO Strategy",
} as const;

/** Chapter titles in order for this report (used for numbering and the PDF contents page). */
export function reportChapters(d: ReportData, executive: boolean): string[] {
  return [
    CH.overall, CH.traffic, CH.gbp, CH.gsc,
    ...(d.bing ? [CH.bing] : []),
    ...(!executive || d.clarity ? [CH.behavior] : []),
    CH.ai, CH.strategy,
  ];
}

export interface ReportOptions {
  /** "dashboard" shows links to detail pages; "print" omits interactive affordances */
  variant: "dashboard" | "print";
  /** shorter executive summary: chapters 01, 02 and 04 headlines only */
  executive?: boolean;
  basisLabel: string;
}

export function ReportBody({ d, opts }: { d: ReportData; opts: ReportOptions }) {
  const g = d.ga4, s = d.gsc, r = d.range;
  const wins = monthlyWins(d);
  const declines = notableDeclines(d);
  const o = d.opportunities;
  const spark = (t: ReportData["ga4Trend"], k: string) => dailySeries(t, k, r).map((p) => p.value);
  const detail = (href: string, label: string) => opts.variant === "dashboard"
    ? <Link href={href} className="text-sm font-medium text-accent hover:underline">{label} →</Link> : null;

  const organic = d.channels.find((c) => c.channel === "Organic Search");
  const ga4Ok = d.connected.ga4 && g.current?.has_data;
  const gscOk = d.connected.gsc && s.current?.has_data;
  const chapters = reportChapters(d, Boolean(opts.executive));
  const no = (t: string) => chapters.indexOf(t) + 1;
  const bg = d.bing;
  const b = d.gbp, gbpOk = d.connected.gbp && b?.current?.has_data;
  const gbpExtrasOk = Boolean(d.gbpReviews || d.gbpRanks.length);

  return (
    <div className="space-y-14">
      {/* ---------------------------------------------------------------- 01 */}
      <Chapter n={no(CH.overall)} id="ch-01" icon={Flag} title="Overall Performance & Monthly Wins"
        subtitle="Headline website, search and local visibility results at a glance"
        sources={[ga4Ok && "Google Analytics 4", gscOk && "Google Search Console", gbpOk && "Google Business Profile", gbpExtrasOk && "Local Brand Manager", bg && "Bing Webmaster Tools"].filter(Boolean) as string[]}>
        {!ga4Ok && !gscOk && !gbpOk && !gbpExtrasOk && !bg?.totals.current?.has_data ? (
          <Unavailable title="No connected data for this period" body="Connect Google Analytics 4 or Search Console on the Integrations page, then run a sync." />
        ) : (
          <TileGrid>
            {ga4Ok && <>
              <StatTile label="Total users" icon={Users} color={CHAPTER_COLORS[0]} source="GA4" format={fmtInt}
                value={pick(g, "users")} previous={prevOf(g, "users")} mom={momOf(g, "users")} yoy={yoyOf(g, "users")} spark={spark(d.ga4Trend, "users")}
                hint="Sum of daily active users." />
              <StatTile label="Sessions" icon={Activity} color={CHAPTER_COLORS[0]} source="GA4" format={fmtInt}
                value={pick(g, "sessions")} previous={prevOf(g, "sessions")} mom={momOf(g, "sessions")} yoy={yoyOf(g, "sessions")} spark={spark(d.ga4Trend, "sessions")} />
              <StatTile label="Engagement rate" icon={Gauge} color={CHAPTER_COLORS[0]} source="GA4" format={fmtPercent}
                value={pick(g, "engagement_rate")} previous={prevOf(g, "engagement_rate")} mom={momOf(g, "engagement_rate")} yoy={yoyOf(g, "engagement_rate")} />
              <StatTile label="Key events" icon={Target} color={CHAPTER_COLORS[0]} source="GA4" format={fmtInt}
                value={pick(g, "key_events")} previous={prevOf(g, "key_events")} mom={momOf(g, "key_events")} yoy={yoyOf(g, "key_events")}
                hint="GA4 key events (formerly conversions). Not the same as leads or calls." />
              {organic && <StatTile label="Organic search sessions" icon={Search} color={CHAPTER_COLORS[0]} source="GA4" format={fmtInt}
                value={organic.sessions} previous={organic.prevSessions} />}
            </>}
            {gscOk && <>
              <StatTile label="Organic clicks" icon={MousePointerClick} color={CHAPTER_COLORS[0]} source="GSC" format={fmtInt}
                value={pick(s, "clicks")} previous={prevOf(s, "clicks")} mom={momOf(s, "clicks")} yoy={yoyOf(s, "clicks")} spark={spark(d.gscTrend, "clicks")} />
              <StatTile label="Search impressions" icon={Eye} color={CHAPTER_COLORS[0]} source="GSC" format={fmtInt}
                value={pick(s, "impressions")} previous={prevOf(s, "impressions")} mom={momOf(s, "impressions")} yoy={yoyOf(s, "impressions")} spark={spark(d.gscTrend, "impressions")} />
              <StatTile label="Average position" icon={TrendingUp} color={CHAPTER_COLORS[0]} source="GSC" format={fmtDecimal} higherIsBetter={false}
                value={pick(s, "position")} previous={prevOf(s, "position")} mom={momOf(s, "position")} yoy={yoyOf(s, "position")}
                hint="Impression-weighted average. Lower is better; not an exact rank." />
              {o && <StatTile label="Keywords improving" icon={TrendingUp} color={CHAPTER_COLORS[0]} source="GSC" format={fmtInt}
                value={o.improving_keywords.length} hint={`Queries whose average position improved by ≥${str(o.thresholds.min_position_change)} with ≥${str(o.thresholds.min_impressions)} impressions in both periods.`} />}
              {o && <StatTile label="Keywords declining" icon={TrendingDown} color={CHAPTER_COLORS[0]} source="GSC" format={fmtInt} higherIsBetter={false}
                value={o.declining_keywords.length} />}
            </>}
            {bg?.totals.current?.has_data && <StatTile label="Bing clicks" icon={Globe} color={CHAPTER_COLORS[0]} source="Bing" format={fmtInt}
              value={pick(bg.totals, "clicks")} previous={prevOf(bg.totals, "clicks")} mom={momOf(bg.totals, "clicks")} yoy={yoyOf(bg.totals, "clicks")} spark={spark(bg.trend, "clicks")} />}
            {gbpOk && <StatTile label="Business Profile views" icon={MapPin} color={CHAPTER_COLORS[0]} source="GBP" format={fmtInt}
              value={pick(b, "impressions")} previous={prevOf(b, "impressions")} mom={momOf(b, "impressions")} yoy={yoyOf(b, "impressions")} spark={spark(d.gbpTrend, "impressions")} />}
            {d.gbpReviews && <StatTile label="Google rating" icon={Trophy} color={CHAPTER_COLORS[0]} source="GBP" format={(v) => (v == null ? "—" : `${v.toFixed(2)} ★`)}
              value={d.gbpReviews.average} hint={`${d.gbpReviews.total} reviews, ${d.gbpReviews.newInRange} new in this period`} />}
          </TileGrid>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <Findings title="Monthly wins" tone="good"
            items={wins.length ? wins.slice(0, 6).map((w) => `${w.text} · ${w.source}`) : ["No metric improved by 10% or more with enough volume to be meaningful."]} />
          <Findings title="Watch list" tone="bad"
            items={declines.length ? declines.slice(0, 6).map((w) => `${w.text} · ${w.source}`) : ["No significant declines (10% or more) this period."]} />
        </div>
        <p className="text-xs text-muted">
          Comparisons are {opts.basisLabel}. A change is a win only if it is at least 10% and based on enough volume.
          Wins and declines are calculated from the data, not written by AI.
        </p>
      </Chapter>

      {/* ---------------------------------------------------------------- 02 */}
      <Chapter n={no(CH.traffic)} id="ch-02" icon={BarChart3} title="Website Traffic & Sources"
        subtitle="How people arrive at the website and what they do first" sources={ga4Ok ? ["Google Analytics 4"] : []}>
        {!ga4Ok ? (
          <Unavailable title="Google Analytics 4 isn't connected or has no data for this period" body="Connect GA4 to see traffic by source, device and landing page." />
        ) : <>
          {!opts.executive && (
            <MetricTrend title="Website traffic over time" source="GA4" expanded={opts.variant === "print"} options={[
              { key: "sessions", label: "Sessions", data: dailySeries(d.ga4Trend, "sessions", r) },
              { key: "users", label: "Users", data: dailySeries(d.ga4Trend, "users", r) },
              { key: "engagement_rate", label: "Engagement", format: "percent", data: dailySeries(d.ga4Trend, "engagement_rate", r, "ratio") },
            ]} />
          )}
          <div>
            <h3 className="mb-2 text-sm font-bold">Sessions by traffic channel</h3>
            <BarRows color={CHAPTER_COLORS[1]} rows={d.channels.map((c) => ({ label: c.channel, value: c.sessions, base: c.prevSessions }))} />
          </div>
          <Findings items={[
            changeText("Sessions", pick(g, "sessions"), prevOf(g, "sessions"), { basisLabel: opts.basisLabel }),
            organic ? changeText("Organic search sessions", organic.sessions, organic.prevSessions, { basisLabel: opts.basisLabel }) : null,
            d.channels[0] ? `${d.channels[0].channel} was the largest channel with ${d.channels[0].sessions.toLocaleString("en-US")} sessions.` : null,
            d.devices.length ? `Device split: ${d.devices.map((x) => `${x.value} ${x.sessions}`).join(", ")} sessions.` : null,
          ].filter((x): x is string => Boolean(x))} />
          {!opts.executive && (
            <ReportTable<Row> title="Top landing pages" source="GA4" empty="No landing page data for this period." rows={d.landingPages.slice(0, 10)}
              columns={[
                { label: "Landing page", render: (x) => <span className="break-all">{str(x.page_path)}</span> },
                { label: "Sessions", align: "right", render: (x) => fmtInt(num(x.sessions)) },
                { label: "Users", align: "right", render: (x) => fmtInt(num(x.users)) },
                { label: "Avg engagement", align: "right", render: (x) => fmtDuration(num(x.avg_engagement_seconds)) },
                { label: "Key events", align: "right", render: (x) => fmtInt(num(x.key_events)) },
              ]} />
          )}
          {detail("/analytics", "Full GA4 analysis")}
        </>}
      </Chapter>

      {/* ---------------------------------------------------------------- 03 */}
      <Chapter n={no(CH.gbp)} id="ch-03" icon={MapPin} title="Google Business Profile Performance"
        subtitle="Local visibility, reviews, map rankings, calls, website visits and direction requests"
        sources={[gbpOk && "Google Business Profile", gbpExtrasOk && "Local Brand Manager"].filter(Boolean) as string[]}>
        {d.gbpCoverage && (
          <p className="text-xs text-muted">
            Daily profile metrics stored from {d.gbpCoverage.first} to {d.gbpCoverage.last}. Google reports them a few days late, and
            history before the first stored day isn&apos;t available from the API.
          </p>
        )}
        {!gbpOk ? (
          <Unavailable title={d.connected.gbp ? "No Business Profile data for this period" : "Google Business Profile isn't connected"}
            body={d.connected.gbp
              ? "The location is connected but Google returned no performance data for this range yet (metrics arrive a few days late, and API access must be approved for the project)."
              : "Connect the Google account that manages the Business Profile on the Integrations page. Profile views (Search and Maps), call clicks, website clicks, direction requests and search keywords will appear here."} />
        ) : <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Profile views" icon={Eye} color={CHAPTER_COLORS[2]} source="GBP" format={fmtInt}
              value={pick(b, "impressions")} previous={prevOf(b, "impressions")} mom={momOf(b, "impressions")} yoy={yoyOf(b, "impressions")} spark={spark(d.gbpTrend, "impressions")} />
            <StatTile label="Website clicks" icon={MousePointerClick} color={CHAPTER_COLORS[2]} source="GBP" format={fmtInt}
              value={pick(b, "website_clicks")} previous={prevOf(b, "website_clicks")} mom={momOf(b, "website_clicks")} yoy={yoyOf(b, "website_clicks")} />
            <StatTile label="Call button clicks" icon={Phone} color={CHAPTER_COLORS[2]} source="GBP" format={fmtInt}
              value={pick(b, "call_clicks")} previous={prevOf(b, "call_clicks")} mom={momOf(b, "call_clicks")} yoy={yoyOf(b, "call_clicks")}
              hint="Taps on the call button, not completed calls." />
            <StatTile label="Direction requests" icon={Navigation} color={CHAPTER_COLORS[2]} source="GBP" format={fmtInt}
              value={pick(b, "direction_requests")} previous={prevOf(b, "direction_requests")} mom={momOf(b, "direction_requests")} yoy={yoyOf(b, "direction_requests")} />
          </div>
          {!opts.executive && (
            <MetricTrend title="Business Profile over time" source="GBP" expanded={opts.variant === "print"} options={[
              { key: "impressions", label: "Views", data: dailySeries(d.gbpTrend, "impressions", r) },
              { key: "website_clicks", label: "Website", data: dailySeries(d.gbpTrend, "website_clicks", r) },
              { key: "call_clicks", label: "Calls", data: dailySeries(d.gbpTrend, "call_clicks", r) },
              { key: "direction_requests", label: "Directions", data: dailySeries(d.gbpTrend, "direction_requests", r) },
            ]} />
          )}
          <div>
            <h3 className="mb-2 text-sm font-bold">Where the profile was seen</h3>
            <BarRows color={CHAPTER_COLORS[2]} rows={[
              { label: "Google Search", value: pick(b, "impressions_search") ?? 0, base: prevOf(b, "impressions_search") },
              { label: "Google Maps", value: pick(b, "impressions_maps") ?? 0, base: prevOf(b, "impressions_maps") },
              { label: "Mobile", value: pick(b, "impressions_mobile") ?? 0, base: prevOf(b, "impressions_mobile") },
              { label: "Desktop", value: pick(b, "impressions_desktop") ?? 0, base: prevOf(b, "impressions_desktop") },
            ].filter((x) => x.value > 0)} />
          </div>
          <Findings items={[
            changeText("Profile views", pick(b, "impressions"), prevOf(b, "impressions"), { basisLabel: opts.basisLabel }),
            changeText("Website clicks from the profile", pick(b, "website_clicks"), prevOf(b, "website_clicks"), { basisLabel: opts.basisLabel }),
            changeText("Call button clicks", pick(b, "call_clicks"), prevOf(b, "call_clicks"), { basisLabel: opts.basisLabel }),
            changeText("Direction requests", pick(b, "direction_requests"), prevOf(b, "direction_requests"), { basisLabel: opts.basisLabel }),
          ].filter((x): x is string => Boolean(x))} />
          {!opts.executive && d.gbpKeywords.length > 0 && (
            <ReportTable<ReportData["gbpKeywords"][number]> title="Searches that showed the profile" source="GBP" empty="No keyword data." rows={d.gbpKeywords}
              columns={[
                { label: "Search term", render: (x) => x.keyword },
                { label: "Impressions", align: "right", render: (x) => (x.impressions != null ? fmtInt(num(x.impressions)) : "< " + fmtInt(num(x.impressions_threshold))) },
              ]} />
          )}
        </>}
          {d.gbpReviews && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Average Google rating" icon={Trophy} color={CHAPTER_COLORS[2]} source="GBP" format={(v) => (v == null ? "—" : `${v.toFixed(2)} ★`)} value={d.gbpReviews.average} />
              <StatTile label="Total reviews" icon={Users} color={CHAPTER_COLORS[2]} source="GBP" format={fmtInt} value={d.gbpReviews.total} />
              <StatTile label="New reviews this period" icon={TrendingUp} color={CHAPTER_COLORS[2]} source="GBP" format={fmtInt} value={d.gbpReviews.newInRange}
                hint={d.gbpReviews.newAverage != null ? `Average ${d.gbpReviews.newAverage.toFixed(1)}★` : undefined} />
              <StatTile label="Owner reply rate" icon={Target} color={CHAPTER_COLORS[2]} source="GBP" format={(v) => fmtPercent(v, 0)} value={d.gbpReviews.replyRate} />
            </div>
          )}
          {d.gbpRanks.length > 0 && (
            <ReportTable<ReportData["gbpRanks"][number]> title="Local map rankings (latest geogrid scan per search term)" source="Local Brand Manager" empty="" rows={d.gbpRanks}
              columns={[
                { label: "Search term", render: (x) => x.term },
                { label: "Scanned", render: (x) => (x.scannedAt ? x.scannedAt.slice(0, 10) : "—") },
                { label: "AGR", align: "right", render: (x) => (x.agr == null ? "—" : x.agr.toFixed(1)) },
                { label: "ATGR", align: "right", render: (x) => (x.atgr == null ? "—" : `${x.atgr.toFixed(1)}${x.prevAtgr != null ? ` (was ${x.prevAtgr.toFixed(1)})` : ""}`) },
                { label: "SoLV", align: "right", render: (x) => (x.solv == null ? "—" : `${fmtPercent(x.solv, 0)}${x.prevSolv != null ? ` (was ${fmtPercent(x.prevSolv, 0)})` : ""}`) },
              ]} />
          )}
          {d.gbpRanks.length > 0 && <p className="text-xs text-muted">AGR: average rank where the business appears. ATGR: average over every grid point, counting &quot;not in top 20&quot; as 21 (lower is better). SoLV: share of grid points in the top 3 (higher is better).</p>}
          {d.gbpRecentReviews.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold">Latest reviews</h3>
              <ul className="grid gap-3 md:grid-cols-2">
                {d.gbpRecentReviews.map((r, i) => (
                  <li key={i} className="report-avoid-break rounded-lg border border-border p-3 text-sm">
                    <p className="text-xs text-muted">{r.rating != null ? "★".repeat(r.rating) + "☆".repeat(5 - r.rating) : ""} · {r.reviewer ?? "Google user"} · {r.date ?? ""}</p>
                    <p className="mt-1">{r.text.length > 320 ? `${r.text.slice(0, 320)}…` : r.text}</p>
                    {r.reply && <p className="mt-1 text-xs text-muted">Owner replied.</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        {(gbpOk || gbpExtrasOk) && detail("/business-profile", "Full Business Profile analysis")}
      </Chapter>

      {/* ---------------------------------------------------------------- 04 */}
      <Chapter n={no(CH.gsc)} id="ch-04" icon={Search} title="Search Console & Keyword Performance"
        subtitle="Organic visibility, keyword movement and SEO opportunities" sources={gscOk ? ["Google Search Console"] : []}>
        {!gscOk ? (
          <Unavailable title="Search Console isn't connected or has no data for this period" body="Connect Search Console to see clicks, impressions, CTR, position and keyword opportunities." />
        ) : <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Total clicks" icon={MousePointerClick} color={CHAPTER_COLORS[3]} source="GSC" format={fmtInt}
              value={pick(s, "clicks")} previous={prevOf(s, "clicks")} mom={momOf(s, "clicks")} yoy={yoyOf(s, "clicks")} />
            <StatTile label="Impressions" icon={Eye} color={CHAPTER_COLORS[3]} source="GSC" format={fmtInt}
              value={pick(s, "impressions")} previous={prevOf(s, "impressions")} mom={momOf(s, "impressions")} yoy={yoyOf(s, "impressions")} />
            <StatTile label="Average CTR" icon={Target} color={CHAPTER_COLORS[3]} source="GSC" format={pct2}
              value={pick(s, "ctr")} previous={prevOf(s, "ctr")} mom={momOf(s, "ctr")} yoy={yoyOf(s, "ctr")} hint="Total clicks ÷ total impressions." />
            <StatTile label="Average position" icon={TrendingUp} color={CHAPTER_COLORS[3]} source="GSC" format={fmtDecimal} higherIsBetter={false}
              value={pick(s, "position")} previous={prevOf(s, "position")} mom={momOf(s, "position")} yoy={yoyOf(s, "position")} />
          </div>
          {!opts.executive && (
            <MetricTrend title="Organic search over time" source="GSC" expanded={opts.variant === "print"} options={[
              { key: "clicks", label: "Clicks", data: dailySeries(d.gscTrend, "clicks", r) },
              { key: "impressions", label: "Impressions", data: dailySeries(d.gscTrend, "impressions", r) },
              { key: "position", label: "Position", format: "decimal", reverseY: true, data: dailySeries(d.gscTrend, "position", r, "ratio") },
            ]} />
          )}
          <Findings items={[
            changeText("Organic clicks", pick(s, "clicks"), prevOf(s, "clicks"), { basisLabel: opts.basisLabel }),
            changeText("Impressions", pick(s, "impressions"), prevOf(s, "impressions"), { basisLabel: opts.basisLabel }),
            changeText("Average position", pick(s, "position"), prevOf(s, "position"), { basisLabel: opts.basisLabel, lowerIsBetter: true, fmt: (n) => n.toFixed(1) }),
          ].filter((x): x is string => Boolean(x))} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ReportTable<Row> title="Top search queries" source="GSC" empty="No query data for this period." rows={d.topQueries.slice(0, opts.executive ? 5 : 10)}
              columns={[
                { label: "Query", render: (x) => str(x.query) },
                { label: "Clicks", align: "right", render: (x) => fmtInt(num(x.clicks)) },
                { label: "Impr.", align: "right", render: (x) => fmtInt(num(x.impressions)) },
                { label: "Position", align: "right", render: (x) => fmtDecimal(num(x.position)) },
              ]} />
            <ReportTable<Row> title="Top pages" source="GSC" empty="No page data for this period." rows={d.topPages.slice(0, opts.executive ? 5 : 10)}
              columns={[
                { label: "Page", render: (x) => <span className="break-all">{urlLabel(x.page)}</span> },
                { label: "Clicks", align: "right", render: (x) => fmtInt(num(x.clicks)) },
                { label: "Impr.", align: "right", render: (x) => fmtInt(num(x.impressions)) },
              ]} />
          </div>

          {!o ? (
            <Unavailable title="Keyword opportunity analysis is being set up"
              body="Improving and declining keywords, new queries, decaying pages, possible cannibalization and quick wins appear once the latest database update is applied and Search Console has re-synced." />
          ) : !opts.executive && <>
            <div className="grid gap-6 lg:grid-cols-2">
              <ReportTable<Row> title="Keywords moved up" source="GSC" empty="No keyword improved by a full position with enough impressions."
                rows={o.improving_keywords.slice(0, 8)} columns={[
                  { label: "Keyword", render: (x) => str(x.query) },
                  { label: "Prior", align: "right", render: (x) => fmtDecimal(num(x.previous_position)) },
                  { label: "Now", align: "right", render: (x) => fmtDecimal(num(x.current_position)) },
                  { label: "Change", align: "right", render: (x) => <span className="font-semibold text-positive">↑ {fmtDecimal(num(x.position_change))}</span> },
                ]} />
              <ReportTable<Row> title="Keywords losing positions" source="GSC" empty="No keyword lost a full position with enough impressions."
                rows={o.declining_keywords.slice(0, 8)} columns={[
                  { label: "Keyword", render: (x) => str(x.query) },
                  { label: "Prior", align: "right", render: (x) => fmtDecimal(num(x.previous_position)) },
                  { label: "Now", align: "right", render: (x) => fmtDecimal(num(x.current_position)) },
                  { label: "Change", align: "right", render: (x) => <span className="font-semibold text-negative">↓ {fmtDecimal(num(x.position_change))}</span> },
                ]} />
            </div>
            <ReportTable<Row> title="New search queries" source="GSC"
              empty="No queries appeared that had no impressions in the previous period."
              rows={o.new_queries.slice(0, 10)} columns={[
                { label: "Query", render: (x) => str(x.query) },
                { label: "Type", render: (x) => (x.kind === "newly_clicked" ? "Newly clicked" : "Newly observed") },
                { label: "Impr.", align: "right", render: (x) => fmtInt(num(x.impressions)) },
                { label: "Clicks", align: "right", render: (x) => fmtInt(num(x.clicks)) },
                { label: "Position", align: "right", render: (x) => fmtDecimal(num(x.position)) },
              ]} />
            <ReportTable<Row> title="Quick wins: visible but under-clicked" source="GSC"
              empty="No queries in positions 4–20 with enough impressions."
              rows={o.quick_wins.slice(0, 10)} columns={[
                { label: "Query", render: (x) => str(x.query) },
                { label: "Ranking page", render: (x) => <span className="break-all">{x.page ? urlLabel(x.page) : "—"}</span> },
                { label: "Impr.", align: "right", render: (x) => fmtInt(num(x.impressions)) },
                { label: "CTR", align: "right", render: (x) => pct2(num(x.ctr)) },
                { label: "Position", align: "right", render: (x) => fmtDecimal(num(x.position)) },
                { label: "Score", align: "right", render: (x) => fmtDecimal(num(x.score)) },
              ]} />
            <div className="grid gap-6 lg:grid-cols-2">
              <ReportTable<Row> title="Decaying pages" source="GSC" empty="No page lost 20%+ of its clicks (with at least 3 clicks before)."
                rows={o.decaying_pages.slice(0, 8)} columns={[
                  { label: "Page", render: (x) => <span className="break-all">{urlLabel(x.page)}</span> },
                  { label: "Clicks before → now", align: "right", render: (x) => `${fmtInt(num(x.previous_clicks))} → ${fmtInt(num(x.current_clicks))}` },
                  { label: "Change", align: "right", render: (x) => <span className="text-negative">{fmtDecimal(num(x.clicks_change_pct))}%</span> },
                ]} />
              <ReportTable<Row> title="Possible keyword cannibalization" source="GSC"
                empty={o.has_query_page_data ? "No query split its impressions across two or more pages." : "Needs query × page data from the next Search Console sync."}
                rows={o.cannibalization.slice(0, 8)} columns={[
                  { label: "Query", render: (x) => str(x.query) },
                  { label: "Pages", align: "right", render: (x) => fmtInt(num(x.pages)) },
                  { label: "Impr.", align: "right", render: (x) => fmtInt(num(x.impressions)) },
                ]} />
            </div>
            <p className="text-xs text-muted">
              Methodology: current period vs the equal-length previous period, Web search, rates re-weighted from totals.
              Average position is impression-weighted, not an exact rank. &quot;New&quot; queries are new within the stored
              Search Console history only. Multiple pages ranking for one query can be normal; cannibalization is flagged
              as possible, not confirmed. Quick-win score = impressions × (10% target CTR − current CTR), a transparent
              prioritisation aid, not a forecast.
            </p>
          </>}
          {detail("/search-console", "Full Search Console analysis")}
        </>}
      </Chapter>


      {/* ---------------------------------------------------------------- Bing */}
      {bg && (
        <Chapter n={no(CH.bing)} id="ch-bing" icon={Globe} title={CH.bing}
          subtitle="Clicks, impressions, rankings and crawl health in Bing search" sources={["Bing Webmaster Tools"]}>
          {!bg.totals.current?.has_data ? (
            <Unavailable title="No Bing data for this period" body={`Bing data is stored from ${bg.coverage?.first ?? "?"} to ${bg.coverage?.last ?? "?"}.`} />
          ) : <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Bing clicks" icon={MousePointerClick} color={CHAPTER_COLORS[4]} source="Bing" format={fmtInt}
                value={pick(bg.totals, "clicks")} previous={prevOf(bg.totals, "clicks")} mom={momOf(bg.totals, "clicks")} yoy={yoyOf(bg.totals, "clicks")} spark={spark(bg.trend, "clicks")} />
              <StatTile label="Bing impressions" icon={Eye} color={CHAPTER_COLORS[4]} source="Bing" format={fmtInt}
                value={pick(bg.totals, "impressions")} previous={prevOf(bg.totals, "impressions")} mom={momOf(bg.totals, "impressions")} yoy={yoyOf(bg.totals, "impressions")} spark={spark(bg.trend, "impressions")} />
              <StatTile label="Bing CTR" icon={Target} color={CHAPTER_COLORS[4]} source="Bing" format={pct2}
                value={pick(bg.totals, "ctr")} previous={prevOf(bg.totals, "ctr")} mom={momOf(bg.totals, "ctr")} yoy={yoyOf(bg.totals, "ctr")} />
              <StatTile label="Bing average position" icon={TrendingUp} color={CHAPTER_COLORS[4]} source="Bing" format={fmtDecimal} higherIsBetter={false}
                value={pick(bg.totals, "position")} previous={prevOf(bg.totals, "position")} mom={momOf(bg.totals, "position")} yoy={yoyOf(bg.totals, "position")}
                hint="Impression-weighted average of Bing's weekly query positions. Lower is better." />
            </div>
            {!opts.executive && (
              <MetricTrend title="Bing search over time" source="Bing" expanded={opts.variant === "print"} options={[
                { key: "clicks", label: "Clicks", data: dailySeries(bg.trend, "clicks", r) },
                { key: "impressions", label: "Impressions", data: dailySeries(bg.trend, "impressions", r) },
                { key: "ctr", label: "CTR", format: "percent", data: dailySeries(bg.trend, "ctr", r, "ratio") },
              ]} />
            )}
            {gscOk && (
              <ReportTable<{ metric: string; google: string; bing: string }> title="Google vs Bing (this period)" source="GSC · Bing" empty="" rows={[
                { metric: "Clicks", google: fmtInt(pick(s, "clicks")), bing: fmtInt(pick(bg.totals, "clicks")) },
                { metric: "Impressions", google: fmtInt(pick(s, "impressions")), bing: fmtInt(pick(bg.totals, "impressions")) },
                { metric: "CTR", google: pct2(pick(s, "ctr")), bing: pct2(pick(bg.totals, "ctr")) },
                { metric: "Average position", google: fmtDecimal(pick(s, "position")), bing: fmtDecimal(pick(bg.totals, "position")) },
              ]} columns={[
                { label: "Metric", render: (x) => x.metric }, { label: "Google", align: "right", render: (x) => x.google }, { label: "Bing", align: "right", render: (x) => x.bing },
              ]} />
            )}
            <Findings items={[
              changeText("Bing clicks", pick(bg.totals, "clicks"), prevOf(bg.totals, "clicks"), { basisLabel: opts.basisLabel }),
              changeText("Bing impressions", pick(bg.totals, "impressions"), prevOf(bg.totals, "impressions"), { basisLabel: opts.basisLabel }),
              bg.crawl ? `Bing has ${fmtInt(bg.crawl.inIndex)} pages in its index and counts ${fmtInt(bg.crawl.inLinks)} inbound links; it crawled ${fmtInt(bg.crawl.crawled)} pages with ${fmtInt(bg.crawl.errors)} crawl errors in this period.` : null,
            ].filter((x): x is string => Boolean(x))} />
            {!opts.executive && (
              <ReportTable<Row> title="Top Bing queries" source="Bing" empty="No query data for this period." rows={bg.queries}
                columns={[
                  { label: "Query", render: (x) => <span className="break-words">{str(x.query)}</span> },
                  { label: "Clicks", align: "right", render: (x) => fmtInt(num(x.clicks)) },
                  { label: "Impressions", align: "right", render: (x) => fmtInt(num(x.impressions)) },
                  { label: "CTR", align: "right", render: (x) => pct2(num(x.ctr)) },
                  { label: "Position", align: "right", render: (x) => fmtDecimal(num(x.position)) },
                ]} />
            )}
            {!opts.executive && (
              <ReportTable<Row> title="Top Bing pages" source="Bing" empty="No page data for this period." rows={bg.pages}
                columns={[
                  { label: "Page", render: (x) => <span className="break-all">{urlLabel(x.page)}</span> },
                  { label: "Clicks", align: "right", render: (x) => fmtInt(num(x.clicks)) },
                  { label: "Impressions", align: "right", render: (x) => fmtInt(num(x.impressions)) },
                  { label: "Position", align: "right", render: (x) => fmtDecimal(num(x.position)) },
                ]} />
            )}
            <p className="text-xs text-muted">Bing reports query and page statistics in weekly buckets; weeks starting inside the period are included.</p>
          </>}
          {detail("/bing", "Full Bing analysis")}
        </Chapter>
      )}

      {/* ---------------------------------------------------------------- 05 */}
      {(!opts.executive || d.clarity) && (
        <Chapter n={no(CH.behavior)} id="ch-05" icon={Activity} title="User Behavior & Conversion Analysis"
          subtitle="Landing page engagement, key events and behavioural evidence"
          sources={[ga4Ok && !opts.executive && "Google Analytics 4", d.clarity && "Microsoft Clarity"].filter(Boolean) as string[]}>
          {ga4Ok && !opts.executive && (
            <ReportTable<{ value: string; key_events: number }> title="Key events by event name" source="GA4"
              empty="No key events were recorded in this period. Mark meaningful actions (e.g. form_submit) as key events in GA4; counting starts from the moment they are marked."
              rows={d.keyEvents} columns={[
                { label: "Event", render: (x) => x.value },
                { label: "Key events", align: "right", render: (x) => fmtInt(num(x.key_events)) },
              ]} />
          )}
          <ClarityBlock d={d} />
          {!opts.executive && <>
            <Unavailable title="Funnel drop-off can't be measured yet"
              body="Exact drop-off rates need each funnel step tracked as a GA4 event (for example: view_service → click_cta → form_start → form_submit). Until then, this report doesn't show a conversion funnel." />
            <p className="text-xs text-muted">404 monitoring needs either a GA4 event for error pages or verified page titles; it is not inferred from URLs.</p>
          </>}
        </Chapter>
      )}

      {/* ---------------------------------------------------------------- 06/07 */}
      <Chapter n={no(CH.ai)} id="ch-06" icon={Sparkles} title="AI SEO Insights"
        subtitle="Evidence-based interpretation of the data above">
        <AiInsightsBlock d={d} linked={opts.variant === "dashboard"} />
      </Chapter>
      <Chapter n={no(CH.strategy)} id="ch-07" icon={CalendarCheck} title="30-Day SEO Strategy"
        subtitle="Prioritised plan for the next month">
        <StrategyBlock d={d} linked={opts.variant === "dashboard"} fallback={<>
        {o && o.quick_wins.length + o.declining_keywords.length + o.decaying_pages.length > 0 ? (
          <Findings title="Evidence-based starting points (deterministic)" items={[
            ...o.quick_wins.slice(0, 3).map((x) => `Improve the title and description for "${str(x.query)}"${x.page ? ` on ${urlLabel(x.page)}` : ""}: ${fmtInt(num(x.impressions))} impressions at position ${fmtDecimal(num(x.position))} but ${pct2(num(x.ctr))} CTR.`),
            ...o.declining_keywords.slice(0, 2).map((x) => `Review "${str(x.query)}": average position moved from ${fmtDecimal(num(x.previous_position))} to ${fmtDecimal(num(x.current_position))}.`),
            ...o.decaying_pages.slice(0, 2).map((x) => `Refresh ${urlLabel(x.page)}: clicks ${fmtInt(num(x.previous_clicks))} → ${fmtInt(num(x.current_clicks))}.`),
          ]} />
        ) : (
          <Unavailable title="Not enough evidence for a strategy yet"
            body="A full week-by-week plan is generated with AI from the evidence in this report once AI analysis is configured." />
        )}
        </>} />
        <p className="text-xs text-muted">No ranking or revenue outcome is guaranteed; each action lists the metric that will show whether it worked.</p>
      </Chapter>

      <footer className="border-t border-border pt-6 text-xs text-muted">
        <p className="flex items-center gap-1.5"><Trophy className="size-3.5" aria-hidden /> Figures come directly from connected Google APIs and are never estimated. Unavailable data is labelled, never shown as zero.</p>
        <p className="mt-1 flex items-center gap-1.5"><Globe className="size-3.5" aria-hidden /> GA4 dates use the property&apos;s time zone; Search Console dates are Pacific Time. GA4 users are summed daily active users.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{ga4Ok && <SourceTag>Google Analytics 4 API</SourceTag>}{gscOk && <SourceTag>Google Search Console API</SourceTag>}{gbpOk && <SourceTag>Business Profile Performance API</SourceTag>}{gbpExtrasOk && <SourceTag>Local Brand Manager API</SourceTag>}{bg && <SourceTag>Bing Webmaster Tools API</SourceTag>}{d.clarity && <SourceTag>Microsoft Clarity Data Export API</SourceTag>}</div>
      </footer>
    </div>
  );
}
