/**
 * Search Console quick wins: fixed rules over the last 28 days that name the page, the exact place on it,
 * the evidence (query rows), the steps, ready-to-paste text and the extra clicks a month.
 * Score = gain × confidence (1 / 0.75 / 0.5) ÷ effort (1 / 2 / 3). Suggested text never invents facts:
 * anything not on the site is a [placeholder].
 */
import type { G } from "./g";
import { answerFormat, belowExpected, cannibal, cityOf, ctrChanges, hasHeading, noClicks, noImpressions, pageExpected, pageTable, pageTwoRescue, queryPages, suggestTitle, type QP } from "./analysis";
import { isQuestion, pathOf, stems, titleCase, words } from "./model";

export interface GscWin {
  key: string; type: string; title: string; page: string; where: string; why: string; steps: string[]; suggest?: string; measure?: string;
  table?: { cols: string[]; rows: (string | number)[][] }; evidence?: [string, string][];
  gain: number; effort: "Low" | "Medium" | "High"; conf: "High" | "Medium" | "Low"; score: number; rank: number;
}
const EFF = { Low: 1, Medium: 2, High: 3 } as const, CONF = { High: 1, Medium: 0.75, Low: 0.5 } as const;
const P = (v: number) => `${(v * 100).toFixed(1)}%`;
const N = (v: number) => Math.round(v).toLocaleString("en-US");

export const GSC_SCREEN_TYPES: Record<string, string[] | "*"> = {
  overview: "*",
  queries: ["Title rewrite", "Add query to title/H1", "Internal links", "Answer a question (H2)", "New page", "Content refresh"],
  pages: ["Title rewrite", "Meta description", "Content refresh", "Merge / redirect", "Get indexed"],
  watch: ["Page with no clicks", "Page with no impressions", "CTR dropped", "Title rewrite", "Meta description"],
  segments: ["Image SEO", "Snippet / AI answer format", "FAQ + schema", "Mobile gap"],
  ai: ["Answer a question (H2)", "FAQ + schema", "Snippet / AI answer format", "AI search content"],
  brand: ["Brand and trust"],
  opps: ["Add query to title/H1", "Internal links", "Title rewrite", "Content refresh", "New page"],
  cannibal: ["Merge / redirect"],
  local: ["Local SEO", "New page"],
  indexing: ["Technical fix", "Get indexed", "Page with no impressions"],
  sitemaps: ["Sitemap", "FAQ + schema", "Rich results"],
  alerts: ["CTR dropped", "Content refresh", "Brand and trust"],
};
export const gscForScreen = (all: GscWin[], s: string) => { const t = GSC_SCREEN_TYPES[s]; return t === "*" ? all : all.filter((w) => (t ?? []).includes(w.type)); };

