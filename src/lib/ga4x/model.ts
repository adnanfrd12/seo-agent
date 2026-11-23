/**
 * The GA4 leads module's rules and arithmetic (no I/O): which events are leads, URL cleaning, the
 * "AI Assistant" channel, bot slices, and grouping the synced daily rows over any date range.
 */
import type { Cube } from "./types";

/* ------------------------------------------------------------------ lead detection */
export const LEAD_TYPES = ["Calls", "Forms", "Directions", "Email", "Text / chat", "Booking", "Purchase"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];
/** The three types every screen shows, even at zero. */
export const MAIN_TYPES: LeadType[] = ["Calls", "Forms", "Directions"];

const RULES: { type: LeadType | "Form start"; re: RegExp; rule: string }[] = [
  { type: "Form start", re: /^form_start$/i, rule: "form_start (counted for abandonment, not as a lead)" },
  { type: "Purchase", re: /^purchase$/i, rule: "Name is purchase" },
  { type: "Calls", re: /phone|call|tel/i, rule: "Name matches /phone|call|tel/" },
  { type: "Directions", re: /direction|map|navigate/i, rule: "Name matches /direction|map|navigate/" },
  { type: "Email", re: /email|mailto/i, rule: "Name matches /email|mailto/" },
  { type: "Text / chat", re: /chat|messenger|whatsapp|sms|text_us/i, rule: "Name matches /chat|messenger|whatsapp|sms|text_us/" },
  { type: "Booking", re: /book|booking|schedule|appointment|calendar/i, rule: "Name matches /book|schedule|appointment|calendar/" },
  { type: "Forms", re: /form|submit|lead|contact|quote|estimate|inquiry|enquiry|generate_lead|sign_up|request/i, rule: "Name matches /form|submit|lead|contact|quote|estimate|inquiry|sign_up|request/" },
];

/** Click and page-view events that count as leads when the site has no named event for the action. */
export const FALLBACKS: { name: string; kind: "link" | "page"; pattern: string; type: LeadType; rule: string }[] = [
  { name: "click (phone link)", kind: "link", pattern: "^tel:", type: "Calls", rule: "click event, link_url starts with tel:" },
  { name: "click (email link)", kind: "link", pattern: "^mailto:", type: "Email", rule: "click event, link_url starts with mailto:" },
  { name: "click (text link)", kind: "link", pattern: "^sms:", type: "Text / chat", rule: "click event, link_url starts with sms:" },
  { name: "click (map link)", kind: "link", pattern: "google\\.[a-z.]+/maps|maps\\.google\\.|maps\\.app\\.goo\\.gl|goo\\.gl/maps|maps\\.apple\\.com", type: "Directions", rule: "click event, link_url opens Google or Apple Maps" },
  { name: "page_view (thank-you page)", kind: "page", pattern: "thank|thanks|success|confirmation", type: "Forms", rule: "page_view of a thank-you page (page path has thank / success / confirmation)" },
];
/** Standard GA4 events that are never leads by name alone. */
export const NOT_LEAD_CANDIDATES = new Set(["page_view", "session_start", "first_visit", "user_engagement", "scroll", "click", "file_download", "view_search_results", "video_start", "video_progress", "video_complete"]);

export interface LeadMapEntry { event: string; type: LeadType | "Form start" | null; counts: boolean; rule: string; key: boolean; override?: boolean }

export function classify(event: string): { type: LeadType | "Form start" | null; rule: string } {
  const fb = FALLBACKS.find((f) => f.name === event);
  if (fb) return { type: fb.type, rule: fb.rule };
  if (NOT_LEAD_CANDIDATES.has(event.toLowerCase())) return { type: null, rule: event === "click" ? "Enhanced measurement (outbound)" : event === "scroll" || event === "view_search_results" || event === "file_download" ? "Enhanced measurement" : "Standard" };
  for (const r of RULES) if (r.re.test(event)) return { type: r.type, rule: r.rule };
  return { type: null, rule: "Custom event (no lead pattern in its name)" };
}

/** Every event's lead type: by name, by fallback, or as the user set it on Lead setup. */
export function leadMap(events: string[], keyEvents: string[], overrides: Record<string, string>): LeadMapEntry[] {
  return events.map((event) => {
    const auto = classify(event);
    const o = overrides[event];
    const type = o !== undefined ? (o === "" ? null : (o as LeadType)) : auto.type;
    return { event, type, counts: !!type && type !== "Form start", rule: o !== undefined ? "Set on Lead setup" : auto.rule, key: keyEvents.includes(event), override: o !== undefined };
  });
}

