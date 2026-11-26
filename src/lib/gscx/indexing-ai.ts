import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic } from "@/lib/ai/claude";
import type { AuditResult } from "@/lib/dataforseo/audit";
import { fetchHtml, outline } from "@/lib/toolkit/store";
import { addDays, G, groupM, type Period } from "./g";
import { crawlUrl, type Crawl, type Inspection, type InventoryRow } from "./inventory";
import { pathOf, stems } from "./model";
import { gscxTarget, readGscx, type GscMeta, type InspState } from "./sync";

/**
 * Indexing diagnosis: for one page Google hasn't indexed, Claude reads the live page, our crawl of the whole site,
 * the blog posts' in-content links, the DataForSEO audit and the page's Search Console data, and writes the likely
 * reason and a specific fix (which existing pages should link to it, with which anchor text; what to add or merge).
 * Google never says why it leaves a page out, so every diagnosis is a likely reason. Stored per page in dfs_cache
 * (endpoint "gsc_index_ai") so it is shown again without paying twice.
 */
export const INDEX_AI_MODEL = "claude-sonnet-5-5";
export const INDEX_AI_ENDPOINT = "gsc_index_ai";
/** Shown before running until real runs give an average. */
export const INDEX_AI_EST = 0.03;
const PRICE = { input: 2, output: 10 }; // $ per million tokens, claude-sonnet-5-5

const schema = z.object({
  possible_issue: z.string().describe("The most likely reason Google left this page out, 1-2 sentences, naming the concrete evidence (numbers, URLs)."),
  confidence: z.enum(["High", "Medium", "Low"]),
  evidence: z.array(z.string()).describe("2-5 facts from the data that support the reason."),
  recommended_solution: z.string().describe("The fix in 1-2 sentences, specific to this page."),
  internal_links: z.array(z.object({
    from_url: z.string().describe("Exactly one URL from the candidate source pages list."),
    anchor_text: z.string().describe("2-6 words describing the target page."),
    placement: z.string().describe("Where on the source page: name the section/heading and the sentence to add."),
  })).describe("0-5 links to add. Empty when links aren't part of the fix."),
  content_changes: z.array(z.string()).describe("Specific additions, rewrites or merges for this page (name sections, topics, facts to add). Empty if none."),
  technical_fixes: z.array(z.string()).describe("Canonical / robots / redirect / sitemap / status fixes backed by the data. Empty if none."),
  after_fixing: z.array(z.string()).describe("1-3 follow-up steps, e.g. request indexing in Search Console, what to check and when."),
});
type Out = z.infer<typeof schema>;
export const indexAiSchema = schema;

export interface IndexDiagnosis {
  url: string; coverageState: string; verdict: string; at: string; model: string; cost: number;
  issue: string; solution: string; confidence: Out["confidence"]; evidence: string[];
  links: { from: string; fromTitle: string | null; anchor: string; where: string }[];
  content: string[]; technical: string[]; after: string[];
  facts: { status: number | null; words: number | null; contentLinksIn: number; sitewideLinksIn: number; impressions90: number; clicks90: number; similar: { url: string; overlap: number | null }[] };
}

