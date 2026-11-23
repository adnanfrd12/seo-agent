/**
 * "What changed recently": each day in the period and each slice (country, channel, source, browser, device,
 * landing page) is compared with the average of the same weekday over the previous 4 weeks. The biggest
 * deviations by volume become plain-English cards, with the second dimension that explains most of the excess.
 */
import type { G } from "./g";
import { addDays, group, shortDate, sum, type Obj } from "./model";

export interface InsightCard { tone: "good" | "bad" | "warn"; title: string; text: string; when: string }

const N = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString("en-US"));
const P = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;

export function notableChanges(g: G): InsightCard[] {
  const all = g.S; // every session row (bots included: unusual activity is what this looks for)
  const places = g.GE;
  const slices: { dim: string; label: string; key: (x: Obj) => string; driver: (x: Obj) => string; driverName: string }[] = [
    { dim: "country", label: "from", key: (x) => String(x.country), driver: (x) => `${x.browser} on ${x.deviceCategory}`, driverName: "browser" },
    { dim: "channel", label: "in", key: (x) => String(x.ch), driver: (x) => String(x.land), driverName: "landing page" },
    { dim: "source", label: "from", key: (x) => g.source(x), driver: (x) => String(x.land), driverName: "landing page" },
    { dim: "browser", label: "from", key: (x) => String(x.browser), driver: (x) => String(x.deviceCategory), driverName: "device" },
    { dim: "device", label: "on", key: (x) => String(x.deviceCategory), driver: (x) => String(x.ch), driverName: "channel" },
    { dim: "landing page", label: "on", key: (x) => String(x.land), driver: (x) => String(x.ch), driverName: "channel" },
  ];
  const byDay = group(all, (x) => String(x.date)), byDayGeo = group(places, (x) => String(x.date));
  type Hit = { slice: (typeof slices)[number]; value: string; day: string; actual: number; expected: number; pv: number; eng: number; score: number; driver: string };
  const hits: Hit[] = [];
  for (let d = g.p.start; d <= g.p.end; d = addDays(d, 1)) {
    if (!(byDay.get(d) ?? []).length) continue;
    for (const s of slices) {
      const src = s.dim === "country" ? byDayGeo : byDay;
      const now = group(src.get(d) ?? [], s.key);
      const before = [7, 14, 21, 28].map((k) => group(src.get(addDays(d, -k)) ?? [], s.key));
      for (const [value, rows] of now) {
        if (!value || value === "(not set)") continue;
        const actual = sum(rows, (x) => Number(x.sessions));
        if (actual < 10) continue;
        const expected = sum(before, (m) => sum(m.get(value) ?? [], (x) => Number(x.sessions))) / 4;
        const score = (actual - expected) / Math.max(expected, 5);
        if (Math.abs(score) < 1.5) continue;
        const drivers = [...group(rows, s.driver)].map(([k, v]) => [k, sum(v, (x) => Number(x.sessions))] as const).sort((a, b) => b[1] - a[1]);
        hits.push({ slice: s, value, day: d, actual, expected, pv: sum(rows, (x) => Number(x.screenPageViews)), eng: sum(rows, (x) => Number(x.engagedSessions)), score, driver: drivers[0]?.[0] ?? "" });
      }
    }
  }
  const seen = new Set<string>();
  const cards: InsightCard[] = [];
  for (const h of hits.sort((a, b) => b.score * Math.sqrt(b.actual) - a.score * Math.sqrt(a.actual))) {
    const k = `${h.slice.dim}|${h.value}`;
    if (seen.has(k) || cards.length >= 2) continue;
    seen.add(k);
    const er = h.actual ? h.eng / h.actual : 0;
    const bot = er < 0.2;
    cards.push({
      tone: bot || h.score < 0 ? "warn" : "good",
      title: h.slice.dim === "country" ? `Unusual activity from ${h.value}` : `${h.score > 0 ? "Spike" : "Drop"} in ${h.value} ${h.slice.dim === "channel" ? "traffic" : h.slice.dim === "device" ? "visits" : `(${h.slice.dim})`}`,
      text: `Sessions reached ${N(h.actual)} on ${shortDate(h.day)} vs ~${N(h.expected)} expected (same weekday, last 4 weeks), ${N(h.pv)} page views, led by ${h.driver} (${h.slice.driverName}).${bot ? ` Only ${P(er)} of these visits engaged: likely bots. ${g.qualified ? "Excluded from lead counts." : ""}` : ""}`,
      when: shortDate(h.day),
    });
  }
  // period-level cards: AI assistants and the main lead type's change
  const T = g.total(), Tp = g.total(true);
  const aiS = g.sCur().filter((x) => x.ch === "AI Assistant"), ai = g.agg(aiS, g.lCur().filter((x) => x.ch === "AI Assistant"));
  const when = `Last ${g.p.days} days`;
  if (ai.sessions) {
    const top = [...group(aiS, (x) => g.ai(x))].sort((a, b) => sum(b[1], (x) => Number(x.sessions)) - sum(a[1], (x) => Number(x.sessions)))[0]?.[0];
    cards.push({ tone: ai.lr >= T.lr ? "good" : "warn", title: `AI assistants sent ${N(ai.sessions)} sessions and ${N(ai.leads)} leads`, text: `Lead rate ${P(ai.lr)} vs ${P(T.lr)} for the whole site.${top ? ` ${top} is the largest source.` : ""}`, when });
  }
  const types = g.types().map((t) => ({ t, cur: T.types[t] ?? 0, prev: Tp.types[t] ?? 0 })).filter((x) => x.cur || x.prev).sort((a, b) => b.cur + b.prev - (a.cur + a.prev));
  for (const x of types) {
    if (cards.length >= 4) break;
    const d = x.prev ? Math.round(((x.cur - x.prev) / x.prev) * 100) : null;
    cards.push({ tone: x.cur >= x.prev ? "good" : "bad", title: `${x.t} leads ${x.cur >= x.prev ? "up" : "down"}${d != null ? ` ${Math.abs(d)}%` : ""}`, text: `${N(x.cur)} ${x.t.toLowerCase()} leads vs ${N(x.prev)} in the previous period.`, when });
  }
  if (cards.length < 4 && Tp.sessions) {
    const d = (T.sessions - Tp.sessions) / Tp.sessions;
    cards.push({ tone: d >= 0 ? "good" : "bad", title: `Visits ${d >= 0 ? "up" : "down"} ${Math.abs(Math.round(d * 100))}%`, text: `${N(T.sessions)} sessions vs ${N(Tp.sessions)} in the previous period, engagement rate ${P(T.er)}.`, when });
  }
  return cards.slice(0, 4);
}
