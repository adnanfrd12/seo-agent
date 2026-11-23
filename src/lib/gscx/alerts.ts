/**
 * Alerts and written insights for Search Console, computed from the synced history with fixed rules
 * (each alert fires once per event; weekdays are compared with the same weekday so weekends don't fire).
 */
import { addDays, groupM, m, type G } from "./g";
import { pageTable } from "./analysis";
import { pathOf } from "./model";

export interface AlertEvent { date: string; severity: "High" | "Medium" | "Low"; type: string; text: string }
export const RULES: { rule: string; scope: string; condition: string; sends: string }[] = [
  { rule: "Daily anomaly", scope: "Property clicks and impressions", condition: "Beyond 3 standard deviations of the same weekday over the previous 4 weeks", sends: "In-portal" },
  { rule: "Money keyword drop", scope: "Top 10 non-brand queries by clicks", condition: "Position worse by 3+ or clicks −30% week over week", sends: "In-portal" },
  { rule: "Page left the index", scope: "Pages with clicks in the last 28 days", condition: "Latest inspection no longer PASS", sends: "In-portal" },
  { rule: "Not-indexed reason grows", scope: "Every coverage state", condition: "+20% and 10+ URLs since the previous inspection round", sends: "In-portal" },
  { rule: "Sitemap problem", scope: "Every submitted sitemap", condition: "Errors > 0 or not read in 14 days", sends: "In-portal" },
  { rule: "Google canonical changed", scope: "Pages with clicks", condition: "googleCanonical differs from the previous inspection", sends: "In-portal" },
  { rule: "Brand demand drop", scope: "Brand queries", condition: "Impressions −25% week over week", sends: "In-portal" },
  { rule: "Data is late", scope: "Property", condition: "Newest Search Console day older than 4 days", sends: "In-portal" },
];

export function alertEvents(g: G): AlertEvent[] {
  const out: AlertEvent[] = [];
  const web = groupM(g.T.filter((x) => x.type === "web"), (x) => String(x.date));
  const from = addDays(g.meta.end, -89);
  // daily anomaly: same weekday, previous 4 weeks
  for (let d = from; d <= g.meta.end; d = addDays(d, 1)) {
    const cur = web.get(d); if (!cur) continue;
    const past = [7, 14, 21, 28].map((k) => web.get(addDays(d, -k))?.clicks).filter((v): v is number => v != null);
    if (past.length < 4) continue;
    const mean = past.reduce((a, b) => a + b, 0) / 4, sd = Math.sqrt(past.reduce((a, b) => a + (b - mean) ** 2, 0) / 4) || 1;
    const z = (cur.clicks - mean) / sd;
    if (Math.abs(z) >= 3 && Math.abs(cur.clicks - mean) >= 5) out.push({ date: d, severity: Math.abs(z) >= 5 ? "High" : "Medium", type: "Daily anomaly", text: `Clicks ${cur.clicks} vs ~${Math.round(mean)} expected on ${d}.` });
  }
  // weekly rules: brand demand and money keywords
  const weekStart = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
  const weeks: string[] = []; for (let d = weekStart(from); d <= g.meta.end; d = addDays(d, 7)) weeks.push(d);
  const q = g.Q.filter((x) => String(x.date) >= addDays(from, -7));
  const byWeek = (pred: (q: string) => boolean) => new Map([...groupM(q.filter((x) => pred(String(x.query))), (x) => weekStart(String(x.date)))]);
  const brand = byWeek(g.isBrand);
  for (let i = 1; i < weeks.length; i++) {
    const a = brand.get(weeks[i - 1])?.impressions ?? 0, b = brand.get(weeks[i])?.impressions ?? 0;
    if (a >= 20 && b < a * 0.75 && addDays(weeks[i], 6) <= g.meta.end) out.push({ date: addDays(weeks[i], 6), severity: "Medium", type: "Brand demand drop", text: `Brand impressions ${a} → ${b} week over week.` });
  }
  const top = [...groupM(q.filter((x) => !g.isBrand(String(x.query))), (x) => String(x.query))].sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 10).map(([k]) => k);
  for (const kw of top) {
    const s = groupM(q.filter((x) => x.query === kw), (x) => weekStart(String(x.date)));
    for (let i = 1; i < weeks.length; i++) {
      const a = s.get(weeks[i - 1]), b = s.get(weeks[i]); if (!a || !b || addDays(weeks[i], 6) > g.meta.end) continue;
      if ((a.pos != null && b.pos != null && b.pos - a.pos >= 3) || (a.clicks >= 5 && b.clicks <= a.clicks * 0.7)) out.push({ date: addDays(weeks[i], 6), severity: "High", type: "Money keyword drop", text: `"${kw}": clicks ${a.clicks} → ${b.clicks}, position ${a.pos?.toFixed(1)} → ${b.pos?.toFixed(1)}.` });
    }
  }
  // index and sitemap rules
  const clicked = new Set(pageTable(g).filter((p) => p.clicks > 0).map((p) => p.page));
  for (const [url, h] of Object.entries(g.insp)) {
    if (h[0] && h[1] && h[1].verdict === "PASS" && h[0].verdict !== "PASS" && clicked.has(url)) out.push({ date: h[0].at.slice(0, 10), severity: "High", type: "Page left the index", text: `${pathOf(url)}: ${h[0].coverageState}.` });
    if (h[0] && h[1] && h[0].googleCanonical && h[1].googleCanonical && h[0].googleCanonical !== h[1].googleCanonical && clicked.has(url)) out.push({ date: h[0].at.slice(0, 10), severity: "Medium", type: "Google canonical changed", text: `${pathOf(url)}: ${pathOf(h[1].googleCanonical)} → ${pathOf(h[0].googleCanonical)}.` });
  }
  for (const s of g.sitemaps) {
    if (s.errors > 0) out.push({ date: g.meta.end, severity: "High", type: "Sitemap problem", text: `${pathOf(s.path)} has ${s.errors} error(s).` });
    else if (!s.lastDownloaded || Date.now() - Date.parse(s.lastDownloaded) > 14 * 86_400_000) out.push({ date: g.meta.end, severity: "Low", type: "Sitemap problem", text: `${pathOf(s.path)} not read by Google in 14+ days.` });
  }
  if (Date.now() - Date.parse(`${g.meta.end}T00:00:00Z`) > 5 * 86_400_000) out.push({ date: new Date().toISOString().slice(0, 10), severity: "Medium", type: "Data is late", text: `Newest Search Console day is ${g.meta.end}.` });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Up to 6 plain-English insight cards from the numbers. */
