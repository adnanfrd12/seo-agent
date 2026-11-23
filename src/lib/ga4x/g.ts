/**
 * One date range of the GA4 leads module, worked out from the synced daily cubes. Every screen reads
 * from this: sessions, leads by event and type, channels, pages, places, devices, bots and the period before.
 */
import {
  aiName, channelOf, classify, cleanUrl, daily, dayOf, FALLBACKS, group, inCur, inPrev, leadMap, LEAD_TYPES, MAIN_TYPES, objects, sourceOf, mediumOf, sum,
  type LeadMapEntry, type LeadType, type Obj, type Period,
} from "./model";
import type { Cube, CubeName, Ga4xMeta, RangeUsers } from "./types";

export interface Agg { sessions: number; engaged: number; sec: number; pv: number; keyEv: number; newUsers: number; er: number; aet: number; leads: number; lr: number; ev: Record<string, number>; types: Record<string, number> }
export interface Row extends Agg { key: string }

export class G {
  readonly D: Obj[]; readonly S: Obj[]; readonly GE: Obj[]; readonly L: Obj[]; readonly L2: Obj[]; readonly L3: Obj[]; readonly H: Obj[]; readonly R: Obj[]; readonly S2: Obj[];
  readonly pages: Obj[]; readonly pageEvents: Obj[]; readonly events: Obj[]; readonly links: Obj[]; readonly search: Obj[];
  readonly ads: Obj[]; readonly items: Obj[]; readonly ecom: Obj[]; readonly coupons: Obj[]; readonly refunds: Obj[];
  readonly map: LeadMapEntry[];
  /** lead event names, in a stable order (biggest first) */
  readonly leadEvents: string[];
  readonly typeOf: (e: string) => LeadType | null;
  /** day|country|browser slices that look like bots (many sessions, almost no engagement) */
  readonly botSlices: Set<string>;
  readonly cityRegion = new Map<string, string>();
  private readonly cur: (o: Obj) => boolean; private readonly prv: (o: Obj) => boolean;

  constructor(readonly meta: Ga4xMeta, cubes: Partial<Record<CubeName, Cube>>, readonly p: Period, opts: { overrides: Record<string, string>; qualified: boolean; serviceArea: string[]; users: RangeUsers | null }) {
    this.qualified = opts.qualified; this.serviceAreaNames = opts.serviceArea; this.serviceArea = opts.serviceArea.map((c) => c.toLowerCase()); this.users = opts.users;
    const o = (n: CubeName) => (cubes[n] ? objects(cubes[n]!) : []);
    this.S = o("sessions").map((x) => ({ ...x, ch: channelOf(String(x.sessionDefaultChannelGroup), String(x.sessionSourceMedium)), land: cleanUrl(String(x.landingPagePlusQueryString)) }));
    this.GE = o("geo").map((x) => ({ ...x, ch: channelOf(String(x.sessionDefaultChannelGroup), String(x.sessionSourceMedium)) }));
    this.L = o("leads").map((x) => ({ ...x, ch: channelOf(String(x.sessionDefaultChannelGroup), String(x.sessionSourceMedium)), land: cleanUrl(String(x.landingPagePlusQueryString)) }));
    this.D = o("daily"); this.L2 = o("leads2"); this.L3 = o("leads3"); this.H = o("hours"); this.R = o("res"); this.S2 = o("sessions2"); this.pages = o("pages"); this.pageEvents = o("pageEvents"); this.events = o("events");
    this.links = o("links"); this.search = o("search"); this.ads = o("ads"); this.items = o("items"); this.ecom = o("ecom"); this.coupons = o("coupons"); this.refunds = o("refunds");
    this.cur = inCur(p); this.prv = inPrev(p);
    for (const r of this.GE) if (r.city && r.region) this.cityRegion.set(String(r.city), String(r.region));

    const names = [...new Set([...this.events.map((e) => String(e.eventName)), ...meta.fallbacks])];
    this.map = leadMap(names, meta.keyEvents, opts.overrides);
    // link clicks and thank-you pages only stand in for a lead type the site has no named event for
    // (otherwise the same form would be counted twice: by its event and by its thank-you page)
    const named = new Set(this.map.filter((m) => m.counts && !FALLBACKS.some((f) => f.name === m.event)).map((m) => m.type));
    for (const m of this.map) {
      if (m.override || !m.counts || !FALLBACKS.some((f) => f.name === m.event) || !named.has(m.type)) continue;
      m.counts = false; m.rule += ` · not counted: the site already has a named ${String(m.type).toLowerCase()} event`;
    }
    const types = new Map(this.map.map((m) => [m.event, m.counts ? (m.type as LeadType) : null]));
    this.typeOf = (e) => types.get(e) ?? null;
    const counted = new Set(this.map.filter((m) => m.counts).map((m) => m.event));
    const totals = group(this.L.filter((x) => counted.has(String(x.eventName))), (x) => String(x.eventName));
    this.leadEvents = [...totals.entries()].map(([k, v]) => [k, sum(v, (x) => Number(x.eventCount))] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);

    this.botSlices = new Set<string>();
    for (const [k, v] of group(this.GE, (x) => `${x.date}|${x.country}|${x.browser}`)) {
      const s = sum(v, (x) => Number(x.sessions)), e = sum(v, (x) => Number(x.engagedSessions));
      if (s > 15 && e / s < 0.2) this.botSlices.add(k);
    }
  }
  readonly qualified: boolean; readonly serviceArea: string[]; readonly serviceAreaNames: string[]; readonly users: RangeUsers | null;

