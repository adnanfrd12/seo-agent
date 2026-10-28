import { toNum } from "@/lib/analytics/format";
import type { Compared, ReportData } from "@/lib/report/data";

/**
 * Two transparent summaries of the Overview, both computed only from stored data:
 *
 * 1. Growth Index (0-100, 50 = unchanged). Direction of travel: each available metric is compared with the
 *    previous period of equal length and mapped linearly: score = 50 + 2.5 x (% change), so +20% = 100 and
 *    -20% = 0 (inverted for average position, where lower is better). The index is the weighted average of the
 *    metrics that have enough volume; weights are re-balanced over the metrics available. It says nothing about
 *    absolute quality or Google ranking factors, only whether things are moving up or down.
 * 2. Health checks. Pass / watch / fix against fixed guideline thresholds shown with each check.
 */
export interface GrowthFactor { key: string; label: string; source: string; current: number; previous: number; changePct: number; score: number; weight: number; lowerIsBetter?: boolean }
export interface Growth { score: number; band: "Growing" | "Steady" | "Declining"; factors: GrowthFactor[]; used: number }

const val = (c: Compared | undefined | null, key: string, which: "current" | "previous" = "current") =>
  c?.[which]?.has_data ? toNum(c[which][key]) : null;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function computeGrowth(d: ReportData): Growth | null {
  const defs: { key: string; label: string; source: string; cur: number | null; prev: number | null; weight: number; minBase: number; lowerIsBetter?: boolean }[] = [];
  if (d.connected.gsc) {
    defs.push({ key: "gsc_clicks", label: "Search clicks", source: "Search Console", cur: val(d.gsc, "clicks"), prev: val(d.gsc, "clicks", "previous"), weight: 25, minBase: 20 });
    defs.push({ key: "gsc_impr", label: "Search impressions", source: "Search Console", cur: val(d.gsc, "impressions"), prev: val(d.gsc, "impressions", "previous"), weight: 10, minBase: 200 });
    defs.push({ key: "gsc_pos", label: "Average position", source: "Search Console", cur: val(d.gsc, "position"), prev: val(d.gsc, "position", "previous"), weight: 10, minBase: 1, lowerIsBetter: true });
  }
  if (d.connected.ga4) {
    defs.push({ key: "ga4_sessions", label: "Website sessions", source: "GA4", cur: val(d.ga4, "sessions"), prev: val(d.ga4, "sessions", "previous"), weight: 20, minBase: 50 });
    defs.push({ key: "ga4_eng", label: "Engagement rate", source: "GA4", cur: val(d.ga4, "engagement_rate"), prev: val(d.ga4, "engagement_rate", "previous"), weight: 10, minBase: 0.01 });
    defs.push({ key: "ga4_key", label: "Key events", source: "GA4", cur: val(d.ga4, "key_events"), prev: val(d.ga4, "key_events", "previous"), weight: 10, minBase: 5 });
  }
  if (d.connected.gbp) {
    const act = (w: "current" | "previous") => {
      const parts = ["website_clicks", "call_clicks", "direction_requests"].map((k) => val(d.gbp, k, w));
      return parts.every((p) => p === null) ? null : parts.reduce<number>((a, p) => a + (p ?? 0), 0);
    };
    defs.push({ key: "gbp_actions", label: "Local actions (site, calls, directions)", source: "Business Profile", cur: act("current"), prev: act("previous"), weight: 10, minBase: 10 });
  }
  if (d.bing?.totals.current?.has_data) {
    defs.push({ key: "bing_clicks", label: "Bing clicks", source: "Bing", cur: val(d.bing.totals, "clicks"), prev: val(d.bing.totals, "clicks", "previous"), weight: 5, minBase: 10 });
  }
  const factors: GrowthFactor[] = [];
  for (const f of defs) {
    if (f.cur === null || f.prev === null || f.prev < f.minBase || f.prev === 0) continue; // too little volume to mean anything
    const changePct = ((f.cur - f.prev) / Math.abs(f.prev)) * 100;
    const signed = f.lowerIsBetter ? -changePct : changePct;
    factors.push({ key: f.key, label: f.label, source: f.source, current: f.cur, previous: f.prev, changePct, score: clamp(50 + 2.5 * signed), weight: f.weight, lowerIsBetter: f.lowerIsBetter });
  }
  if (factors.length < 2) return null;
  const total = factors.reduce((a, f) => a + f.weight, 0);
  const score = Math.round(factors.reduce((a, f) => a + f.score * f.weight, 0) / total);
  return { score, band: score >= 62 ? "Growing" : score >= 42 ? "Steady" : "Declining", factors, used: factors.length };
}

