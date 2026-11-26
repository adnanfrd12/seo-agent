/**
 * Analyses shared by several Search Console screens and the quick-wins engine (all numbers from the synced
 * data; reasons from fixed rules).
 */
import { groupM, type G, type M, type R } from "./g";
import { isQuestion, matcher, pathOf, stems, titleCase, words } from "./model";

export interface QRow { query: string; page: string; clicks: number; impressions: number; ctr: number; pos: number; dClicks: number; dPos: number | null; prevClicks: number }

/** Each query with its change and its main landing page (the page with most impressions). */
export function queryTable(g: G, filter?: (q: string) => boolean): QRow[] {
  const cur = g.queries(), prev = g.queries(true);
  const land = new Map<string, { page: string; i: number }>();
  for (const x of g.qp()) { const q = String(x.query), i = Number(x.impressions), cur2 = land.get(q); if (!cur2 || i > cur2.i) land.set(q, { page: String(x.page), i: (cur2?.page === String(x.page) ? cur2.i : 0) + i }); }
  const out: QRow[] = [];
  for (const [q, v] of cur) {
    if (filter && !filter(q)) continue;
    const p = prev.get(q);
    out.push({ query: q, page: land.get(q)?.page ?? "", clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, pos: v.pos ?? 0, dClicks: v.clicks - (p?.clicks ?? 0), dPos: p?.pos != null && v.pos != null ? v.pos - p.pos : null, prevClicks: p?.clicks ?? 0 });
  }
  return out.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export interface PRow { page: string; clicks: number; impressions: number; ctr: number; pos: number; prev: M | null; dClicks: number; queries: number; topQuery: string | null; topQueryImpr: number }
export function pageTable(g: G): PRow[] {
  const cur = g.pages(), prev = g.pages(true);
  const qs = new Map<string, Map<string, number>>();
  for (const x of g.qp()) { const p = String(x.page), m = qs.get(p) ?? new Map<string, number>(); m.set(String(x.query), (m.get(String(x.query)) ?? 0) + Number(x.impressions)); qs.set(p, m); }
  return [...cur].map(([page, v]) => {
    const pr = prev.get(page) ?? null, top = [...(qs.get(page) ?? new Map())].sort((a, b) => b[1] - a[1])[0];
    return { page, clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, pos: v.pos ?? 0, prev: pr, dClicks: v.clicks - (pr?.clicks ?? 0), queries: qs.get(page)?.size ?? 0, topQuery: top?.[0] ?? null, topQueryImpr: top?.[1] ?? 0 };
  }).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

/** Main cause of a page's click drop: fewer impressions, a worse position or a lower CTR. */
export function dropCause(p: PRow) {
  if (!p.prev) return "New";
  const imprEffect = (p.impressions - p.prev.impressions) * p.prev.ctr, ctrEffect = (p.ctr - p.prev.ctr) * p.impressions;
  if (p.prev.pos != null && p.pos - p.prev.pos > 1) return `Position dropped (${p.prev.pos.toFixed(1)} → ${p.pos.toFixed(1)})`;
  return imprEffect <= ctrEffect ? `Fewer impressions (${Math.round(p.prev.impressions)} → ${Math.round(p.impressions)})` : `Lower CTR (${(p.prev.ctr * 100).toFixed(1)}% → ${(p.ctr * 100).toFixed(1)}%)`;
}

/* ---------------------------------------------------------------- page watchlists */
export function noClicks(g: G, pages: PRow[]) {
  return pages.filter((p) => p.impressions > 0 && p.clicks === 0).map((p) => {
    const reason = p.pos > 20 ? "Ranks too low to be seen" : p.pos > 10 ? "On page two" : p.topQuery && isQuestion(p.topQuery) ? "Answered on the results page" : "Title doesn't match what people search";
    const todo = p.pos > 20 ? "Add a section that answers the top query; link to it from related pages" : p.pos > 10 ? "Strengthen the page for its top query (title, H1, internal links)" : p.topQuery && isQuestion(p.topQuery) ? "Add a direct 40–60 word answer plus detail the snippet can't show" : "Rewrite the title around the top query";
    return { ...p, reason, todo, status: g.status(p.page) };
  }).sort((a, b) => b.impressions - a.impressions);
}
export type NoImprCat = "Not indexed" | "Indexed but no demand" | "Duplicate/canonicalised" | "Excluded on purpose (noindex/robots)" | "Redirect or 404" | "Not inspected yet";
export function noImpressions(g: G, pages: PRow[]) {
  const seen = new Set(pages.filter((p) => p.impressions > 0).map((p) => p.page));
  return g.inv.filter((r) => !seen.has(r.url)).map((r) => {
    const i = g.latest(r.url), c = r.crawl, cs = i?.coverageState ?? "";
    const cat: NoImprCat = c && ((c.status ?? 200) >= 300 || c.redirect) || /redirect|404|not found/i.test(cs) ? "Redirect or 404"
      : /noindex|robots/i.test(cs) || /noindex/i.test(`${c?.robots ?? ""} ${c?.xRobots ?? ""}`) ? "Excluded on purpose (noindex/robots)"
      : /canonical|duplicate|alternate/i.test(cs) ? "Duplicate/canonicalised" : !i ? "Not inspected yet" : i.verdict === "PASS" ? "Indexed but no demand" : "Not indexed";
    const todo = cat === "Redirect or 404" ? "Remove it from the sitemap and update links pointing to it" : cat === "Excluded on purpose (noindex/robots)" ? "Fine if intended; otherwise remove the noindex / robots block"
      : cat === "Duplicate/canonicalised" ? "Merge into the canonical page or make it clearly different" : cat === "Indexed but no demand" ? "Retarget the page to a topic people search for, or merge it"
      : cat === "Not inspected yet" ? "Waits for the inspection queue" : "Add internal links from strong pages and improve the content";
    return { url: r.url, status: i ? (i.verdict === "PASS" ? "Indexed" : cs) : "Not inspected", linksIn: g.linksIn.get(r.url) ?? 0, lastCrawl: i?.lastCrawlTime ?? null, cat, reason: cat === "Indexed but no demand" ? "Indexed, but nobody searches for what it covers" : cs || cat, todo };
  });
}
export function ctrChanges(g: G, pages: PRow[]) {
  return pages.filter((p) => p.prev && p.impressions >= 100 && p.prev.impressions >= 100).map((p) => {
    const d = p.ctr - p.prev!.ctr, dPos = p.prev!.pos != null ? p.pos - p.prev!.pos : 0;
    const reason = Math.abs(dPos) > 0.7 ? `Moved ${dPos < 0 ? "up" : "down"} ${Math.abs(dPos).toFixed(1)} positions`
      : d < 0 && p.topQuery && isQuestion(p.topQuery) ? "Same position, CTR fell: probably an AI Overview or answer box"
      : p.impressions > p.prev!.impressions * 1.3 ? "More impressions from broad, low-intent queries"
      : d > 0 ? "Title now matches top queries better" : "Snippet change or a competitor's rich result";
    return { ...p, ctrPrev: p.prev!.ctr, dCtr: d, dPos, gained: p.impressions * d, reason };
  });
}

/* ---------------------------------------------------------------- opportunities */
export interface QP { query: string; page: string; clicks: number; impressions: number; ctr: number; pos: number }
export function queryPages(g: G, prev = false): QP[] {
  const map = new Map<string, R[]>();
  for (const x of g.qp(prev)) { const k = `${x.query}\u0000${x.page}`; const a = map.get(k); if (a) a.push(x); else map.set(k, [x]); }
  return [...map].map(([k, v]) => { const [query, page] = k.split("\u0000"); const s = groupM(v, () => "x").get("x")!; return { query, page, clicks: s.clicks, impressions: s.impressions, ctr: s.ctr, pos: s.pos ?? 0 }; });
}
export function strikingDistance(g: G) {
  return queryPages(g).filter((r) => r.pos >= 8 && r.pos <= 20 && r.impressions >= 100)
    .map((r) => ({ ...r, potential: Math.max(0, r.impressions * (g.expected(3) - r.ctr)) })).sort((a, b) => b.potential - a.potential);
}
export function belowExpected(g: G) {
  return queryPages(g).filter((r) => r.impressions >= 200 && r.pos <= 20 && r.ctr < 0.75 * g.expected(r.pos))
    .map((r) => ({ ...r, exp: g.expected(r.pos), missed: r.impressions * (g.expected(r.pos) - r.ctr) })).sort((a, b) => b.missed - a.missed);
}
/**
 * Lost queries: searches with clicks or impressions in the previous period and none in this one, with the page
 * they landed on before and the likely cause. Note: Search Console hides rare (anonymized) queries, so low-volume
 * queries can also drop out of the data without being lost.
 */
export function lostQueries(g: G) {
  const cur = g.queries(), prev = g.queries(true), pagesNow = g.pages();
  const land = new Map<string, { page: string; i: number }>();
  for (const [k, v] of groupM(g.qp(true), (x) => `${x.query}\u0000${x.page}`)) { const [q, p] = k.split("\u0000"); const c = land.get(q); if (!c || v.impressions > c.i) land.set(q, { page: p, i: v.impressions }); }
  return [...prev].filter(([q, v]) => !cur.has(q) && (v.clicks > 0 || v.impressions > 0)).map(([q, v]) => {
    const page = land.get(q)?.page ?? "", c = page ? g.crawl(page) : null, st = page ? g.status(page) : "";
    const cause = !page ? "No landing page recorded"
      : c?.redirect ? "Landed on a URL that now redirects"
      : c && (c.status ?? 200) >= 400 ? `Page now returns ${c.status}`
      : st.startsWith("Not indexed") ? "Page dropped out of Google's index"
      : !pagesNow.has(page) ? "Page no longer shown for any search"
      : v.pos != null && v.pos > 20 ? "Ranked low before; fell out of the results"
      : v.impressions < 10 ? "Rare search (may be hidden by Google's privacy filter)"
      : "Another result replaced the page for this search";
    return { query: q, page, prevClicks: v.clicks, prevImpr: v.impressions, prevPos: v.pos, pageNow: pagesNow.get(page)?.clicks ?? 0, status: st, cause };
  }).sort((a, b) => b.prevClicks - a.prevClicks || b.prevImpr - a.prevImpr);
}
/** Searches still shown but bringing fewer clicks than last period (largest loss first). */
export function decliningQueries(g: G) {
  const prevQ = g.queries(true);
  return queryTable(g).filter((r) => r.dClicks < 0).map((r) => { const p = prevQ.get(r.query); return { ...r, prevImpr: p?.impressions ?? 0, prevPos: p?.pos ?? null }; }).sort((a, b) => a.dClicks - b.dClicks);
}
export function suggestTitle(g: G, query: string) {
  const brand = g.settings.brand[0] ? titleCase(g.settings.brand[0]) : "";
  let t = titleCase(query);
  if (brand && t.length + brand.length + 3 <= 60) t = `${t} | ${brand}`;
  return t.length < 50 ? `${t.replace(/ \| .*/, "")} – [Your Unique Benefit]${brand ? ` | ${brand}` : ""}`.slice(0, 60) : t.slice(0, 60);
}
export function titleCandidates(g: G, pages: PRow[]) {
  return pages.filter((p) => p.pos > 0 && p.pos <= 8.5 && p.impressions >= 100).map((p) => {
    const exp = pageExpected(g, p.page);
    return { ...p, exp, title: g.crawl(p.page)?.title ?? null };
  }).filter((p) => p.ctr < 0.8 * p.exp && p.topQuery).map((p) => ({ ...p, suggested: suggestTitle(g, p.topQuery!), gain: p.impressions * (0.85 * p.exp - p.ctr) })).sort((a, b) => b.gain - a.gain);
}
/** Impression-weighted expected CTR of a page's queries. */
export function pageExpected(g: G, page: string) {
  let i = 0, e = 0;
  for (const r of queryPages(g).filter((x) => x.page === page)) { i += r.impressions; e += r.impressions * g.expected(r.pos); }
  return i ? e / i : 0;
}
export function pageTwoRescue(g: G) {
  const cur = queryTable(g), prev = g.queries(true);
  return cur.filter((r) => { const p = prev.get(r.query); return p?.pos != null && p.pos <= 10 && r.pos > 10; });
}

/* ---------------------------------------------------------------- cannibalization */
export function cannibal(g: G) {
  const byQ = new Map<string, QP[]>();
  for (const r of queryPages(g)) { const a = byQ.get(r.query); if (a) a.push(r); else byQ.set(r.query, [r]); }
  const weeks = (q: string) => {
    // how often the top page changed week to week over the last 8 weeks
    const from = new Date(Date.parse(`${g.meta.end}T00:00:00Z`) - 56 * 86_400_000).toISOString().slice(0, 10);
    const wk = new Map<number, Map<string, number>>();
    for (const x of g.QP) { if (x.query !== q || String(x.date) < from) continue; const w = Math.floor((Date.parse(String(x.date)) - Date.parse(from)) / (7 * 86_400_000)); const mm = wk.get(w) ?? new Map(); mm.set(String(x.page), (mm.get(String(x.page)) ?? 0) + Number(x.impressions)); wk.set(w, mm); }
    const tops = [...wk].sort((a, b) => a[0] - b[0]).map(([, mm]) => [...mm].sort((a, b) => b[1] - a[1])[0]?.[0]);
    return { switches: tops.filter((t, i) => i && t !== tops[i - 1]).length, weekly: [...wk].sort((a, b) => a[0] - b[0]).map(([w, mm]) => ({ w, pages: Object.fromEntries(mm) as Record<string, number> })) };
  };
  const out: { query: string; total: number; pages: (QP & { share: number })[]; switches: number; weekly: { w: number; pages: Record<string, number> }[] }[] = [];
  for (const [q, rs] of byQ) {
    const tot = rs.reduce((a, r) => a + r.impressions, 0);
    const big = rs.filter((r) => r.impressions / tot >= 0.1);
    if (big.length >= 2 && tot >= 20) { const w = weeks(q); out.push({ query: q, total: tot, pages: big.map((r) => ({ ...r, share: r.impressions / tot })).sort((a, b) => b.share - a.share), ...w }); }
  }
  return out.sort((a, b) => b.total - a.total);
}

/* ---------------------------------------------------------------- questions */
export function answerFormat(q: string) {
  if (/\b(cost|costs|price|prices|pricing|how much)\b/i.test(q)) return "Price table";
  if (/\b(how long|when|how often|lifespan)\b/i.test(q)) return "Timeline list";
  if (/\b(vs\.?|versus|better than|difference between|compare)\b/i.test(q)) return "Comparison table";
  if (words(q) >= 8) return "Quick-answer box + checklist";
  return "40–60 word direct answer";
}
/** Whether a page already has a heading containing the question's main words. */
export function hasHeading(g: G, page: string, q: string) {
  const hs = (g.crawl(page)?.headings ?? []).map((h) => h.toLowerCase());
  const st = stems(q);
  return hs.some((h) => st.filter((w) => h.includes(w)).length >= Math.max(2, Math.ceil(st.length * 0.7)));
}

/* ---------------------------------------------------------------- local */
export function cityOf(g: G, q: string) { return g.settings.cities.find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)) ?? null; }
export function serviceOf(g: G, q: string) { return g.settings.services.find((s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(q)) ?? null; }
export const isQ = matcher;
export const pathOnly = pathOf;