  isBot = (x: Obj) => this.botSlices.has(`${dayOf(x)}|${x.country}|${x.browser}`);
  private q = (x: Obj) => !this.qualified || !this.isBot(x);

  /* sessions are always GA4's real counts; "qualified" leaves out only the leads from bot-like slices */
  sCur = () => this.S.filter(this.cur);
  sPrev = () => this.S.filter(this.prv);
  geoCur = () => this.GE.filter(this.cur);
  geoPrev = () => this.GE.filter(this.prv);
  sAllCur = () => this.S.filter(this.cur);
  sAllPrev = () => this.S.filter(this.prv);
  /** lead rows (only counted lead events) */
  lCur = () => this.L.filter((x) => this.cur(x) && this.q(x) && this.typeOf(String(x.eventName)) !== null);
  lPrev = () => this.L.filter((x) => this.prv(x) && this.q(x) && this.typeOf(String(x.eventName)) !== null);
  lAllCur = () => this.L.filter((x) => this.cur(x) && this.typeOf(String(x.eventName)) !== null);
  l2Cur = () => this.L2.filter((x) => this.cur(x) && this.q(x) && this.typeOf(String(x.eventName)) !== null);
  l2Prev = () => this.L2.filter((x) => this.prv(x) && this.q(x) && this.typeOf(String(x.eventName)) !== null);
  /** every non-bulk event row (form_start etc.) */
  evCur = (name: string) => this.L.filter((x) => this.cur(x) && this.q(x) && x.eventName === name);
  l3Cur = () => this.L3.filter((x) => this.cur(x) && this.q(x) && this.typeOf(String(x.eventName)) !== null);
  hCur = () => this.H.filter(this.cur);
  rCur = () => this.R.filter(this.cur);
  s2Cur = () => this.S2.filter(this.cur);
  s2Prev = () => this.S2.filter(this.prv);
  inCur = (x: Obj) => this.cur(x);
  inPrev = (x: Obj) => this.prv(x);