export type HealthStatus = "pass" | "watch" | "fix";
export interface HealthCheck { key: string; label: string; status: HealthStatus; detail: string; rule: string; href?: string }

export function computeHealth(d: ReportData, opts: { staleSources: string[] }): HealthCheck[] {
  const out: HealthCheck[] = [];
  const r = d.research;
  if (r?.profile?.spam_score != null) {
    const s = r.profile.spam_score;
    out.push({ key: "spam", label: "Backlink quality", status: s >= 50 ? "fix" : s >= 30 ? "watch" : "pass", detail: `Spam score ${s}/100`, rule: "Pass below 30, watch 30-49, fix 50 and above (DataForSEO)", href: "/backlinks" });
  }
  if (r) out.push({ key: "spike", label: "Link growth pattern", status: r.spike ? "fix" : "pass", detail: r.spike ? `${r.spike.newDomains.toLocaleString("en-US")} new referring domains in ${r.spike.month}` : "No unusual jump in new links", rule: "Fix when a month has 40+ new referring domains and 5x the usual level", href: "/backlinks" });
  if (r?.organic && r.organic.keywords > 0) {
    const share = (r.organic.top10 / r.organic.keywords) * 100;
    out.push({ key: "top10", label: "Rankings on page one", status: share >= 15 ? "pass" : share >= 5 ? "watch" : "fix", detail: `${r.organic.top10} of ${r.organic.keywords} ranking keywords are in the top 10 (${share.toFixed(0)}%)`, rule: "Pass at 15% or more, watch 5-14%, fix below 5%", href: "/organic-keywords" });
  }
  if (d.gbpReviews) {
    const avg = d.gbpReviews.average, reply = d.gbpReviews.replyRate;
    if (avg !== null) out.push({ key: "rating", label: "Google rating", status: avg >= 4.5 ? "pass" : avg >= 4 ? "watch" : "fix", detail: `${avg.toFixed(2)} stars from ${d.gbpReviews.total} reviews`, rule: "Pass at 4.5 or more, watch 4.0-4.49, fix below 4.0", href: "/business-profile" });
    if (reply !== null) out.push({ key: "reply", label: "Review replies", status: reply >= 0.5 ? "pass" : reply >= 0.2 ? "watch" : "fix", detail: `${(reply * 100).toFixed(0)}% of reviews have an owner reply`, rule: "Pass at 50% or more, watch 20-49%, fix below 20%", href: "/business-profile" });
  }
  const crawl = d.bing?.crawl;
  if (crawl && crawl.crawled > 0) {
    const pct = (crawl.errors / crawl.crawled) * 100;
    out.push({ key: "crawl", label: "Bing crawl errors", status: pct === 0 ? "pass" : pct < 5 ? "watch" : "fix", detail: `${crawl.errors} errors in ${crawl.crawled.toLocaleString("en-US")} pages crawled (${pct.toFixed(1)}%)`, rule: "Pass at 0%, watch below 5%, fix 5% or more", href: "/bing" });
  }
  out.push({ key: "fresh", label: "Data freshness", status: opts.staleSources.length === 0 ? "pass" : "watch", detail: opts.staleSources.length ? `Not synced in 48h: ${opts.staleSources.join(", ")}` : "All connected sources synced in the last 48 hours", rule: "Watch when a connected source hasn't synced for 48 hours", href: "/integrations" });
  return out;
}
