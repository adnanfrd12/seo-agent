import "server-only";
import { ga, type Ga4xCtx } from "./api";

/** GA4 Realtime API (the only live data Google offers): the last 30 minutes, read when the screen opens. */
export interface Realtime {
  perMinute: number[]; // index 0 = 29 minutes ago … 29 = this minute
  eventsPerMinute: Record<string, number[]>;
  byCountry: [string, number][]; byCity: [string, string, number][]; byPage: [string, number][]; byEvent: [string, number][]; byDevice: [string, number][];
  views: number; at: string; error?: string;
  feed: { minutesAgo: number; event: string; page: string; city: string; device: string; n: number }[];
}

type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
const rows = (r: Record<string, unknown>) => ((r.rows as Row[] | undefined) ?? []).map((x) => ({ d: (x.dimensionValues ?? []).map((v) => v.value ?? ""), m: (x.metricValues ?? []).map((v) => Number(v.value ?? 0)) }));

export async function realtime(ctx: Ga4xCtx, leadEvents: string[] = []): Promise<Realtime> {
  const out: Realtime = { perMinute: new Array(30).fill(0), eventsPerMinute: {}, byCountry: [], byCity: [], byPage: [], byEvent: [], byDevice: [], views: 0, at: new Date().toISOString(), feed: [] };
  const q = (dimensions: string[], metrics: string[], filter?: Record<string, unknown>) => ga(ctx, "GOOGLE_ANALYTICS_RUN_REALTIME_REPORT", { property: ctx.property, dimensions: dimensions.map((name) => ({ name })), metrics: metrics.map((name) => ({ name })), limit: 250, ...(filter ? { dimensionFilter: filter } : {}) }, 30_000).then(rows);
  const named = leadEvents.filter((e) => !e.includes("("));
  try {
    const [min, evMin, country, city, page, ev, dev, feed] = await Promise.all([
      q(["minutesAgo"], ["activeUsers"]), q(["minutesAgo", "eventName"], ["eventCount"]), q(["country"], ["activeUsers"]), q(["city", "country"], ["activeUsers"]),
      q(["unifiedScreenName"], ["screenPageViews"]), q(["eventName"], ["eventCount"]), q(["deviceCategory"], ["activeUsers"]),
      named.length ? q(["minutesAgo", "eventName", "unifiedScreenName", "city", "deviceCategory"], ["eventCount"], { filter: { fieldName: "eventName", inListFilter: { values: named } } }) : Promise.resolve([]),
    ]);
    out.feed = feed.map((r) => ({ minutesAgo: Number(r.d[0]), event: r.d[1], page: r.d[2], city: r.d[3], device: r.d[4], n: r.m[0] })).sort((a, b) => a.minutesAgo - b.minutesAgo);
    for (const r of min) { const m = Number(r.d[0]); if (m >= 0 && m < 30) out.perMinute[29 - m] = r.m[0]; }
    for (const r of evMin) { const m = Number(r.d[0]); if (m < 0 || m >= 30) continue; (out.eventsPerMinute[r.d[1]] ??= new Array(30).fill(0))[29 - m] += r.m[0]; }
    out.byCountry = country.map((r) => [r.d[0], r.m[0]] as [string, number]).sort((a, b) => b[1] - a[1]);
    out.byCity = city.map((r) => [r.d[0], r.d[1], r.m[0]] as [string, string, number]).sort((a, b) => b[2] - a[2]);
    out.byPage = page.map((r) => [r.d[0], r.m[0]] as [string, number]).sort((a, b) => b[1] - a[1]);
    out.byEvent = ev.map((r) => [r.d[0], r.m[0]] as [string, number]).sort((a, b) => b[1] - a[1]);
    out.byDevice = dev.map((r) => [r.d[0], r.m[0]] as [string, number]).sort((a, b) => b[1] - a[1]);
    out.views = page.reduce((t, r) => t + r.m[0], 0);
  } catch (e) { out.error = (e instanceof Error ? e.message : String(e)).replace(/^GOOGLE_ANALYTICS_[A-Z_]+:\s*/, "").slice(0, 240); }
  return out;
}