export function insights(g: G): { tone: "good" | "bad" | "warn"; title: string; text: string; when: string }[] {
  const cur = g.totals(), prev = g.totals(true), when = `Last ${g.p.days} days`;
  const cards: { tone: "good" | "bad" | "warn"; title: string; text: string; when: string }[] = [];
  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);
  cards.push({ tone: cur.clicks >= prev.clicks ? "good" : "bad", title: `Clicks ${cur.clicks >= prev.clicks ? "up" : "down"} ${Math.abs(pct(cur.clicks, prev.clicks))}%`, text: `${cur.clicks} clicks vs ${prev.clicks}; impressions ${cur.impressions} vs ${prev.impressions}; position ${cur.pos?.toFixed(1)} vs ${prev.pos?.toFixed(1)}.`, when });
  const pages = pageTable(g).sort((a, b) => a.dClicks - b.dClicks);
  const worst = pages[0], best = pages.at(-1);
  if (worst && worst.dClicks < 0) cards.push({ tone: "bad", title: `${pathOf(worst.page)} lost the most clicks`, text: `${worst.prev?.clicks ?? 0} → ${worst.clicks} clicks; position ${worst.prev?.pos?.toFixed(1) ?? "–"} → ${worst.pos.toFixed(1)}.`, when });
  if (best && best.dClicks > 0) cards.push({ tone: "good", title: `${pathOf(best.page)} gained the most clicks`, text: `${best.prev?.clicks ?? 0} → ${best.clicks} clicks; top query "${best.topQuery ?? "–"}".`, when });
  const dev = groupM(g.DEV.filter(g.inCur), (x) => String(x.device)), devP = groupM(g.DEV.filter(g.inPrev), (x) => String(x.device));
  const mob = dev.get("MOBILE"), mobP = devP.get("MOBILE");
  if (mob && mobP && Math.abs(mob.clicks - mobP.clicks) >= 5) cards.push({ tone: mob.clicks >= mobP.clicks ? "good" : "warn", title: `Mobile clicks ${mob.clicks >= mobP.clicks ? "up" : "down"} ${Math.abs(pct(mob.clicks, mobP.clicks))}%`, text: `${mobP.clicks} → ${mob.clicks}; mobile position ${mobP.pos?.toFixed(1)} → ${mob.pos?.toFixed(1)}.`, when });
  const imprUp = cur.impressions > prev.impressions * 1.2 && cur.clicks <= prev.clicks * 1.05;
  if (imprUp) cards.push({ tone: "warn", title: "Shown more, clicked about the same", text: `Impressions +${pct(cur.impressions, prev.impressions)}% while clicks changed ${pct(cur.clicks, prev.clicks)}%: often AI Overviews or answer boxes on question searches.`, when });
  const qAll = m(g.q()), hidden = cur.clicks ? 1 - qAll.clicks / cur.clicks : 0;
  if (hidden > 0.3) cards.push({ tone: "warn", title: `${Math.round(hidden * 100)}% of clicks come from private searches`, text: "Google hides rare or personal queries; these clicks count in totals but not in any query list.", when });
  return cards.slice(0, 6);
}
