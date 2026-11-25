import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertEvents, insights, RULES } from "@/lib/gscx/alerts";
import { ctrChanges, noClicks, noImpressions, pageTable } from "@/lib/gscx/analysis";
import { addDays, G, groupM, m, type Period, type R } from "@/lib/gscx/g";
import type { InventoryRow, SitemapInfo } from "@/lib/gscx/inventory";
import { settingsFrom, settingsSources } from "@/lib/gscx/load";
import { pathOf, type GscSettings } from "@/lib/gscx/model";
import { gscxTarget, readGscx, type GCube, type GscMeta, type InspState } from "@/lib/gscx/sync";
import { r2, r4 } from "./lists";

/**
 * Search Console setup and reports for Nova, read from the synced copy only: no sync, no Google calls.
 * The brand / competitor / city / service lists live in clients.settings.gsc_settings; an empty list means automatic.
 */
export const LISTS = ["brand", "competitors", "cities", "services"] as const;
export type ListKey = (typeof LISTS)[number];
export const LIST_LABEL: Record<ListKey, string> = { brand: "Brand terms", competitors: "Competitors", cities: "Cities and areas served", services: "Services" };

/** "saved", "automatic" or "not set" for a settingsFrom source label. */
export const kindOf = (k: ListKey, src: string) => (src === "Saved" ? "saved" : k === "competitors" ? "not set" : "automatic");

/** The four lists as the screens use them now, what is saved, and how they'd resolve with other saved lists. */
export async function gscLists(admin: SupabaseClient, clientId: string) {
  const [t, sources] = await Promise.all([gscxTarget(admin, clientId, null), settingsSources(admin, clientId)]);
  const read = t ? await readGscx(admin, clientId, t.resource.id, ["q"], ["inventory"]) : null;
  const inv = (read?.one.inventory as InventoryRow[] | null) ?? [];
  const rows = read?.cubes.q.rows ?? [];
  const settings = (sources.c?.settings ?? {}) as Record<string, unknown>;
  const raw = (settings.gsc_settings ?? {}) as Partial<Record<ListKey, unknown>>;
  const saved = Object.fromEntries(LISTS.map((k) => [k, Array.isArray(raw[k]) ? (raw[k] as unknown[]).map(String) : []])) as Record<ListKey, string[]>;
  /** the lists the screens would use with `next` saved (an empty list = automatic) */
  const resolve = (next: Record<ListKey, string[]>) =>
    settingsFrom({ ...sources, c: { name: sources.c?.name ?? "", settings: { ...settings, gsc_settings: next } } }, inv, rows);
  return { site: t?.resource.external_id ?? null, connected: Boolean(t?.ctx), hasData: rows.length > 0, saved, now: resolve(saved), resolve };
}

/* ------------------------------------------------------------------ reports */
const ONES = ["meta", "inventory", "insp", "sitemaps"] as const;
export const REPORTS = ["watchlists", "segments", "alerts"] as const;
export type Report = (typeof REPORTS)[number];
const CUBES: Record<Report, GCube[]> = { watchlists: ["pg", "qp"], segments: ["totals", "dev", "cd", "app", "pd"], alerts: ["totals", "q", "pg", "qp", "dev"] };

/** A Search Console period over the synced data, ending on the newest synced day. Null when Search Console isn't connected. */
export async function storedGsc(admin: SupabaseClient, clientId: string, report: Report, days: number) {
  const t = await gscxTarget(admin, clientId, null);
  if (!t) return null;
  const names = [...new Set<GCube>(["q", ...CUBES[report]])];
  const [read, sources] = await Promise.all([readGscx(admin, clientId, t.resource.id, names, ONES), settingsSources(admin, clientId)]);
  const meta = read.one.meta as GscMeta | null;
  if (!meta) return { site: t.resource.external_id, g: null };
  const inv = read.one.inventory as InventoryRow[] | null, insp = read.one.insp as InspState | null, sitemaps = (read.one.sitemaps as SitemapInfo[] | null) ?? [];
  const { s } = settingsFrom(sources, inv ?? [], read.cubes.q.rows);
  const start = addDays(meta.end, -(days - 1));
  const p: Period = { start, end: meta.end, days, pstart: addDays(start, -days), pend: addDays(start, -1) };
  return { site: t.resource.external_id, g: new G(meta, read.cubes, p, s as GscSettings, inv, insp, sitemaps) };
}

const countBy = <T>(xs: T[], key: (x: T) => string) => {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
};
const CAT_ORDER = ["Not indexed", "Indexed but no demand", "Duplicate/canonicalised", "Redirect or 404", "Excluded on purpose (noindex/robots)", "Not inspected yet"];