const key = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "").toLowerCase()}`; } catch { return u.toLowerCase().replace(/\/+$/, ""); } };
const statusOf = (i: Inspection | null) => (!i ? "not inspected" : i.verdict === "PASS" ? "indexed" : `not indexed (${i.coverageState})`);
const jacc = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const shingles = (t: string) => { const w = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), s = new Set<string>(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(" ")); return s; };
const cut = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "–");

/** Stored diagnoses of a client, by URL. */
export async function loadDiagnoses(admin: SupabaseClient, clientId: string): Promise<Record<string, IndexDiagnosis>> {
  const { data } = await admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", INDEX_AI_ENDPOINT).limit(3000);
  const out: Record<string, IndexDiagnosis> = {};
  for (const r of data ?? []) out[r.params_hash as string] = r.data as IndexDiagnosis;
  return out;
}

/** Cost to show before running: the average of this client's past diagnoses, or the default estimate. */
export function estimateCost(stored: Record<string, IndexDiagnosis>) {
  const cs = Object.values(stored).map((d) => d.cost).filter((c) => c > 0);
  return cs.length >= 2 ? Math.round((cs.reduce((a, c) => a + c, 0) / cs.length) * 1000) / 1000 : INDEX_AI_EST;
}

export async function saveDiagnosis(admin: SupabaseClient, clientId: string, d: IndexDiagnosis) {
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: INDEX_AI_ENDPOINT, params_hash: d.url, params: { model: d.model }, data: d, row_count: 1, cost: d.cost, fetched_at: d.at }, { onConflict: "client_id,endpoint,params_hash" });
}

/** Everything Claude reads about one page, as text, plus the facts kept with the result. */
export async function indexContext(admin: SupabaseClient, clientId: string, url: string) {
  const t = await gscxTarget(admin, clientId, null);
  if (!t) throw new Error("Search Console isn't connected for this client.");
  const rid = t.resource.id;
  const [read, blog, audit] = await Promise.all([
    readGscx(admin, clientId, rid, ["pg", "qp"], ["meta", "inventory", "insp"]),
    admin.from("blog_posts").select("url, title, links").eq("client_id", clientId).limit(3000),
    admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", "audit").eq("params_hash", "audit").maybeSingle(),
  ]);
  const meta = read.one.meta as GscMeta | null, inv = (read.one.inventory as InventoryRow[] | null) ?? [], insp = read.one.insp as InspState | null;
  if (!meta) throw new Error("Search Console hasn't been synced yet.");
  const row = inv.find((r) => r.url === url);
  if (!row) throw new Error("This page isn't in the site's URL inventory.");
  const p: Period = { start: addDays(meta.end, -89), end: meta.end, days: 90, pstart: addDays(meta.end, -179), pend: addDays(meta.end, -90) };
  const g = new G(meta, read.cubes, p, { brand: [], cities: [], services: [], competitors: [] }, inv, insp, []);
  const i = g.latest(url);
  if (i?.verdict === "PASS") throw new Error("Google already indexes this page.");
  const host = new URL(url).hostname.replace(/^www\./, "");

  // the live page now (crawler view + main text)
  const [live, html] = await Promise.all([crawlUrl(url, host), fetchHtml(url, 20_000)]);
  const ol = html.html ? outline(html.html) : null;
  const text = ol?.text.split(/\s+/).slice(0, 900).join(" ") ?? "";

  // links: sitewide (navigation/footer, on 60%+ of crawled pages) vs in-content
  const crawled = inv.filter((r) => r.crawl?.links.length);
  const onPages = new Map<string, number>();
  for (const r of crawled) for (const l of new Set(r.crawl!.links.map(key))) onPages.set(l, (onPages.get(l) ?? 0) + 1);
  const sitewide = (k: string) => (onPages.get(k) ?? 0) >= Math.max(5, crawled.length * 0.6);
  const tk = key(url);
  const posts = (blog.data ?? []) as { url: string; title: string; links: { url?: string; anchor?: string; internal?: boolean }[] | null }[];
  const postBy = new Map(posts.map((x) => [key(x.url), x]));
  const anchorsIn: { from: string; anchor: string }[] = [];
  for (const x of posts) for (const l of x.links ?? []) if (l.internal !== false && l.url && key(l.url) === tk && key(x.url) !== tk) anchorsIn.push({ from: x.url, anchor: (l.anchor ?? "").trim() });
  const targetSitewide = sitewide(tk);
  // only live, canonical-looking pages count as linkers (not redirecting http/www variants, #fragments)
  const liveRow = (r: InventoryRow) => !!r.crawl && (r.crawl.status ?? 200) < 300 && !r.crawl.redirect && !r.url.includes("#");
  const linkersAll = inv.filter((r) => r.url !== url && liveRow(r) && (r.crawl?.links ?? []).some((l) => key(l) === tk));
  const contentLinkers = targetSitewide ? [...new Set(anchorsIn.map((a) => a.from))] : [...new Set([...linkersAll.map((r) => r.url), ...anchorsIn.map((a) => a.from)])];
  const linksOut = [...new Set((live.links.length ? live.links : row.crawl?.links ?? []).filter((l) => key(l) !== tk))];
  // a blog post's own record lists its in-content links; other pages fall back to "not on most pages"
  const ownPost = postBy.get(tk);
  const contentOut = ownPost ? [...new Set((ownPost.links ?? []).filter((l) => l.internal !== false && l.url).map((l) => l.url!))] : linksOut.filter((l) => !sitewide(key(l)));

  // Search Console for this page and for every page (90 days)
  const pages = g.pages();
  const qpCur = g.qp();
  const topQ = new Map<string, { q: string; i: number }[]>();
  for (const [k, v] of groupM(qpCur, (x) => `${x.page}\u0000${x.query}`)) { const [pg, q] = k.split("\u0000"); const a = topQ.get(pg) ?? []; a.push({ q, i: v.impressions }); topQ.set(pg, a); }
  for (const a of topQ.values()) a.sort((x, y) => y.i - x.i);
  const own = pages.get(url);
  const ownQ = [...groupM(qpCur.filter((x) => x.page === url), (x) => String(x.query))].sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 15);

  // topic words of the target: slug, title, H1, headings, its queries
  const topicText = (r: InventoryRow, c: Crawl | null) => `${pathOf(r.url).replace(/[-/_]/g, " ")} ${c?.title ?? ""} ${c?.h1 ?? ""}`;
  // words in a fifth or more of all titles (brand, "near <area>") say nothing about the topic
  const df = new Map<string, number>();
  for (const r of inv) for (const w of new Set(stems(topicText(r, r.crawl)))) df.set(w, (df.get(w) ?? 0) + 1);
  const topical = (ws: string[]) => ws.filter((w) => (df.get(w) ?? 0) < Math.max(5, inv.length * 0.2));
  const tStems = new Set(topical(stems(`${topicText(row, live)} ${(live.headings.length ? live.headings : row.crawl?.headings ?? []).slice(0, 12).join(" ")} ${ownQ.map(([q]) => q).join(" ")}`)));
  const tTitle = new Set(topical(stems(topicText(row, live.title ? live : row.crawl))));

  // similar pages on the site (possible duplicates), with measured text overlap for the closest three
  const similar = inv.filter((r) => r.url !== url && r.crawl?.title).map((r) => ({ r, s: jacc(tTitle, new Set(topical(stems(topicText(r, r.crawl))))) })).filter((x) => x.s >= 0.3).sort((a, b) => b.s - a.s).slice(0, 6);
  // text overlap, after removing template text (phrases the target shares with an unrelated page of the same kind)
  const tSh = shingles(ol?.text ?? "");
  const isPost = postBy.has(tk);
  const base = inv.find((r) => r.url !== url && liveRow(r) && postBy.has(key(r.url)) === isPost && jacc(tTitle, new Set(topical(stems(topicText(r, r.crawl))))) === 0 && !similar.some((x) => x.r.url === r.url));
  const baseHtml = base && tSh.size && similar.length ? await fetchHtml(base.url, 15_000) : null;
  if (baseHtml?.html) { const b = shingles(outline(baseHtml.html).text); for (const x of b) tSh.delete(x); }
  const overlap = await Promise.all(similar.slice(0, 3).map(async ({ r }) => {
    if (tSh.size < 50) return null;
    const h = await fetchHtml(r.url, 15_000);
    if (!h.html) return null;
    const o = shingles(outline(h.html).text); let n = 0; for (const s of tSh) if (o.has(s)) n++;
    return Math.round((n / tSh.size) * 100);
  }));

  // candidate source pages for internal links: indexed, live, not already linking to it in content, on topic
  const linkerKeys = new Set(contentLinkers.map(key));
  const cands = inv.filter((r) => r.url !== url && g.latest(r.url)?.verdict === "PASS" && r.crawl && (r.crawl.status ?? 200) < 300 && !r.crawl.redirect && !linkerKeys.has(key(r.url)))
    .map((r) => {
      const c = r.crawl!, q = topQ.get(r.url) ?? [];
      const st = new Set(stems(`${topicText(r, c)} ${c.headings.slice(0, 12).join(" ")} ${q.slice(0, 5).map((x) => x.q).join(" ")}`));
      let hit = 0; for (const w of tStems) if (st.has(w)) hit++;
      const pv = pages.get(r.url);
      return { r, c, hit, rel: tStems.size ? hit / tStems.size : 0, clicks: pv?.clicks ?? 0, impr: pv?.impressions ?? 0, q: q[0]?.q ?? null, post: postBy.has(key(r.url)) };
    })
    .filter((x) => x.hit >= 2 || x.rel >= 0.15)
    .sort((a, b) => b.rel * 3 + Math.log10(1 + b.clicks) - (a.rel * 3 + Math.log10(1 + a.clicks)))
    .slice(0, 15);

  // DataForSEO on-page audit, when one was run
  const ar = audit.data?.data as AuditResult | undefined;
  const aRow = ar?.rows.find((x) => key(x.url) === tk);
  const aIssues = (ar?.issues ?? []).filter((x) => x.urls.some((u) => key(u) === tk)).map((x) => x.label);

  // the site as a whole, so patterns are visible
  const byState = new Map<string, number>();
  for (const r of inv) { const s = statusOf(g.latest(r.url)); byState.set(s, (byState.get(s) ?? 0) + 1); }
  const same = inv.filter((r) => g.latest(r.url)?.coverageState === i?.coverageState && i);
  const sameWords = same.map((r) => r.crawl?.words ?? 0).filter((w) => w > 0).sort((a, b) => a - b);
  const indexedWords = inv.filter((r) => g.latest(r.url)?.verdict === "PASS").map((r) => r.crawl?.words ?? 0).filter((w) => w > 0).sort((a, b) => a - b);
  const median = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)] : null);

  const L: string[] = [];
  L.push(`# Target page\nURL: ${url}`);
  L.push(`## Google (URL Inspection, ${i?.at.slice(0, 10) ?? "never"})\nVerdict: ${i?.verdict ?? "not inspected"} · Coverage: ${i?.coverageState ?? "–"} · Indexing allowed: ${i?.indexingState ?? "–"} · robots.txt: ${i?.robotsTxtState ?? "–"} · Page fetch: ${i?.pageFetchState ?? "–"}\nLast crawl: ${i?.lastCrawlTime?.slice(0, 10) ?? "never"} · Crawled as: ${i?.crawledAs ?? "–"} · Google's canonical: ${i?.googleCanonical ?? "–"} · Declared canonical: ${i?.userCanonical ?? "–"}\nIn submitted sitemaps: ${row.sitemaps.length ? row.sitemaps.map(pathOf).join(", ") : i?.sitemap.length ? i.sitemap.map(pathOf).join(", ") : "no"} · Referring URLs Google knows: ${i?.referringUrls.length ? i.referringUrls.join(", ") : "none"}`);
  L.push(`## Live page now\nHTTP ${live.status ?? "no answer"}${live.redirect ? ` · redirects to ${live.redirect}` : ""} · ${live.ms ?? "–"} ms · canonical: ${live.canonical ?? "none"} · meta robots: ${live.robots ?? "none"} · X-Robots-Tag: ${live.xRobots ?? "none"}\nTitle (${live.title?.length ?? 0} chars): ${live.title ?? "–"}\nMeta description (${live.desc?.length ?? 0} chars): ${live.desc ?? "none"}\nH1: ${live.h1 ?? "none"}\nH2/H3: ${live.headings.slice(0, 40).join(" | ") || "none"}\nWords: ${live.words} · Schema: ${live.schema.join(", ") || "none"}\nInternal links out: ${linksOut.length} in total; ${contentOut.length} inside the ${ownPost ? "post's" : "page's"} own content (the rest are menu, footer and sidebar lists). In-content: ${contentOut.slice(0, 25).map(pathOf).join(", ") || "none"}`);
  L.push(`## Main text (first 900 words)\n${text || "(no text could be read)"}`);
  L.push(`## Search Console, last 90 days (to ${meta.end})\nClicks ${own?.clicks ?? 0} · Impressions ${own?.impressions ?? 0} · Avg position ${own?.pos?.toFixed(1) ?? "–"}\nQueries: ${ownQ.map(([q, v]) => `"${q}" ${v.impressions} impr, pos ${v.pos?.toFixed(1) ?? "–"}`).join("; ") || "none"}`);
  L.push(`## Internal links pointing to it\nSitewide (menu/footer): ${targetSitewide ? "yes" : "no"} · Pages linking to it (our crawl): ${linkersAll.length} · In-content links from blog posts: ${anchorsIn.length}\n${[...anchorsIn.slice(0, 10).map((a) => `- ${a.from} anchor "${a.anchor}" (${statusOf(g.latest(a.from) ?? null)})`), ...(targetSitewide ? [] : linkersAll.filter((r) => !anchorsIn.some((a) => key(a.from) === key(r.url))).slice(0, 10).map((r) => `- ${r.url} (${statusOf(g.latest(r.url))})`))].join("\n") || "- none"}`);
  L.push(`## Similar pages on the site (possible duplicates)\n${similar.map(({ r, s }, k) => `- ${r.url} · title "${cut(r.crawl?.title, 90)}" · ${r.crawl?.words ?? "–"} words · ${statusOf(g.latest(r.url))} · ${pages.get(r.url)?.clicks ?? 0} clicks/90d · title similarity ${Math.round(s * 100)}%${k < 3 && overlap[k] != null ? ` · ${overlap[k]}% of the target's 5-word phrases also appear on it` : ""}`).join("\n") || "- none found by title"}`);
  L.push(`## Candidate source pages for new internal links (indexed, on topic, not linking to it yet)\n${cands.map((x) => `- ${x.r.url} · "${cut(x.c.title, 80)}" · ${x.clicks} clicks, ${x.impr} impr/90d${x.q ? ` · top query "${x.q}"` : ""}${x.post ? " · blog post" : ""} · sections: ${x.c.headings.slice(0, 8).map((h) => cut(h, 60)).join(" | ") || "–"}`).join("\n") || "- none found"}`);
  if (ar) L.push(`## DataForSEO on-page audit (${ar.finishedAt.slice(0, 10)})\n${aRow ? `Status ${aRow.status ?? "–"} · words ${aRow.words ?? "–"} · click depth ${aRow.depth ?? "–"} · on-page score ${aRow.score ?? "–"}` : "This URL wasn't in the audit's crawl."}${aIssues.length ? `\nFlagged: ${aIssues.join("; ")}` : ""}`);
  L.push(`## Site context\n${inv.length} URLs known. ${[...byState].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join("; ")}.\nMedian words: indexed pages ${median(indexedWords) ?? "–"}; pages with the same coverage state ${median(sameWords) ?? "–"} (${same.length} pages).`);

  const facts: IndexDiagnosis["facts"] = { status: live.status, words: live.words || row.crawl?.words || null, contentLinksIn: contentLinkers.length, sitewideLinksIn: targetSitewide ? linkersAll.length : 0, impressions90: own?.impressions ?? 0, clicks90: own?.clicks ?? 0, similar: similar.slice(0, 3).map(({ r }, k) => ({ url: r.url, overlap: overlap[k] ?? null })) };
  return { text: L.join("\n\n"), inspection: i, facts, candidates: new Map(cands.map((x) => [key(x.r.url), { url: x.r.url, title: x.c.title }])) };
}

