import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNum } from "@/lib/analytics/format";
import { monthlyWins, notableDeclines, type Compared, type ReportData } from "@/lib/report/data";

export interface EvidenceItem { id: string; source: string; label: string; value: string; detail?: string }
export interface EvidencePackage {
  period: { start: string; end: string; comparison: string };
  items: EvidenceItem[];
  /** sources that are not connected, so the model knows what it cannot say */
  unavailable: string[];
}

const f = (n: number | null, digits = 0) => (n == null ? "unavailable" : n.toLocaleString("en-US", { maximumFractionDigits: digits }));
const pct = (n: number | null) => (n == null ? "unavailable" : `${(n * 100).toFixed(2)}%`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);

/**
 * Builds the evidence package the AI is allowed to use. Every number here comes from stored,
 * API-derived data (or explicitly accepted imported figures, labelled as such). Each item has a
 * stable id the model must cite; recommendations citing unknown ids are discarded.
 */
export async function buildEvidence(
  admin: SupabaseClient, clientId: string, d: ReportData,
): Promise<EvidencePackage> {
  const items: EvidenceItem[] = [];
  const add = (id: string, source: string, label: string, value: string, detail?: string) => items.push({ id, source, label, value, detail });
  const kpis = (prefix: string, source: string, c: Compared, keys: [string, string, "n" | "pct" | "dec"][]) => {
    for (const [k, label, kind] of keys) {
      const fmt = (t: Compared["current"]) => {
        const v = t?.has_data ? toNum(t[k]) : null;
        return kind === "pct" ? pct(v) : f(v, kind === "dec" ? 1 : 0);
      };
      add(`${prefix}.${k}.current`, source, `${label} (this period)`, fmt(c.current));
      add(`${prefix}.${k}.previous`, source, `${label} (previous period)`, fmt(c.previous));
      if (c.yoy?.has_data) add(`${prefix}.${k}.yoy`, source, `${label} (same period last year)`, fmt(c.yoy));
    }
  };

  if (d.connected.ga4) {
    kpis("ga4", "GA4", d.ga4, [
      ["users", "Users (sum of daily active users)", "n"], ["sessions", "Sessions", "n"],
      ["engagement_rate", "Engagement rate", "pct"], ["key_events", "Key events", "n"],
      ["avg_engagement_seconds", "Average engagement time per user (seconds)", "dec"],
    ]);
    for (const c of d.channels) add(`ga4.channel.${slug(c.channel)}`, "GA4", `Sessions from ${c.channel}`,
      `${c.sessions} (previous period ${c.prevSessions ?? "n/a"})`, c.engagementRate != null ? `engagement rate ${pct(c.engagementRate)}` : undefined);
    for (const x of d.devices) add(`ga4.device.${slug(x.value)}`, "GA4", `Sessions on ${x.value}`, String(x.sessions));
    for (const p of d.landingPages.slice(0, 10)) add(`ga4.landing.${slug(String(p.page_path))}`, "GA4", `Landing page ${p.page_path}`,
      `${p.sessions} sessions`, `avg engagement ${f(toNum(p.avg_engagement_seconds), 0)}s per user, ${p.key_events} key events`);
    for (const e of d.keyEvents) add(`ga4.key_event.${slug(e.value)}`, "GA4", `Key event ${e.value}`, String(e.key_events));
    if (d.keyEvents.length === 0) add("ga4.key_events.none", "GA4", "Key events recorded", "none in this period");
  }
  if (d.connected.gsc) {
    kpis("gsc", "Search Console", d.gsc, [
      ["clicks", "Organic clicks (web)", "n"], ["impressions", "Impressions (web)", "n"],
      ["ctr", "CTR", "pct"], ["position", "Average position (impression-weighted)", "dec"],
    ]);
    for (const q of d.topQueries.slice(0, 10)) add(`gsc.query.${slug(String(q.query))}`, "Search Console", `Query "${q.query}"`,
      `${q.clicks} clicks, ${q.impressions} impressions, position ${f(toNum(q.position), 1)}`);
    for (const p of d.topPages.slice(0, 10)) add(`gsc.page.${slug(String(p.page))}`, "Search Console", `Page ${p.page}`,
      `${p.clicks} clicks, ${p.impressions} impressions`);
    const o = d.opportunities;
    if (o) {
      o.quick_wins.slice(0, 10).forEach((x, i) => add(`gsc.quick_win.${i + 1}`, "Search Console", `Quick win "${x.query}"`,
        `${x.impressions} impressions, CTR ${pct(toNum(x.ctr))}, position ${x.position}`, x.page ? `ranking page ${x.page}` : undefined));
      o.declining_keywords.slice(0, 10).forEach((x, i) => add(`gsc.declining.${i + 1}`, "Search Console", `Declining keyword "${x.query}"`,
        `position ${x.previous_position} → ${x.current_position}`, x.page ? `page ${x.page}` : undefined));
      o.improving_keywords.slice(0, 10).forEach((x, i) => add(`gsc.improving.${i + 1}`, "Search Console", `Improving keyword "${x.query}"`,
        `position ${x.previous_position} → ${x.current_position}`));
      o.decaying_pages.slice(0, 10).forEach((x, i) => add(`gsc.decaying.${i + 1}`, "Search Console", `Decaying page ${x.page}`,
        `clicks ${x.previous_clicks} → ${x.current_clicks}`));
      o.new_queries.slice(0, 10).forEach((x, i) => add(`gsc.new_query.${i + 1}`, "Search Console", `New query "${x.query}"`,
        `${x.impressions} impressions, ${x.clicks} clicks, position ${x.position}`, x.page ? `page ${x.page}` : undefined));
      o.cannibalization.slice(0, 10).forEach((x, i) => add(`gsc.cannibalization.${i + 1}`, "Search Console", `Possible cannibalization "${x.query}"`,
        `${x.pages} pages share ${x.impressions} impressions`, JSON.stringify(x.detail).slice(0, 400)));
    }
  }
  if (d.connected.gbp && d.gbp?.current?.has_data) {
    kpis("gbp", "Business Profile", d.gbp, [
      ["impressions", "Profile views (Search + Maps)", "n"], ["impressions_search", "Profile views on Google Search", "n"],
      ["impressions_maps", "Profile views on Google Maps", "n"], ["impressions_mobile", "Profile views on mobile", "n"],
      ["impressions_desktop", "Profile views on desktop", "n"], ["website_clicks", "Website clicks from the profile", "n"],
      ["call_clicks", "Call button clicks (not completed calls)", "n"], ["direction_requests", "Direction requests", "n"],
    ]);
    d.gbpKeywords.slice(0, 15).forEach((k, i) => add(`gbp.keyword.${i + 1}`, "Business Profile", `Search term "${k.keyword}" showed the profile`,
      k.impressions != null ? `${k.impressions} impressions` : `fewer than ${k.impressions_threshold} impressions`, "monthly figure, months overlapping the period"));
  }
  if (d.bing?.totals.current?.has_data) {
    kpis("bing", "Bing Webmaster Tools", d.bing.totals, [
      ["clicks", "Bing organic clicks", "n"], ["impressions", "Bing impressions", "n"], ["ctr", "Bing CTR", "pct"],
      ["position", "Bing average position (impression-weighted, weekly buckets)", "dec"],
    ]);
    d.bing.queries.slice(0, 10).forEach((q, i) => add(`bing.query.${i + 1}`, "Bing Webmaster Tools", `Bing query "${q.query}"`,
      `${q.clicks} clicks, ${q.impressions} impressions, position ${f(toNum(q.position), 1)}`));
    d.bing.pages.slice(0, 10).forEach((p, i) => add(`bing.page.${i + 1}`, "Bing Webmaster Tools", `Bing page ${p.page}`, `${p.clicks} clicks, ${p.impressions} impressions`));
    if (d.bing.crawl) add("bing.crawl", "Bing Webmaster Tools", "Bing index and crawl", `${d.bing.crawl.inIndex ?? "n/a"} pages indexed, ${d.bing.crawl.inLinks ?? "n/a"} inbound links`,
      `${d.bing.crawl.crawled} pages crawled and ${d.bing.crawl.errors} crawl errors over ${d.bing.crawl.days} days`);
  }
  if (d.gbpReviews) {
    add("gbp.reviews.total", "Business Profile", "Total Google reviews", String(d.gbpReviews.total));
    add("gbp.reviews.average", "Business Profile", "Average Google rating (all reviews)", d.gbpReviews.average?.toFixed(2) ?? "n/a");
    add("gbp.reviews.new", "Business Profile", "New reviews in this period", String(d.gbpReviews.newInRange),
      d.gbpReviews.newAverage != null ? `average ${d.gbpReviews.newAverage.toFixed(1)} stars` : undefined);
    add("gbp.reviews.reply_rate", "Business Profile", "Share of reviews with an owner reply", pct(d.gbpReviews.replyRate));
  }
  d.gbpRanks.forEach((g, i) => add(`gbp.rank.${i + 1}`, "Local Brand Manager geogrid", `Local map rank for "${g.term}" (${g.scannedAt?.slice(0, 10) ?? "?"})`,
    `ATGR ${g.atgr ?? "n/a"}, AGR ${g.agr ?? "n/a"}, SoLV ${g.solv == null ? "n/a" : pct(g.solv)}`,
    g.prevAtgr != null ? `previous scan ATGR ${g.prevAtgr}, SoLV ${g.prevSolv == null ? "n/a" : pct(g.prevSolv)}; lower ATGR and higher SoLV are better` : "lower ATGR and higher SoLV are better"));
  monthlyWins(d).forEach((w, i) => add(`derived.win.${i + 1}`, w.source, "Calculated improvement", w.text));
  notableDeclines(d).forEach((w, i) => add(`derived.decline.${i + 1}`, w.source, "Calculated decline", w.text));

  // Clarity aggregates (latest 7 stored days) and human recording reviews
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: clarity }, { data: reviews }, { data: imported }] = await Promise.all([
    admin.from("clarity_behavior_metrics").select("metric_date, dimension, value, metric, count, sessions_pct")
      .eq("client_id", clientId).gte("metric_date", since).in("dimension", ["total", "url"]).limit(400),
    admin.from("clarity_recording_reviews").select("id, page_url, device, friction_type, severity, observation, observed_on")
      .eq("client_id", clientId).order("created_at", { ascending: false }).limit(30),
    admin.from("imported_report_metrics").select("id, original_label, value_text, source_name, period_start, period_end, imported_reports!inner(file_name)")
      .eq("client_id", clientId).eq("review_status", "accepted").limit(60),
  ]);
  for (const r of clarity ?? []) add(`clarity.${r.metric_date}.${r.dimension}.${slug(r.value || "all")}.${slug(r.metric)}`, "Microsoft Clarity",
    `${r.metric}${r.dimension === "url" ? ` on ${r.value}` : ""} (${r.metric_date})`,
    `${r.count ?? "n/a"}${r.sessions_pct != null ? ` (${r.sessions_pct}% of sessions)` : ""}`);
  for (const r of reviews ?? []) add(`review.${r.id}`, "Recording review (human observation)",
    `${r.friction_type} on ${r.page_url}${r.device ? ` (${r.device})` : ""}`, `${r.severity} severity`, r.observation);
  for (const r of imported ?? []) add(`imported.${r.id}`, `Imported report (${(r as { imported_reports?: { file_name?: string } }).imported_reports?.file_name ?? "PDF"})`,
    r.original_label, r.value_text ?? "", `${r.source_name ?? "unknown source"}, ${r.period_start ?? "?"}–${r.period_end ?? "?"}; not API-verified`);

  const unavailable = [
    !d.connected.ga4 && "Google Analytics 4",
    !d.connected.gsc && "Google Search Console",
    !(d.connected.gbp && d.gbp?.current?.has_data) && "Google Business Profile (not connected or no data: no local metrics)",
    !(clarity ?? []).length && "Microsoft Clarity behaviour metrics",
    !(reviews ?? []).length && "Session recording observations",
    "Funnel steps (not instrumented as GA4 events)",
  ].filter(Boolean) as string[];

  return { period: { start: d.range.start, end: d.range.end, comparison: "previous period of equal length" }, items, unavailable };
}

export function evidenceText(p: EvidencePackage): string {
  return [
    `Reporting period: ${p.period.start} to ${p.period.end} (comparison: ${p.period.comparison}).`,
    "",
    "EVIDENCE (id | source | label | value | detail):",
    ...p.items.map((i) => `${i.id} | ${i.source} | ${i.label} | ${i.value}${i.detail ? ` | ${i.detail}` : ""}`),
    "",
    "NOT AVAILABLE (do not make claims about these):",
    ...p.unavailable.map((u) => `- ${u}`),
  ].join("\n");
}