/** Pages never clicked, never shown, and pages whose click rate rose or fell (the Page watchlists screen). */
export function watchlists(g: G) {
  const pages = pageTable(g);
  const nc = noClicks(g, pages), ni = noImpressions(g, pages), ch = ctrChanges(g, pages);
  const up = ch.filter((x) => x.dCtr > 0).sort((a, b) => b.gained - a.gained), down = ch.filter((x) => x.dCtr < 0).sort((a, b) => a.gained - b.gained);
  const change = (p: (typeof ch)[number]) => ({ page: pathOf(p.page), ctr_before: r4(p.ctrPrev), ctr_now: r4(p.ctr), clicks_gained_or_lost: r2(p.gained), position_change: r2(p.dPos), impressions: p.impressions, likely_reason: p.reason });
  return {
    shown_but_never_clicked: {
      pages: nc.length, impressions_without_a_click: nc.reduce((a, p) => a + p.impressions, 0),
      top: nc.slice(0, 15).map((p) => ({ page: pathOf(p.page), impressions: p.impressions, position: r2(p.pos), top_query: p.topQuery, index_status: p.status, likely_reason: p.reason, what_to_do: p.todo })),
    },
    never_shown_on_google: {
      pages: ni.length, by_category: countBy(ni, (x) => x.cat),
      top: [...ni].sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || b.linksIn - a.linksIn).slice(0, 15)
        .map((x) => ({ page: pathOf(x.url), category: x.cat, index_status: x.status, internal_links_in: x.linksIn, what_to_do: x.todo })),
    },
    clicked_more_often: up.slice(0, 8).map(change),
    clicked_less_often: down.slice(0, 8).map(change),
    note: "Click-rate changes only cover pages with 100+ impressions in both periods.",
  };
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekday = (iso: string) => WD[(new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7];

/** Devices, countries, search appearance and mobile vs desktop ranking gaps (the Devices, countries, appearance screen). */
export function segments(g: G) {
  const metric = (v: ReturnType<typeof m>) => ({ clicks: v.clicks, impressions: v.impressions, ctr: r4(v.ctr), position: r2(v.pos) });
  const devPrev = groupM(g.DEV.filter(g.inPrev), (x) => String(x.device));
  const dev = [...groupM(g.DEV.filter(g.inCur), (x) => String(x.device))].sort((a, b) => b[1].clicks - a[1].clicks);
  const cty = [...groupM(g.CD.filter(g.inCur), (x) => String(x.country))].sort((a, b) => b[1].impressions - a[1].impressions);
  const app = [...groupM(g.APP.filter(g.inCur), (x) => String(x.appearance))].sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions);
  // mobile vs desktop position per page (rows grouped once)
  const byPage = new Map<string, { MOBILE: R[]; DESKTOP: R[] }>();
  for (const x of g.pd()) {
    const d = String(x.device);
    if (d !== "MOBILE" && d !== "DESKTOP") continue;
    const e = byPage.get(String(x.page)) ?? { MOBILE: [], DESKTOP: [] };
    e[d].push(x);
    byPage.set(String(x.page), e);
  }
  const gaps = [...byPage].map(([p, e]) => ({ p, mo: m(e.MOBILE), de: m(e.DESKTOP) }))
    .filter((r) => r.mo.pos != null && r.de.pos != null && r.mo.impressions + r.de.impressions >= 20)
    .map((r) => ({ page: pathOf(r.p), mobile_position: r2(r.mo.pos), desktop_position: r2(r.de.pos), gap: r2(r.mo.pos! - r.de.pos!) }))
    .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));
  const byDay = (prev: boolean) => Object.fromEntries(WD.map((d) => [d, g.T.filter((x) => x.type === "web" && (prev ? g.inPrev(x) : g.inCur(x)) && weekday(String(x.date)) === d).reduce((a, x) => a + Number(x.clicks), 0)]));
  return {
    devices: dev.map(([d, v]) => ({ device: d.toLowerCase(), ...metric(v), previous_clicks: devPrev.get(d)?.clicks ?? 0 })),
    countries: cty.slice(0, 12).map(([c, v]) => ({ country: c.toUpperCase(), ...metric(v) })),
    search_appearance: app.map(([a, v]) => ({ appearance: a, ...metric(v) })),
    mobile_vs_desktop_gaps: gaps.filter((x) => Math.abs(x.gap ?? 0) > 2).slice(0, 12),
    pages_compared: gaps.length,
    clicks_by_weekday: { this_period: byDay(false), previous_period: byDay(true) },
    note: "Countries are ISO 3166 alpha-3 codes. Search Console has no city dimension. Gaps list pages ranking 2+ positions apart on phones and computers.",
  };
}

/** Written insights, the alerts that fired in the last 90 days and the alert rules (the Alerts and insights screen). */
export function alerts(g: G) {
  const ev = alertEvents(g);
  return {
    insights: insights(g).map(({ tone, title, text }) => ({ tone, title, text })),
    alerts_fired_last_90_days: { count: ev.length, by_type: countBy(ev, (e) => e.type), by_severity: countBy(ev, (e) => e.severity), latest: ev.slice(0, 25) },
    rules: RULES.map((r) => `${r.rule} (${r.scope}): ${r.condition}`),
    note: "Rules are replayed over the synced history and shown in the dashboard only (no email or Slack).",
  };
}
