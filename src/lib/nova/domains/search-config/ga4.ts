import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { G } from "@/lib/ga4x/g";
import { serviceArea, sourcesFor } from "@/lib/ga4x/load";
import { addDays, classify, group, LEAD_TYPES, sum, type Period } from "@/lib/ga4x/model";
import { ga4xTarget, readGa4x } from "@/lib/ga4x/sync";
import type { Cube, CubeName } from "@/lib/ga4x/types";

/**
 * GA4 Lead setup for Nova, read from the synced copy only (no sync, no Google calls): which events count as leads
 * (clients.settings.ga4_lead_map overrides the automatic rule by name) and the service area (ga4_service_area;
 * empty = automatic).
 */
export const EVENT_TYPES = [...LEAD_TYPES, "Form start", "Not a lead", "Automatic"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface LeadEvent { event: string; type: string | null; counts: boolean; rule: string; key: boolean; override: boolean; count: number }

const typeName = (t: string | null) => t ?? "Not a lead";
/** "Calls (automatic)", "Calls, not counted (automatic)", "Not a lead (set on Lead setup)" */
export const typeLabel = (e: Pick<LeadEvent, "type" | "override" | "counts">) =>
  `${typeName(e.type)}${e.type && e.type !== "Form start" && !e.counts ? ", not counted" : ""} (${e.override ? "set on Lead setup" : "automatic"})`;
/** What an event's type is when its override is removed. */
export const autoType = (event: string) => typeName(classify(event).type);

type Cubes = Record<CubeName, Cube>;
const NO_GEO = { geo: { cols: [], rows: [] } } as unknown as Cubes;

/** The GA4 events with their lead types and counts over the last 30 synced days, and the service area. */
export async function leadSetup(admin: SupabaseClient, clientId: string) {
  const [t, src] = await Promise.all([ga4xTarget(admin, clientId, null), sourcesFor(admin, clientId)]);
  const saved = Array.isArray(src.settings.ga4_service_area) ? (src.settings.ga4_service_area as unknown[]).map(String) : [];
  const overrides = (src.settings.ga4_lead_map ?? {}) as Record<string, string>;
  const read = t ? await readGa4x(admin, clientId, t.resource.id, ["events", "leads", "geo"]) : null;
  const cubes = (read?.cubes ?? NO_GEO) as Cubes;
  /** what the screens use now, and what an empty saved list goes back to */
  const now = serviceArea(src, cubes), auto = serviceArea({ ...src, settings: { ...src.settings, ga4_service_area: [] } }, cubes);
  const base = { property: t ? t.resource.display_name ?? t.resource.external_id : null, saved, overrides, auto, ...now };
  const meta = read?.meta;
  if (!t || !read || !meta) return { ...base, state: !t ? ("no_ga4" as const) : ("not_synced" as const), events: [] as LeadEvent[], end: null };
  const p: Period = { start: addDays(meta.end, -29), end: meta.end, days: 30, pstart: addDays(meta.end, -59), pend: addDays(meta.end, -30) };
  const g = new G(meta, read.cubes, p, { overrides, qualified: false, serviceArea: now.area, users: null });
  // event counts in the period, as Lead setup shows them (link clicks and thank-you pages come from the leads report)
  const counts = new Map([...group(g.events.filter((x) => g.inCur(x)), (x) => String(x.eventName))].map(([k, v]) => [k, sum(v, (x) => Number(x.eventCount))]));
  for (const f of meta.fallbacks) counts.set(f, sum(g.L.filter((x) => g.inCur(x) && x.eventName === f), (x) => Number(x.eventCount)));
  const events: LeadEvent[] = g.map.map((e) => ({ event: e.event, type: e.type, counts: e.counts, rule: e.rule, key: e.key, override: Boolean(e.override), count: counts.get(e.event) ?? 0 }))
    .sort((a, b) => Number(b.counts) - Number(a.counts) || b.count - a.count);
  return { ...base, state: "ok" as const, events, end: meta.end };
}