const SYSTEM = `You are a senior technical SEO diagnosing why Google has not indexed one page of a small business website. Google never states its exact reason, so give the most likely reason backed by the data, and say how confident you are.
Rules:
- Use only the data given. Quote concrete numbers and URLs as evidence. No generic advice ("improve content quality", "build backlinks") without saying exactly what.
- Match the coverage state: "Discovered – currently not indexed" usually means crawl priority (weak internal links, many similar URLs, crawl budget); "Crawled – currently not indexed" usually means Google judged the page not valuable enough (thin, near-duplicate of other pages on the site, templated/AI-like text, weak links); duplicates/canonical states mean pick and declare one version; noindex/redirect/404 states may be intended: say so when they look intentional.
- Internal links: pick source pages ONLY from "Candidate source pages" (copy the URL exactly), the most relevant first, give natural anchor text describing the target (2-6 words, no exact-match stuffing) and say in which section of the source page to add the sentence. Leave internal_links empty if links aren't part of the fix.
- Content: name what to add, rewrite or merge (sections, facts, local details, photos), and which similar page it overlaps with. If the page duplicates a stronger page, recommend merging and a 301 redirect, naming both URLs.
- Never recommend FAQ or HowTo rich results. Keep each item short and actionable.`;

/** One Claude diagnosis of one not-indexed page (Sonnet 5.5, structured output). */
export async function diagnosePage(admin: SupabaseClient, clientId: string, url: string): Promise<IndexDiagnosis> {
  const ctx = await indexContext(admin, clientId, url);
  const res = await anthropic().beta.messages.parse({
    model: INDEX_AI_MODEL, max_tokens: 3000, thinking: { type: "between_tools" }, // Sonnet 5.5: "between_tools" is how thinking is turned off
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content: ctx.text }],
  });
  if (!res.parsed_output) throw new Error("The AI didn't return a diagnosis. Try again.");
  return toDiagnosis(url, ctx, res.parsed_output, res.usage);
}