/* ------------------------------------------------------------------ URLs and channels */
const TRACKING = /^(fbclid|gclid|gbraid|wbraid|msclkid|dclid|ttclid|twclid|li_fat_id|igshid|srsltid|mc_cid|mc_eid|_gl|_ga|utm_[a-z_]+)$/i;
/** Landing page without tracking parameters, fragments or an empty "?", lowercase host, no trailing slash (except "/"). */
export function cleanUrl(raw: string): string {
  if (!raw || raw === "(not set)") return raw || "(not set)";
  const [pathPart, query = ""] = raw.split("#")[0].split("?");
  const keep = query.split("&").filter((kv) => kv && !TRACKING.test(kv.split("=")[0]));
  let path = pathPart.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/$/, "");
  return keep.length ? `${path}?${keep.join("&")}` : path || "/";
}

export const AI_SOURCES = /chatgpt\.com|chat\.openai\.com|openai|perplexity|gemini\.google\.com|bard\.google|copilot\.microsoft\.com|claude\.ai|you\.com|meta\.ai|deepseek|grok\.com|mistral\.ai/i;
export function sourceOf(sm: string) { return (sm.split(" / ")[0] ?? sm).trim(); }
export function mediumOf(sm: string) { return (sm.split(" / ")[1] ?? "").trim(); }
/** GA4's channel, with "AI Assistant" for sessions from ChatGPT, Perplexity, Gemini, Copilot and the like. */
export function channelOf(ch: string, sm: string) {
  return AI_SOURCES.test(sourceOf(sm)) || mediumOf(sm) === "ai-assistant" ? "AI Assistant" : ch || "(not set)";
}
export function aiName(source: string) {
  const s = source.toLowerCase();
  return s.includes("chatgpt") || s.includes("openai") ? "ChatGPT" : s.includes("perplexity") ? "Perplexity" : s.includes("gemini") || s.includes("bard") ? "Gemini"
    : s.includes("copilot") ? "Copilot" : s.includes("claude") ? "Claude" : s.includes("deepseek") ? "DeepSeek" : s.includes("grok") ? "Grok" : s.includes("meta.ai") ? "Meta AI" : source;
}
/** Group of a page path for "views by section" style charts. */
export function pageGroup(p: string) {
  const x = p.toLowerCase();
  if (x === "/" || x === "") return "Home page";
  if (/^\/(blog|news|articles?|posts?)(\/|$)/.test(x)) return "Blog posts";
  if (/contact|estimate|quote|request|book|schedule|appointment/.test(x)) return "Contact page";
  if (/our-work|portfolio|gallery|projects|case-stud/.test(x)) return "Our Work";
  if (/faq/.test(x)) return "FAQ";
  if (/about|team|review|testimonial/.test(x)) return "About & reviews";
  if (/thank|success|confirmation/.test(x)) return "Thank-you page";
  if (/(-tx|-texas|-ky|-tn|-ca|-fl|near-me|city|location|service-area|areas-we-serve)/.test(x)) return "City page";
  return "Service pages";
}
export const isBlog = (p: string) => /^\/(blog|news|articles?|posts?)\//i.test(p);

/* ------------------------------------------------------------------ rows */
export type Obj = Record<string, string | number>;
/** Cube rows as objects keyed by column name. */
export function objects(c: Cube): Obj[] {
  return c.rows.map((r) => { const o: Obj = {}; c.cols.forEach((k, i) => { o[k] = r[i]; }); return o; });
}

export interface Period { start: string; end: string; pstart: string; pend: string; days: number }
export const dayOf = (o: Obj) => String(o.date ?? o.dateHour ?? "").slice(0, 10);
export const inCur = (p: Period) => (o: Obj) => { const d = dayOf(o); return d >= p.start && d <= p.end; };
export const inPrev = (p: Period) => (o: Obj) => { const d = dayOf(o); return d >= p.pstart && d <= p.pend; };

export function sum<T>(xs: T[], f: (x: T) => number) { let s = 0; for (const x of xs) s += f(x); return s; }
export function group<T>(xs: T[], key: (x: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); if (k == null) continue; const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}
const DAY = 86_400_000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export function daysOf(start: string, end: string) { const out: string[] = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push(d); return out; }
/** Daily values over the current period (and the previous one aligned day by day). */
export function daily<T extends Obj>(xs: T[], p: Period, f: (x: T) => number, prev = false): number[] {
  const s = prev ? p.pstart : p.start, n = p.days;
  const a = new Array<number>(n).fill(0);
  for (const x of xs) { const i = Math.round((Date.parse(`${dayOf(x)}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / DAY); if (i >= 0 && i < n) a[i] += f(x); }
  return a;
}
export const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const weekday = (iso: string) => WEEKDAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];

/* ------------------------------------------------------------------ US states (GA4 regions are full names) */
export const STATES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia" };