  /** Session and lead totals for matching rows. */
  agg(s: Obj[], l: Obj[]): Agg {
    const sessions = sum(s, (x) => Number(x.sessions)), engaged = sum(s, (x) => Number(x.engagedSessions)), sec = sum(s, (x) => Number(x.userEngagementDuration));
    const ev: Record<string, number> = {}, types: Record<string, number> = {};
    for (const x of l) { const e = String(x.eventName), n = Number(x.eventCount); ev[e] = (ev[e] ?? 0) + n; const t = this.typeOf(e); if (t) types[t] = (types[t] ?? 0) + n; }
    const leads = sum(Object.values(ev), (v) => v);
    return { sessions, engaged, sec, pv: sum(s, (x) => Number(x.screenPageViews ?? 0)), keyEv: sum(s, (x) => Number(x.keyEvents ?? 0)), newUsers: sum(s, (x) => Number(x.newUsers ?? 0)),
      er: sessions ? engaged / sessions : 0, aet: sessions ? sec / sessions : 0, leads, lr: sessions ? leads / sessions : 0, ev, types };
  }
  /** Rows grouped by a dimension known to both the sessions and leads cubes. */
  by(fs: (x: Obj) => string | null, fl: (x: Obj) => string | null = fs, prev = false): Row[] {
    const s = group(prev ? this.sPrev() : this.sCur(), fs), l = group(prev ? this.lPrev() : this.lCur(), fl);
    return [...new Set([...s.keys(), ...l.keys()])].map((key) => ({ key, ...this.agg(s.get(key) ?? [], l.get(key) ?? []) }));
  }
  /** Rows by a place (city, region, country): sessions from the places report, leads from the leads report. */
  byGeo(fs: (x: Obj) => string | null, fl: (x: Obj) => string | null = fs, prev = false): Row[] {
    const s = group(prev ? this.geoPrev() : this.geoCur(), fs), l = group(prev ? this.lPrev() : this.lCur(), fl);
    return [...new Set([...s.keys(), ...l.keys()])].map((key) => ({ key, ...this.agg(s.get(key) ?? [], l.get(key) ?? []) }));
  }
  /** Same as `by` for dimensions only in the second cubes (campaign, region, OS, language; hour/weekday for leads). */
  by2(fs: ((x: Obj) => string | null) | null, fl: (x: Obj) => string | null, prev = false): Row[] {
    const s = fs ? group(prev ? this.s2Prev() : this.s2Cur(), fs) : new Map<string, Obj[]>(), l = group(prev ? this.l2Prev() : this.l2Cur(), fl);
    return [...new Set([...s.keys(), ...l.keys()])].map((key) => ({ key, ...this.agg(s.get(key) ?? [], l.get(key) ?? []) }));
  }
  total(prev = false) { return this.agg(prev ? this.sPrev() : this.sCur(), prev ? this.lPrev() : this.lCur()); }
  totalAll(prev = false) { return this.agg(prev ? this.sAllPrev() : this.sAllCur(), prev ? this.L.filter((x) => this.prv(x) && this.typeOf(String(x.eventName)) !== null) : this.lAllCur()); }

  daily = (xs: Obj[], f: (x: Obj) => number, prev = false) => daily(xs, this.p, f, prev);
  leadsDaily = (prev = false, pred: (x: Obj) => boolean = () => true) => this.daily((prev ? this.lPrev() : this.lCur()).filter(pred), (x) => Number(x.eventCount), prev);

  /** Lead types present plus the three main ones (shown at zero when missing). */
  types(): LeadType[] {
    const seen = new Set(this.leadEvents.map((e) => this.typeOf(e)).filter(Boolean) as LeadType[]);
    return LEAD_TYPES.filter((t) => MAIN_TYPES.includes(t) || seen.has(t));
  }
  eventsOfType = (t: LeadType) => this.leadEvents.filter((e) => this.typeOf(e) === t);

  inArea(city: string) { return this.serviceArea.includes(city.toLowerCase()); }
  source = (x: Obj) => sourceOf(String(x.sessionSourceMedium));
  medium = (x: Obj) => mediumOf(String(x.sessionSourceMedium));
  ai = (x: Obj) => aiName(this.source(x));

  /** The form-start events in the period (for abandonment). */
  formStarts(prev = false) { return sum(this.L.filter((x) => (prev ? this.prv(x) : this.cur(x)) && this.q(x) && x.eventName === "form_start"), (x) => Number(x.eventCount)); }
  formLeads(prev = false) { return sum(prev ? this.lPrev() : this.lCur(), (x) => (this.typeOf(String(x.eventName)) === "Forms" ? Number(x.eventCount) : 0)); }

  eventLabel(e: string) { return classify(e).type ? e : e; }
}