export function gscQuickWins(g: G): GscWin[] {
  const out: Omit<GscWin, "score" | "rank">[] = [];
  const keys = new Set<string>();
  const add = (w: Omit<GscWin, "score" | "rank">) => { if (keys.has(w.key) || !(w.gain > 0)) return; keys.add(w.key); w.gain = Math.max(0.1, Math.round(w.gain * 10) / 10); out.push(w); };
  const f = 30 / g.p.days;
  const pages = pageTable(g), qps = queryPages(g);
  const brand = g.settings.brand[0] ? titleCase(g.settings.brand[0]) : "[Brand]";
  const qRows = (page: string, n = 5) => qps.filter((r) => r.page === page).sort((a, b) => b.impressions - a.impressions).slice(0, n);
  const tbl = (rs: QP[]) => ({ cols: ["Query", "Impr.", "Pos", "CTR"], rows: rs.map((r) => [r.query, N(r.impressions), r.pos.toFixed(1), P(r.ctr)]) });
  const path = (u: string) => pathOf(u);
  const titleWin = new Set<string>();

  // 1. title rewrite
  for (const p of pages.filter((x) => x.pos > 0 && x.pos <= 8.5 && x.impressions >= 300)) {
    const exp = pageExpected(g, p.page), top = qRows(p.page).find((r) => !g.isBrand(r.query));
    if (!top || p.ctr >= 0.8 * exp) continue;
    titleWin.add(p.page);
    add({ key: `title${p.page}`, type: "Title rewrite", page: path(p.page), where: "Title tag (and the meta description)", effort: "Low", conf: "High", gain: p.impressions * (0.85 * exp - p.ctr) * f,
      title: `Rewrite the title of ${path(p.page)} around "${top.query}"`, why: `${N(p.impressions)} impressions at position ${p.pos.toFixed(1)} but CTR ${P(p.ctr)} vs ${P(exp)} expected for its queries.`,
      table: tbl(qRows(p.page)), steps: ["Put the top query at the start of the title, 50–60 characters.", "Write a meta description that answers the query and gives a reason to click.", "Keep the H1 consistent with the new title."],
      suggest: `Title: ${suggestTitle(g, top.query)}\nCurrent: ${g.crawl(p.page)?.title ?? "(not crawled yet)"}\nMeta description: ${titleCase(top.query)} from ${brand}. [What makes you different, e.g. years in business or turnaround]. Call [phone] or get a free quote today.`,
      measure: "CTR of this page in Search Console, 28 days after the change" });
  }
  // 2. meta description
  for (const p of pages.filter((x) => x.pos > 0 && x.pos <= 5.5 && x.impressions >= 150 && !titleWin.has(x.page))) {
    const exp = pageExpected(g, p.page); if (p.ctr >= exp) continue;
    const top = qRows(p.page)[0];
    add({ key: `meta${p.page}`, type: "Meta description", page: path(p.page), where: "Meta description", effort: "Low", conf: "Medium", gain: p.impressions * (exp - p.ctr) * 0.5 * f,
      title: `Write a sharper meta description for ${path(p.page)}`, why: `Position ${p.pos.toFixed(1)} with CTR ${P(p.ctr)} vs ${P(exp)} expected.`, table: tbl(qRows(p.page)),
      steps: ["Answer the top query in the first sentence.", "Add a concrete reason to click (a detail the results page doesn't show).", "Keep it 140–160 characters."],
      suggest: `${top ? titleCase(top.query) : "[Service]"} by ${brand}: [one concrete benefit]. [Detail people can't see on Google, e.g. photos of past work]. Get a free quote.`.slice(0, 160) });
  }
  // 3. add query to title/H1 · 8. internal links
  for (const r of qps.filter((x) => !g.isBrand(x.query) && x.pos >= 4 && x.pos <= 15 && x.impressions >= 250)) {
    const c = g.crawl(r.page); if (!c) continue;
    const have = `${c.title ?? ""} ${c.h1 ?? ""}`.toLowerCase();
    const missing = stems(r.query).filter((w) => !have.includes(w));
    if (missing.length < 2) continue;
    add({ key: `addq${r.page}|${r.query}`, type: "Add query to title/H1", page: path(r.page), where: "Title tag, H1 and first sentence", effort: "Low", conf: "Medium",
      gain: r.impressions * Math.max(0, g.expected(Math.max(3, r.pos - 3)) - r.ctr) * 0.6 * f,
      title: `Add "${r.query}" to the title and H1 of ${path(r.page)}`, why: `"${r.query}" has ${N(r.impressions)} impressions at position ${r.pos.toFixed(1)}, but ${missing.join(", ")} aren't in the title or H1.`, table: tbl([r]),
      steps: ["Work the query's words into the title and H1 naturally.", "Use it in the first sentence of the page.", "Don't repeat it more than reads naturally."],
      suggest: `Title: ${suggestTitle(g, r.query)}\nH1: ${titleCase(r.query)}\nFirst sentence: Looking for ${r.query}? [One sentence on what you offer and where].` });
  }
  for (const r of qps.filter((x) => !g.isBrand(x.query) && x.pos >= 8 && x.pos <= 20 && x.impressions >= 500)) {
    const target = r.page, st = stems(r.query);
    const sources = pages.filter((p) => p.page !== target && p.clicks > 0 && !(g.crawl(p.page)?.links ?? []).includes(target) && (p.topQuery ? stems(p.topQuery).some((w) => st.includes(w)) : false)).slice(0, 2);
    if (!sources.length) continue;
    add({ key: `link${target}|${r.query}`, type: "Internal links", page: path(target), where: `Body text of ${sources.map((s) => path(s.page)).join(" and ")}`, effort: "Low", conf: "Medium",
      gain: r.impressions * Math.max(0, g.expected(Math.max(3, r.pos - 3)) - r.ctr) * 0.3 * f,
      title: `Link to ${path(target)} from ${sources.length} related page${sources.length > 1 ? "s" : ""} with "${r.query}" as anchor text`, why: `"${r.query}" sits at position ${r.pos.toFixed(1)} with ${N(r.impressions)} impressions; internal links help it climb.`, table: tbl([r]),
      steps: sources.map((s) => `On ${path(s.page)}, add a sentence linking to ${path(target)}.`), suggest: `Sentence: For more on ${r.query}, see our [${r.query}](${path(target)}) page.` });
  }
  // 4. answer a question · 6. snippet format · 5. FAQ
  const qsByPage = new Map<string, QP[]>();
  for (const r of qps.filter((x) => isQuestion(x.query))) { const a = qsByPage.get(r.page) ?? []; a.push(r); qsByPage.set(r.page, a); }
  for (const r of qps.filter((x) => isQuestion(x.query) && x.pos >= 3 && x.pos <= 20 && x.impressions >= 200)) {
    if (hasHeading(g, r.page, r.query) || !g.crawl(r.page)) continue;
    add({ key: `h2${r.page}|${r.query}`, type: "Answer a question (H2)", page: path(r.page), where: "New H2 section", effort: "Medium", conf: "Medium", gain: r.impressions * Math.max(0, g.expected(Math.max(3, r.pos - 4)) - r.ctr) * 0.5 * f,
      title: `Add an H2 that answers "${r.query}" on ${path(r.page)}`, why: `${N(r.impressions)} impressions at position ${r.pos.toFixed(1)}; the page has no heading for this question.`, table: tbl([r]),
      steps: ["Add the question word for word as an H2.", "Answer it in 40–60 words right under the heading.", `Follow with a ${answerFormat(r.query).toLowerCase()}.`, "Add it to FAQPage JSON-LD (same text as on the page)."],
      suggest: `<h2>${titleCase(r.query.replace(/\?*$/, "?"))}</h2>\n[40–60 word direct answer]\n[${answerFormat(r.query)}]` });
  }
  for (const r of qps.filter((x) => isQuestion(x.query) && x.pos <= 7 && x.impressions >= 50 && x.ctr < 0.7 * g.expected(x.pos))) add({
    key: `snip${r.page}|${r.query}`, type: "Snippet / AI answer format", page: path(r.page), where: "Under the matching heading", effort: "Low", conf: "Medium", gain: r.impressions * (g.expected(r.pos) - r.ctr) * 0.4 * f,
    title: `Format the answer to "${r.query}" so it earns the click`, why: `Position ${r.pos.toFixed(1)} but CTR ${P(r.ctr)} vs ${P(g.expected(r.pos))} expected: likely answered on the results page.`, table: tbl([r]),
    steps: ["Give a 40–60 word answer right under the matching heading.", "Add a list or table.", "Add something the snippet can't show (local prices, photos, checklist) to earn the click."] });
  for (const [page, qs] of qsByPage) {
    if (qs.length < 2) continue;
    const imp = qs.reduce((a, r) => a + r.impressions, 0);
    const hasFaq = (g.crawl(page)?.schema ?? []).includes("FAQPage");
    if (hasFaq) continue;
    add({ key: `faq${page}`, type: "FAQ + schema", page: path(page), where: "FAQ block + FAQPage JSON-LD", effort: "Medium", conf: "Medium", gain: imp * 0.008 * f,
      title: `Add an FAQ with ${qs.length} real questions to ${path(page)}`, why: `${qs.length} question queries (${N(imp)} impressions) land on this page and it has no FAQPage markup.`, table: tbl(qs.slice(0, 6)),
      steps: ["Add a visible FAQ block with these questions.", "Answer each in 2–4 sentences.", "Add FAQPage JSON-LD with exactly the visible text."], suggest: qs.slice(0, 6).map((r) => `Q: ${titleCase(r.query)}?\nA: [answer]`).join("\n") });
  }
  // 7. AI search content
  const prompt = new Map<string, number>();
  for (const r of qps.filter((x) => words(x.query) >= 8)) prompt.set(r.page, (prompt.get(r.page) ?? 0) + r.impressions);
  for (const [page, imp] of prompt) add({ key: `ai${page}`, type: "AI search content", page: path(page), where: "Quick-answer box at the top + checklist", effort: "Medium", conf: "Low", gain: imp * 0.05 * f,
    title: `Make ${path(page)} answer long, AI-style searches`, why: `${N(imp)} impressions from 8+ word, conversational queries.`, table: tbl(qps.filter((r) => r.page === page && words(r.query) >= 8).slice(0, 5)),
    steps: ["Add a 'Quick answer' box at the top.", "Add a step-by-step checklist.", "Add local specifics (areas served, typical timelines).", "List the page in /llms.txt."] });
  // 9. new page for cities with demand and no city page
  const cityDemand = new Map<string, number>();
  for (const r of g.queries()) { const c = cityOf(g, r[0]); if (c) cityDemand.set(c, (cityDemand.get(c) ?? 0) + r[1].impressions); }
  for (const [c, imp] of cityDemand) {
    if (imp < 100 || g.inv.some((r) => pathOf(r.url).toLowerCase().includes(c.replace(/\s+/g, "-")))) continue;
    add({ key: `city${c}`, type: "New page", page: `/${c.replace(/\s+/g, "-")}`, where: "New page", effort: "High", conf: "Medium", gain: imp * 0.03 * f,
      title: `Create a ${titleCase(c)} page`, why: `Searches naming ${titleCase(c)} had ${N(imp)} impressions but the site has no page for it.`,
      steps: ["Create the page with the city in the URL, title and H1.", "Show projects, reviews and the services offered there.", "Link to it from the home page 'Areas we serve' section."],
      suggest: `URL: /${c.replace(/\s+/g, "-")}\nTitle: ${titleCase(g.settings.services[0] ?? "[Service]")} in ${titleCase(c)} | ${brand}\nH1: ${titleCase(g.settings.services[0] ?? "[Service]")} in ${titleCase(c)}\nSections: services · recent projects in ${titleCase(c)} · reviews · FAQ · contact` });
  }
  // 10. merge / redirect (cannibalization)
  for (const c of cannibal(g).slice(0, 15)) {
    const [a, b] = c.pages; if (!a || !b || b.share >= 0.3) continue;
    add({ key: `merge${c.query}`, type: "Merge / redirect", page: path(b.page), where: `Content of ${path(b.page)} → ${path(a.page)}`, effort: "Medium", conf: "Low", gain: c.total * 0.01 * f,
      title: `Stop ${path(b.page)} competing with ${path(a.page)} for "${c.query}"`, why: `Two pages split "${c.query}" (${P(a.share)} / ${P(b.share)} of impressions); Google switched pages ${c.switches} times in 8 weeks.`,
      table: { cols: ["Page", "Share", "Pos", "Clicks"], rows: c.pages.map((p) => [path(p.page), P(p.share), p.pos.toFixed(1), N(p.clicks)]) },
      steps: [`Move the useful content of ${path(b.page)} into ${path(a.page)}.`, `301 redirect ${path(b.page)} to ${path(a.page)} (or point it elsewhere if it's a different topic).`, "Update internal links."], suggest: `${path(b.page)}  ${path(a.page)}  301` });
  }
  // 11. technical fixes · 12. get indexed (grouped: one task per reason, with the URLs)
  const smBad: [string, string][] = [], disc: string[] = [], crawledNot: string[] = [];
  for (const r of g.inv) {
    const i = g.latest(r.url), c = r.crawl, cs = i?.coverageState ?? "";
    if (r.sitemaps.length && c && ((c.status ?? 200) >= 400 || c.redirect || /noindex/i.test(`${c.robots} ${c.xRobots}`) || (c.canonical && c.canonical.replace(/\/$/, "") !== r.url.replace(/\/$/, ""))))
      smBad.push([path(r.url), c.redirect ? `redirects to ${pathOf(c.redirect)}` : (c.status ?? 200) >= 400 ? `returns ${c.status}` : /noindex/i.test(`${c.robots} ${c.xRobots}`) ? "noindex" : `canonical → ${pathOf(c.canonical!)}`]);
    if (/404|not found/i.test(cs) && i?.referringUrls.length) add({ key: `404${r.url}`, type: "Technical fix", page: path(r.url), where: "_redirects file", effort: "Low", conf: "High", gain: 0.5,
      title: `Redirect ${path(r.url)} (404) to the closest live page`, why: `Google finds it from ${i.referringUrls.length} referring URL(s).`, steps: ["Pick the closest live page.", "Add a 301 redirect.", "Update internal links to it."], suggest: `${path(r.url)}  [best matching page]  301` });
    if (/discovered - currently not indexed/i.test(cs)) disc.push(r.url);
    if (/crawled - currently not indexed/i.test(cs)) crawledNot.push(r.url);
    if (/duplicate without user-selected canonical/i.test(cs)) add({ key: `canon${r.url}`, type: "Technical fix", page: path(r.url), where: "Canonical tag", effort: "Low", conf: "High", gain: 0.4,
      title: `Add a canonical tag to ${path(r.url)}`, why: "Google treats it as a duplicate and no canonical is declared.", steps: ["Add <link rel=\"canonical\"> pointing at the main version."], suggest: `<link rel="canonical" href="${i?.googleCanonical ?? "[main URL]"}">` });
    for (const rr of i?.rich ?? []) if (rr.errors || rr.warnings) add({ key: `rich${rr.type}`, type: "Rich results", page: path(r.url), where: "Structured data (JSON-LD)", effort: "Low", conf: "Medium", gain: 0.3,
      title: `Fix ${rr.type} markup (first seen on ${path(r.url)})`, why: `${rr.errors} item(s) with errors, ${rr.warnings} with warnings: ${[...new Set(rr.issues.map((x) => x.message))].slice(0, 3).join("; ")}.`, steps: ["Fix or remove the fields named in the issues on every page using this markup.", "Test in Google's Rich Results Test."] });
  }
  const urlTable = (urls: string[], extra: (u: string) => string) => ({ cols: ["URL", "Internal links in", "Detail"], rows: urls.slice(0, 15).map((u) => [path(u), g.linksIn.get(u) ?? 0, extra(u)]) });
  if (smBad.length) add({ key: "sitemapclean", type: "Sitemap", page: "Sitemaps", where: "Sitemap files", effort: "Low", conf: "High", gain: 0.2 * smBad.length,
    title: `Remove ${smBad.length} URL${smBad.length > 1 ? "s" : ""} from the sitemaps that shouldn't be there`, why: "Sitemaps should list only live, indexable pages that are their own canonical.",
    table: { cols: ["URL", "Problem"], rows: smBad.slice(0, 15) }, steps: ["Remove these URLs from the sitemap (or fix the pages).", "Resubmit the sitemap in Search Console → Sitemaps."] });
  if (disc.length) add({ key: "discovered", type: "Get indexed", page: `${disc.length} pages`, where: "Internal links from strong pages + sitemap lastmod", effort: "Medium", conf: "Medium", gain: 0.3 * disc.length,
    title: `Get ${disc.length} discovered pages crawled: link to them from strong pages`, why: `Google knows these URLs but hasn't crawled them (Discovered - currently not indexed). Few internal links point to them.`,
    table: urlTable(disc.sort((a, b) => (g.linksIn.get(a) ?? 0) - (g.linksIn.get(b) ?? 0)), (u) => `${g.crawl(u)?.words ?? "–"} words`),
    steps: ["Link to each from 2–3 relevant pages that get traffic.", "Update lastmod in the sitemap.", "Request indexing for the most important ones in Search Console (button in Search Console; no API)."] });
  if (crawledNot.length) add({ key: "crawlednot", type: "Get indexed", page: `${crawledNot.length} pages`, where: "Page content", effort: "High", conf: "Low", gain: 0.3 * crawledNot.length,
    title: `Improve or merge ${crawledNot.length} pages Google crawled but left out`, why: "Google crawled them and chose not to index them (Crawled - currently not indexed): usually thin, similar or weakly linked pages.",
    table: urlTable(crawledNot.sort((a, b) => (g.crawl(a)?.words ?? 0) - (g.crawl(b)?.words ?? 0)), (u) => `${g.crawl(u)?.words ?? "–"} words`),
    steps: ["Start with the shortest pages: add unique detail, photos and 600+ useful words, or merge them into a stronger page and 301 them.", "Link to the improved pages from related posts.", "Then request indexing in Search Console."] });
  for (const s of g.sitemaps) if (!s.lastDownloaded || Date.now() - Date.parse(s.lastDownloaded) > 14 * 86_400_000) add({ key: `stale${s.path}`, type: "Sitemap", page: pathOf(s.path), where: "Sitemap", effort: "Low", conf: "High", gain: 0.3,
    title: `Resubmit ${pathOf(s.path)} (not read in 14+ days)`, why: `Google last read it ${s.lastDownloaded ? s.lastDownloaded.slice(0, 10) : "never"}.`, steps: ["Check it loads and lists only live, indexable URLs.", "Resubmit it in Search Console → Sitemaps."] });
  // 13. content refresh: year in query, page-two rescue
  for (const r of g.queries()) if (/\b20[2-3][0-9]\b/.test(r[0]) && r[1].impressions >= 50) {
    const land = qps.filter((x) => x.query === r[0]).sort((a, b) => b.impressions - a.impressions)[0];
    if (land) add({ key: `year${land.page}`, type: "Content refresh", page: path(land.page), where: "Title, numbers in the body and a visible 'Last updated'", effort: "Low", conf: "Medium", gain: r[1].impressions * 0.02 * f,
      title: `Refresh ${path(land.page)} for searches with a year`, why: `"${r[0]}" (${N(r[1].impressions)} impressions) includes a year.`, steps: ["Update numbers and examples.", "Show a visible 'Last updated' date and dateModified.", "Switch the year in the title around Dec 26."] });
  }
  for (const r of pageTwoRescue(g).slice(0, 10)) add({ key: `p2${r.page}|${r.query}`, type: "Content refresh", page: path(r.page), where: "Sections compared with the top 3 results", effort: "Medium", conf: "Medium", gain: r.prevClicks * 0.6 * f,
    title: `Bring "${r.query}" back to page one (now ${r.pos.toFixed(1)})`, why: `It was on page one last period with ${N(r.prevClicks)} clicks.`, steps: ["Compare the page with the top 3 results for the query.", "Add the sections they cover that this page doesn't.", "Add 2 internal links with the query as anchor."] });
  // 14. brand and trust
  const trust = (prev: boolean) => [...g.queries(prev)].filter(([q]) => g.isBrand(q) && /\b(legit|scam|reviews?|bbb|complaints?)\b/i.test(q)).reduce((a, [, v]) => a + v.impressions, 0);
  const tCur = trust(false), tPrev = trust(true);
  if (tCur >= 20 && tCur > tPrev * 1.5) add({ key: "trust", type: "Brand and trust", page: "/about", where: "Trust section on the About page + Organization schema", effort: "Medium", conf: "Medium", gain: tCur * 0.05 * f,
    title: "Add a trust section to the About page", why: `Brand searches about reviews or legitimacy rose from ${N(tPrev)} to ${N(tCur)} impressions.`, steps: ["Show licences, insurance, certifications, years in business and real reviews.", "Add Organization schema with facts visible on the page.", "Link it from the footer."],
    suggest: "Licensed and insured: [licence numbers]\nIn business since [year]\nReviews: [link to Google reviews]" });
  // 15. image SEO · 16. local SEO
  const img = [...g.queries()].filter(([q]) => /\b(picture|pictures|photo|photos|images|ideas|colors|design)\b/i.test(q));
  const imgImp = img.reduce((a, [, v]) => a + v.impressions, 0);
  if (imgImp >= 100) add({ key: "img", type: "Image SEO", page: "Gallery / our work", where: "Image file names, alt text and captions", effort: "Medium", conf: "Low", gain: imgImp * 0.01 * f,
    title: "Add a labelled gallery of real project photos", why: `${img.length} image-intent queries (${N(imgImp)} impressions), e.g. "${img.sort((a, b) => b[1].impressions - a[1].impressions)[0][0]}".`, steps: ["Descriptive file names (service-city-material.webp).", "Alt text and captions naming the town and material.", "WebP under 200 KB."] });
  const local = qps.filter((r) => (/\bnear (me|by)\b|\bnearby\b/i.test(r.query) || cityOf(g, r.query)) && pathOf(r.page) === "/");
  const localImp = local.reduce((a, r) => a + r.impressions, 0);
  if (localImp >= 100) add({ key: "local", type: "Local SEO", page: "/", where: "'Areas we serve' section on the home page", effort: "Low", conf: "Medium", gain: localImp * 0.01 * f,
    title: "Add an 'Areas we serve' section with links to city pages", why: `${N(localImp)} impressions from near-me and city searches land on the home page.`, table: tbl(local.slice(0, 5)),
    steps: ["List the towns served, each linking to its page.", "Keep name, address and phone identical to the Google Business Profile."] });
  // 17. watchlists
  for (const p of noClicks(g, pages).slice(0, 10)) add({ key: `nc${p.page}`, type: "Page with no clicks", page: path(p.page), where: p.pos > 10 ? "Page content and internal links" : "Title tag and meta description", effort: "Low", conf: "Low", gain: p.impressions * 0.01 * f,
    title: `Get the first clicks on ${path(p.page)}: ${p.reason.toLowerCase()}`, why: `${N(p.impressions)} impressions, 0 clicks, position ${p.pos.toFixed(1)}.`, steps: [p.todo] });
  for (const p of noImpressions(g, pages).filter((x) => x.cat === "Indexed but no demand").slice(0, 10)) add({ key: `ni${p.url}`, type: "Page with no impressions", page: path(p.url), where: "Topic of the page", effort: "Medium", conf: "Low", gain: 0.2,
    title: `Retarget or merge ${path(p.url)} (indexed, never shown)`, why: "Indexed, but no impressions in 28 days.", steps: [p.todo] });
  for (const p of ctrChanges(g, pages).filter((x) => x.dCtr <= -0.005 && -x.gained >= 1).sort((a, b) => a.gained - b.gained).slice(0, 8)) add({ key: `ctr${p.page}`, type: "CTR dropped", page: path(p.page), where: "Title tag and meta description", effort: "Low", conf: "Medium", gain: -p.gained * 0.5 * f,
    title: `Win back clicks on ${path(p.page)} (CTR ${P(p.ctrPrev)} → ${P(p.ctr)})`, why: `${p.reason}. ${N(-p.gained)} clicks lost.`, steps: ["Check what now shows on the results page for its top query.", "Refresh the title and description; add a detail the answer box can't show."] });
  // 19. mobile gap
  const byDev = new Map<string, { m?: [number, number]; d?: [number, number] }>();
  for (const x of g.pd()) { const k = String(x.page), e = byDev.get(k) ?? {}; const slot = x.device === "MOBILE" ? "m" : x.device === "DESKTOP" ? "d" : null; if (!slot) continue; const cur = e[slot] ?? [0, 0]; cur[0] += Number(x.impressions); cur[1] += Number(x.posx); e[slot] = cur; byDev.set(k, e); }
  for (const [page, e] of byDev) {
    if (!e.m || !e.d || e.m[0] + e.d[0] < 200) continue;
    const gap = e.m[1] / e.m[0] - e.d[1] / e.d[0];
    if (Math.abs(gap) > 3) add({ key: `mob${page}`, type: "Mobile gap", page: path(page), where: "Mobile layout and speed", effort: "Medium", conf: "Low", gain: e.m[0] * 0.005 * f,
      title: `Fix the ${gap > 0 ? "mobile" : "desktop"} ranking gap on ${path(page)}`, why: `Ranks ${Math.abs(gap).toFixed(1)} positions ${gap > 0 ? "lower on phones" : "lower on computers"}.`, steps: ["Check mobile layout and Core Web Vitals.", "Make sure the same content shows on mobile."] });
  }
  // CTR below expected (rows with big missed clicks not covered above)
  for (const r of belowExpected(g).slice(0, 5)) if (!keys.has(`title${r.page}`)) add({ key: `miss${r.page}|${r.query}`, type: "Title rewrite", page: path(r.page), where: "Title tag", effort: "Low", conf: "Medium", gain: r.missed * 0.5 * f,
    title: `Match the title of ${path(r.page)} to "${r.query}"`, why: `CTR ${P(r.ctr)} at position ${r.pos.toFixed(1)} vs ${P(r.exp)} expected: about ${N(r.missed)} clicks missed.`, table: tbl([r]), steps: ["Use the query's words early in the title.", "Make the description promise what the searcher wants."], suggest: `Title: ${suggestTitle(g, r.query)}` });
  const ranked = out.map((w) => ({ ...w, score: Math.round(((w.gain * CONF[w.conf]) / EFF[w.effort]) * 100) / 100, rank: 0 })).sort((a, b) => b.score - a.score);
  ranked.forEach((w, i) => { w.rank = i + 1; });
  return ranked;
}
