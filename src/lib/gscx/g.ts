/**
 * One date range of the Search Console module, worked out from the synced cubes: totals, queries, pages,
 * devices, countries, appearances, hours, months, the URL inventory and inspections, for this period and the one before.
 */
import { benchmarkCtr, matcher, pathOf, segments, type GscSettings, type Segment } from "./model";
import type { Crawl, Inspection, InventoryRow, SitemapInfo } from "./inventory";
import type { Cube, GCube, GscMeta, InspState } from "./sync";

export type R = Record<string, string | number>;
export interface M { clicks: number; impressions: number; ctr: number; pos: number | null }
export interface Period { start: string; end: string; pstart: string; pend: string; days: number }
const DAY = 86_400_000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function rows(c: Cube | undefined): R[] {
  if (!c) return [];
  return c.rows.map((r) => { const o: R = {}; c.cols.forEach((k, i) => { o[k] = r[i] as string | number; }); return o; });
}
export function m(xs: R[]): M {
  let c = 0, i = 0, px = 0;
  for (const x of xs) { c += Number(x.clicks); i += Number(x.impressions); px += Number(x.posx); }
  return { clicks: c, impressions: i, ctr: i ? c / i : 0, pos: i ? px / i : null };
}
export function groupM(xs: R[], key: (x: R) => string | null): Map<string, M> {
  const g = new Map<string, R[]>();
  for (const x of xs) { const k = key(x); if (k == null) continue; const a = g.get(k); if (a) a.push(x); else g.set(k, [x]); }
  return new Map([...g].map(([k, v]) => [k, m(v)]));
}

export class G {
  readonly T: R[]; readonly Q: R[]; readonly QP: R[]; readonly PG: R[]; readonly PD: R[]; readonly CD: R[]; readonly DEV: R[]; readonly APP: R[]; readonly HOUR: R[]; readonly QM: R[];
  readonly segs: Segment[]; readonly brandSeg: Segment;
  readonly isBrand: (q: string) => boolean;
  readonly inv: InventoryRow[]; readonly invMap: Map<string, InventoryRow>; readonly insp: Record<string, Inspection[]>; readonly quota: InspState["quota"];
  readonly linksIn = new Map<string, number>();
  constructor(readonly meta: GscMeta, cubes: Partial<Record<GCube, Cube>>, readonly p: Period, readonly settings: GscSettings,
    inv: InventoryRow[] | null, insp: InspState | null, readonly sitemaps: SitemapInfo[], readonly type: string = "web") {
    this.T = rows(cubes.totals); this.Q = rows(cubes.q); this.QP = rows(cubes.qp); this.PG = rows(cubes.pg); this.PD = rows(cubes.pd); this.CD = rows(cubes.cd);
    this.DEV = rows(cubes.dev); this.APP = rows(cubes.app); this.HOUR = rows(cubes.hour); this.QM = rows(cubes.qm);
    this.segs = segments(settings); this.brandSeg = this.segs[0];
    const br = matcher(this.brandSeg); this.isBrand = (q) => settings.brand.length > 0 && br(q);
    this.inv = inv ?? []; this.invMap = new Map(this.inv.map((r) => [r.url, r])); this.insp = insp?.history ?? {}; this.quota = insp?.quota ?? { date: "", used: 0 };
    for (const r of this.inv) for (const l of r.crawl?.links ?? []) if (l !== r.url) this.linksIn.set(l, (this.linksIn.get(l) ?? 0) + 1);
  }
  inCur = (x: R) => { const d = String(x.date ?? x.hour ?? "").slice(0, 10); return d >= this.p.start && d <= this.p.end; };
  inPrev = (x: R) => { const d = String(x.date ?? x.hour ?? "").slice(0, 10); return d >= this.p.pstart && d <= this.p.pend; };
  /** True totals for the search type (include anonymized queries). */
  totals = (prev = false, type = this.type) => m(this.T.filter((x) => x.type === type && (prev ? this.inPrev(x) : this.inCur(x))));
  q = (prev = false) => this.Q.filter(prev ? this.inPrev : this.inCur);
  qp = (prev = false) => this.QP.filter(prev ? this.inPrev : this.inCur);
  pd = (prev = false) => this.PD.filter(prev ? this.inPrev : this.inCur);
  pg = (prev = false) => this.PG.filter(prev ? this.inPrev : this.inCur);
  queries = (prev = false) => groupM(this.q(prev), (x) => String(x.query));
  /** Page totals (from [date, page]; [page, device] rows are incomplete in Search Console). */
  pages = (prev = false) => groupM(this.pg(prev), (x) => String(x.page));
  daily<T extends R>(xs: T[], f: (x: T) => number, prev = false): number[] {
    const s = prev ? this.p.pstart : this.p.start, a = new Array<number>(this.p.days).fill(0);
    for (const x of xs) { const i = Math.round((Date.parse(`${String(x.date).slice(0, 10)}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / DAY); if (i >= 0 && i < this.p.days) a[i] += f(x); }
    return a;
  }
  /** The site's own non-brand CTR by rounded position (1-20) over the last 90 days, benchmark where data is thin. */
  private curve: Map<number, number> | null = null;
  ownCurve(): Map<number, number> {
    if (this.curve) return this.curve;
    const from = addDays(this.meta.end, -89), by = new Map<number, { c: number; i: number }>();
    for (const [q, v] of groupM(this.Q.filter((x) => String(x.date) >= from), (x) => String(x.query))) {
      if (this.isBrand(q) || v.pos == null) continue;
      const r = Math.round(v.pos); if (r < 1 || r > 20) continue;
      const b = by.get(r) ?? { c: 0, i: 0 }; b.c += v.clicks; b.i += v.impressions; by.set(r, b);
    }
    this.curve = new Map([...by].filter(([, b]) => b.i >= 200).map(([r, b]) => [r, b.c / b.i]));
    return this.curve;
  }
  expected = (pos: number) => this.ownCurve().get(Math.max(1, Math.round(pos))) ?? benchmarkCtr(pos);
  /** Latest inspection of a URL. */
  latest = (u: string) => this.insp[u]?.[0] ?? null;
  status = (u: string) => { const i = this.latest(u); return !i ? "Not inspected" : i.verdict === "PASS" ? "Indexed" : i.verdict === "NEUTRAL" ? "Excluded" : "Not indexed"; };
  crawl = (u: string): Crawl | null => this.invMap.get(u)?.crawl ?? null;
  path = pathOf;
}
