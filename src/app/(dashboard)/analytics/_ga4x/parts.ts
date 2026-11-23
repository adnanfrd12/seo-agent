import { C, typeColor } from "@/components/ga4x/fmt";
import type { G } from "@/lib/ga4x/g";
import { daysOf, shortDate, type LeadType } from "@/lib/ga4x/model";

/** Plain names for GA4 events (the technical name is always shown next to them). */
const PLAIN: Record<string, string> = {
  direction_button: "Direction button clicks on website", phone_number_clicks: "Phone button clicks on website", estimate_lead_form: "Estimate form submissions", contact_lead_form: "Contact form submissions",
  form_start: "Started filling in a form", form_submit: "Form submissions", generate_lead: "Leads submitted", page_view: "Page views", session_start: "Visits started", user_engagement: "Engaged moments",
  first_visit: "First-time visits", scroll: "Scrolled to the bottom", click: "Clicks to other websites", view_search_results: "Searches on your site", file_download: "File downloads", purchase: "Purchases",
  "click (map link)": "Clicks on map links (directions)", "click (phone link)": "Phone link clicks", "click (email link)": "Email link clicks", "click (text link)": "Text link clicks", "page_view (thank-you page)": "Thank-you page views (form sent)",
  "lead events": "All lead actions",
};
const BY_TYPE: Record<string, string> = { Calls: "Phone button clicks", Forms: "Form submissions", Directions: "Direction clicks", Email: "Email clicks", "Text / chat": "Chat or text starts", Booking: "Bookings", Purchase: "Purchases" };

export function plainEvent(g: G, e: string): string {
  if (PLAIN[e]) return PLAIN[e];
  const t = g.typeOf(e);
  if (!t) return e.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const same = g.leadEvents.filter((x) => g.typeOf(x) === t && !PLAIN[x]);
  return same.length > 1 ? `${BY_TYPE[t]} (${e})` : `${BY_TYPE[t]} on website`;
}

/** Colour per lead event: its type's colour, a second event of the same type gets a neighbouring one. */
export function eventColor(g: G, e: string): string {
  const t = g.typeOf(e);
  if (!t) return C[7];
  const same = g.leadEvents.filter((x) => g.typeOf(x) === t);
  const i = same.indexOf(e);
  if (i <= 0) return typeColor(t);
  const alt = [C[6], C[4], C[3], C[5], C[7]];
  return alt[(i - 1) % alt.length];
}
export const TYPE_PLAIN: Record<LeadType, string> = { Calls: "Calls", Forms: "Forms", Directions: "Directions", Email: "Emails", "Text / chat": "Texts and chats", Booking: "Bookings", Purchase: "Purchases" };

/** Day labels of the current period. */
export const labels = (g: G) => daysOf(g.p.start, g.p.end).map(shortDate);

/** Why a lead type shows 000, and what brings it in. */
export function typeMissing(g: G, t: LeadType): string | undefined {
  if (g.eventsOfType(t).length) return undefined;
  const found = g.meta.crawl?.findings.find((f) => (t === "Calls" && f.kind === "call") || (t === "Directions" && f.kind === "directions") || (t === "Email" && f.kind === "email"));
  const what = t === "Calls" ? "phone (tel:) link clicks" : t === "Directions" ? "direction / map link clicks" : t === "Forms" ? "form submissions" : t.toLowerCase();
  return `000: GA4 receives no event for ${what}.${found ? ` The site does have ${found.action.toLowerCase()} (${found.found.slice(0, 2).join(", ")}).` : ""} Install the ready-made tag from Lead setup → Tracking gaps (or add a GA4 event whose name contains ${t === "Calls" ? "phone/call" : t === "Directions" ? "direction/map" : t === "Forms" ? "form/lead/contact" : t.toLowerCase()}), then mark it as a key event. It shows here from the next sync.`;
}

/** Bubble-map points for cities that have stored coordinates. */
export function mapPoints(g: G, geo: Record<string, [number, number] | null>, rows: { city: string; country: string; v: number }[]) {
  const byCity = new Map<string, { city: string; country: string; v: number }>();
  for (const r of rows) { if (!r.city || r.city === "(not set)") continue; const k = `${r.city}|${r.country}`; const cur = byCity.get(k); if (cur) cur.v += r.v; else byCity.set(k, { ...r }); }
  return [...byCity.values()].flatMap((r) => { const c = geo[`${r.city}|${g.cityRegion.get(r.city) ?? ""}|${r.country}`]; return c ? [{ label: r.city, lat: c[0], lon: c[1], v: r.v }] : []; });
}

/** Every stored day of qualified leads up to the end of the period (for the calendar). */
export function leadCalendar(g: G) {
  const start = g.meta.start, n = Math.round((Date.parse(g.p.end) - Date.parse(start)) / 86_400_000) + 1;
  const cal = new Array<number>(Math.max(0, n)).fill(0);
  for (const x of g.L) { if (g.typeOf(String(x.eventName)) === null || (g.qualified && g.isBot(x))) continue; const i = Math.round((Date.parse(String(x.date)) - Date.parse(start)) / 86_400_000); if (i >= 0 && i < n) cal[i] += Number(x.eventCount); }
  return { start, cal };
}
export const HOUR_BUCKETS: [string, number, number][] = [["0-7", 0, 7], ["7-9", 7, 9], ["9-11", 9, 11], ["11-13", 11, 13], ["13-15", 13, 15], ["15-17", 15, 17], ["17-19", 17, 19], ["19-21", 19, 21], ["21-24", 21, 24]];