export type IndexAiOutput = Out;
/** Turns Claude's structured output into the stored diagnosis (kept separate so it can be tested without an API call). */
export function toDiagnosis(url: string, ctx: Pick<Awaited<ReturnType<typeof indexContext>>, "inspection" | "facts" | "candidates">, o: Out, usage: { input_tokens: number; output_tokens: number }): IndexDiagnosis {
  const cost = Number(((usage.input_tokens * PRICE.input + usage.output_tokens * PRICE.output) / 1_000_000).toFixed(4));
  // keep only links from real candidate pages (never an invented URL)
  const links = o.internal_links.map((l) => ({ l, c: ctx.candidates.get(key(l.from_url)) })).filter((x) => x.c).slice(0, 5)
    .map(({ l, c }) => ({ from: c!.url, fromTitle: c!.title, anchor: l.anchor_text.trim(), where: l.placement.trim() }));
  return {
    url, coverageState: ctx.inspection?.coverageState ?? "Not inspected", verdict: ctx.inspection?.verdict ?? "", at: new Date().toISOString(), model: INDEX_AI_MODEL, cost,
    issue: o.possible_issue.trim(), solution: o.recommended_solution.trim(), confidence: o.confidence, evidence: o.evidence.slice(0, 6),
    links, content: o.content_changes.slice(0, 8), technical: o.technical_fixes.slice(0, 6), after: o.after_fixing.slice(0, 4), facts: ctx.facts,
  };
}
