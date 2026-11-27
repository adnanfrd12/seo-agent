import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Col } from "@/components/research/research-table";
import { recordSpend } from "@/lib/dataforseo/budget";
import { DfsError, dfsPost } from "@/lib/dataforseo/client";
import { auditTaskId, issueInfo, pageHasIssue, type AuditResult, type AuditTask } from "@/lib/dataforseo/audit";
import { arr, num, obj, str, type Json } from "@/lib/dataforseo/research";
import { METRIC_KEYS, type MetricKey } from "./guide";
import { internalOrphans, type OrphanBlogPost } from "./orphans";

/**
 * What one Site Audit issue (or links/duplicates total) affects, read from the finished DataForSEO crawl.
 * Reading a finished On-Page task (pages, links, duplicate_content, non_indexable, redirect_chains) is free:
 * DataForSEO bills only the crawl's task_post, and these calls answer with cost 0 (checked November 2026).
 * Any cost they ever report is still recorded in dfs_spend. Image alt/title come from reading the affected
 * pages' HTML directly (the HTML-only crawl doesn't list images), which is free too.
 * Each result is stored as one dfs_cache row per issue (endpoint "audit_detail"), so the panel reopens instantly.
 */
export const DETAIL_ENDPOINT = "audit_detail";
const MAX_ROWS = 1000;
const IMAGE_PAGES = 40; // pages read for the image list
const DUP_PAGES = 60; // pages compared for duplicate-content groups

type Row = Record<string, unknown>;
export interface DetailGroup { label: string; pages: { url: string; title: string | null; similarity?: number | null }[] }
export interface ImageRow { src: string; alt: string | null; title: string | null; pages: string[]; pageTitle: string | null }
export interface AiFix { target: string; action: string; value: string | null; why: string }
export interface AltSuggestion { alt: string; title: string }
export interface AuditDetail {
  key: string; label: string; taskId: string; fetchedAt: string;
  /** how many items the crawl reported, which can be more than the rows kept */
  total: number;
  kind: "pages" | "links" | "groups" | "images" | "errors";
  columns: Col[]; rows: Row[];
  groups?: DetailGroup[];
  images?: ImageRow[];
  note?: string;
  /** the latest "Fix with AI" result */
  ai?: { at: string; cost: number; model: string; summary: string; fixes: AiFix[] };
  /** AI alt text / title per image address */
  alt?: Record<string, AltSuggestion>;
  /** images Claude couldn't be shown (not downloadable, too large or an unsupported type) */
  altSkipped?: string[];
  cost: number;
}

/* ------------------------------------------------------------------ storage */
export async function readDetail(db: SupabaseClient, clientId: string, key: string): Promise<AuditDetail | null> {
  const { data } = await db.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", DETAIL_ENDPOINT).eq("params_hash", key).maybeSingle();
  return (data?.data as AuditDetail | undefined) ?? null;
}
export async function saveDetail(admin: SupabaseClient, clientId: string, d: AuditDetail) {
  const { error } = await admin.from("dfs_cache").upsert({
    client_id: clientId, endpoint: DETAIL_ENDPOINT, params_hash: d.key, params: { taskId: d.taskId }, data: d,
    row_count: d.rows.length + (d.groups?.length ?? 0) + (d.images?.length ?? 0), cost: d.cost, fetched_at: new Date().toISOString(),
  }, { onConflict: "client_id,endpoint,params_hash" });
  if (error) throw new Error(`Couldn't store the details: ${error.message}`);
}

/* ------------------------------------------------------------------ DataForSEO reads (free) */
/** what the reads cost, and the client whose organization's DataForSEO account made the crawl (and reads it) */
type Spent = { cost: number; clientId: string };
async function call(path: string, body: Json, spent: Spent) {
  const r = await dfsPost(spent.clientId, path, body);
  spent.cost += r.cost;
  return r.result ?? {};
}
async function allPages(id: string, spent: Spent): Promise<Json[]> {
  const r = await call("/on_page/pages", { id, limit: 1000 }, spent);
  return arr(r.items).filter((p) => (str(p.resource_type) ?? "html") === "html");
}
async function links(id: string, filters: unknown[], spent: Spent): Promise<{ total: number; rows: Row[] }> {
  const r = await call("/on_page/links", { id, limit: MAX_ROWS, filters }, spent);
  return {
    total: num(r.total_items_count) ?? arr(r.items).length,
    rows: arr(r.items).map((l) => ({ from: str(l.link_from), to: str(l.link_to), anchor: str(l.text) ?? (str(l.type) === "anchor" ? "" : `(${str(l.type) ?? "link"})`), status: num(l.page_to_status_code), dofollow: l.dofollow === true, type: str(l.type) })),
  };
}

/** One crawled page as a table row. */
function pageRow(p: Json): Row {
  const m = obj(p.meta), h = obj(m.htags).h1;
  const t = obj(p.page_timing), c = obj(m.content);
  const title = str(m.title), desc = str(m.description);
  return {
    url: str(p.url), status: num(p.status_code), title: title?.slice(0, 300) ?? null, title_len: title?.length ?? 0,
    description: desc?.slice(0, 400) ?? null, desc_len: desc?.length ?? 0, h1: Array.isArray(h) && h.length ? String(h[0]).trim().slice(0, 200) : null,
    words: num(c.plain_text_word_count), depth: num(p.click_depth), ms: num(t.duration_time), waiting: num(t.waiting_time),
    location: str(p.location), canonical: str(m.canonical), rate: num(c.plain_text_rate) === null ? null : Math.round((num(c.plain_text_rate) as number) * 1000) / 10,
    sitemap: obj(p.checks).from_sitemap === true,
  };
}

const U = (key: string, label: string, hint?: string): Col => ({ key, label, type: "url", hint });
const T = (key: string, label: string, hint?: string): Col => ({ key, label, hint });
const I = (key: string, label: string, hint?: string): Col => ({ key, label, type: "int", hint });
const PAGE: Col = U("url", "Page");
const LINK_COLS: Col[] = [U("from", "From page"), T("anchor", "Anchor text"), U("to", "Links to"), I("status", "Status", "HTTP status of the linked address"), { key: "dofollow", label: "Follow", type: "bool" }];

/** Extra columns that show what is wrong for each page-level issue. */
function pageCols(key: string): Col[] {
  if (["no_title", "title_too_long", "title_too_short"].includes(key)) return [PAGE, T("title", "Current title"), I("title_len", "Characters")];
  if (key === "no_description") return [PAGE, T("title", "Title"), T("description", "Description")];
  if (key === "no_h1_tag") return [PAGE, T("title", "Title"), T("h1", "H1")];
  if (key === "is_redirect") return [PAGE, I("status", "Status"), U("location", "Redirects to")];
  if (key.startsWith("canonical") || key === "recursive_canonical") return [PAGE, U("canonical", "Canonical"), I("status", "Status")];
  if (key === "high_loading_time") return [PAGE, I("ms", "Load (ms)"), I("waiting", "Server wait (ms)"), I("words", "Words")];
  if (key === "low_content_rate") return [PAGE, { key: "rate", label: "Text share %", type: "dec" }, I("words", "Words")];
  if (key === "thin_content") return [PAGE, T("title", "Title"), I("words", "Words")];
  return [PAGE, I("status", "Status"), T("title", "Title"), I("words", "Words"), I("depth", "Click depth")];
}

/* ------------------------------------------------------------------ images (read from the pages' HTML) */
const ENT: Record<string, string> = { "&amp;": "&", "&quot;": "\"", "&#039;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
const decode = (s: string) => s.replace(/&(amp|quot|#0?39|lt|gt|nbsp);/g, (m) => ENT[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
export function parseImages(html: string, pageUrl: string): { src: string; alt: string | null; title: string | null }[] {
  const out: { src: string; alt: string | null; title: string | null }[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.slice(4).matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
    const raw = [attrs["data-lazy-src"], attrs["data-src"], attrs.src, (attrs["data-srcset"] ?? attrs.srcset ?? "").split(",")[0]?.trim().split(/\s+/)[0]]
      .find((v) => v && !v.startsWith("data:"));
    if (!raw || (attrs.width === "1" && attrs.height === "1")) continue;
    let src: string;
    try { src = new URL(raw, pageUrl).toString(); } catch { continue; }
    out.push({ src, alt: "alt" in attrs ? attrs.alt.trim() : null, title: "title" in attrs ? attrs.title.trim() : null });
  }
  return out;
}
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteAuditBot/1.0)", Accept: "text/html" }, signal: AbortSignal.timeout(12_000), cache: "no-store", redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return (await res.text()).slice(0, 6_000_000);
  } catch { return null; }
}
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } }));
  return out;
}
async function scanImages(urls: string[], which: "alt" | "title") {
  const list = urls.slice(0, IMAGE_PAGES);
  const pages = await pool(list, 5, async (u) => ({ u, html: await fetchHtml(u) }));
  const byImage = new Map<string, ImageRow>();
  let read = 0;
  for (const { u, html } of pages) {
    if (!html) continue;
    read++;
    const pageTitle = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "").slice(0, 200) || null;
    for (const img of parseImages(html, u)) {
      const missing = which === "alt" ? !img.alt : !img.title;
      if (!missing) continue;
      const row = byImage.get(img.src) ?? { src: img.src, alt: img.alt, title: img.title, pages: [], pageTitle };
      if (!row.pages.includes(u)) row.pages.push(u);
      byImage.set(img.src, row);
    }
  }
  const images = [...byImage.values()].sort((a, b) => b.pages.length - a.pages.length).slice(0, MAX_ROWS);
  return { images, read, asked: list.length };
}

/* ------------------------------------------------------------------ duplicate groups */
function groupsBy(pages: Json[], field: "title" | "description"): DetailGroup[] {
  const map = new Map<string, Json[]>();
  for (const p of pages) {
    const v = (str(obj(p.meta)[field]) ?? "").trim();
    const k = v.toLowerCase();
    map.set(k, [...(map.get(k) ?? []), p]);
  }
  return [...map.entries()].filter(([, ps]) => ps.length > 1).sort((a, b) => b[1].length - a[1].length)
    .map(([, ps]) => ({ label: (str(obj(ps[0].meta)[field]) ?? "").trim() || `(empty ${field})`, pages: ps.map((p) => ({ url: str(p.url) ?? "", title: str(obj(p.meta).title) })) }));
}
async function duplicateContentGroups(id: string, pages: Json[], spent: Spent): Promise<DetailGroup[]> {
  const dup = pages.filter((p) => p.duplicate_content === true).slice(0, DUP_PAGES);
  const titles = new Map(pages.map((p) => [str(p.url) ?? "", str(obj(p.meta).title)]));
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const sim = new Map<string, number>();
  await pool(dup, 6, async (p) => {
    const url = str(p.url) ?? "";
    parent.set(url, find(url));
    const r = await call("/on_page/duplicate_content", { id, url }, spent).catch(() => ({} as Json));
    for (const it of arr(r.items)) for (const g of arr(it.pages)) for (const other of arr(g.page)) {
      const o = str(other.url);
      if (!o || o === url) continue;
      parent.set(find(o), find(url));
      sim.set(o, Math.max(sim.get(o) ?? 0, num(g.similarity) ?? 0));
    }
  });
  const groups = new Map<string, string[]>();
  for (const u of parent.keys()) { const r = find(u); groups.set(r, [...(groups.get(r) ?? []), u]); }
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length).map((g, i) => ({
    label: `Group ${i + 1}: ${g.length} near-identical pages`,
    pages: g.map((u) => ({ url: u, title: titles.get(u) ?? null, similarity: sim.get(u) ?? null })),
  }));
}

/* ------------------------------------------------------------------ build one detail */
export const detailLabel = (key: string) => (METRIC_KEYS as Record<string, string>)[key] ?? issueInfo(key)?.label ?? (key === "orphans" ? "Orphaned pages" : key);

async function build(db: SupabaseClient, clientId: string, key: string, id: string): Promise<AuditDetail> {
  const spent: Spent = { cost: 0, clientId };
  const base = { key, label: detailLabel(key), taskId: id, fetchedAt: new Date().toISOString() };
  const done = (d: Omit<AuditDetail, "key" | "label" | "taskId" | "fetchedAt" | "cost">): AuditDetail => ({ ...base, ...d, cost: Number(spent.cost.toFixed(5)) });
  const m = key as MetricKey;

  if (m === "m_internal_links" || m === "m_external_links") {
    const l = await links(id, [["direction", "=", m === "m_internal_links" ? "internal" : "external"], "and", ["type", "=", "anchor"]], spent);
    return done({ kind: "links", total: l.total, columns: LINK_COLS, rows: l.rows, note: l.total > l.rows.length ? `Showing the first ${l.rows.length} of ${l.total} links (text links only).` : undefined });
  }
  if (key === "is_broken" || m === "m_broken_links") {
    const l = await links(id, [["is_broken", "=", true]], spent);
    return done({ kind: "links", total: l.total, columns: [U("to", "Broken address"), I("status", "Status"), U("from", "Linked from"), T("anchor", "Anchor text"), { key: "type", label: "Kind", type: "badge" }], rows: l.rows });
  }
  if (key === "is_4xx_code" || key === "is_5xx_code") {
    const pages = (await allPages(id, spent)).filter((p) => pageHasIssue(key, p));
    const lo = key === "is_4xx_code" ? 400 : 500;
    const l = await links(id, [["page_to_status_code", ">=", lo], "and", ["page_to_status_code", "<", lo + 100]], spent);
    const linked = new Set(l.rows.map((r) => r.to));
    const rows = [...l.rows, ...pages.filter((p) => !linked.has(str(p.url))).map((p) => ({ to: str(p.url), status: num(p.status_code), from: null, anchor: "(found in the sitemap or by the crawler, no link)" }))];
    return done({ kind: "links", total: pages.length, columns: [U("to", "Broken page"), I("status", "Status"), U("from", "Linked from"), T("anchor", "Anchor text")], rows, note: `${pages.length} broken page${pages.length === 1 ? "" : "s"}; each row is one link pointing at it.` });
  }
  if (key === "has_links_to_redirects") {
    const l = await links(id, [["direction", "=", "internal"], "and", ["page_to_status_code", ">=", 300], "and", ["page_to_status_code", "<", 400]], spent);
    return done({ kind: "links", total: l.total, columns: LINK_COLS, rows: l.rows });
  }
  if (key === "redirect_chain") {
    const r = await call("/on_page/redirect_chains", { id, limit: MAX_ROWS }, spent);
    const rows = arr(r.items).map((it) => {
      const chain = arr(it.chain);
      return { from: str(chain[0]?.from_url) ?? null, to: str(chain.at(-1)?.to_url) ?? null, steps: chain.length, loop: it.is_redirect_loop === true, path: chain.map((c) => `${str(c.from_url)} → ${str(c.to_url)}`).join("  |  ") };
    });
    return done({ kind: "links", total: num(r.total_items_count) ?? rows.length, columns: [U("from", "First URL"), U("to", "Final URL"), I("steps", "Redirects"), { key: "loop", label: "Loop", type: "bool" }, T("path", "Chain")], rows });
  }
  if (m === "m_non_indexable") {
    const r = await call("/on_page/non_indexable", { id, limit: MAX_ROWS }, spent);
    const rows = arr(r.items).map((it) => ({ url: str(it.url), reason: str(it.reason)?.replace(/_/g, " ") ?? null }));
    return done({ kind: "pages", total: num(r.total_items_count) ?? rows.length, columns: [PAGE, { key: "reason", label: "Why it can't be indexed", type: "badge" }], rows });
  }
  if (key === "duplicate_title" || key === "duplicate_description" || m === "m_duplicate_title" || m === "m_duplicate_description") {
    const field = key.endsWith("title") ? "title" : "description";
    const pages = (await allPages(id, spent)).filter((p) => (Array.isArray(p[`duplicate_${field}`]) ? (p[`duplicate_${field}`] as unknown[]).length > 0 : p[`duplicate_${field}`] === true));
    const groups = groupsBy(pages, field);
    return done({ kind: "groups", total: pages.length, columns: [], rows: [], groups });
  }
  if (key === "duplicate_content" || m === "m_duplicate_content") {
    const pages = await allPages(id, spent);
    const dup = pages.filter((p) => p.duplicate_content === true);
    const groups = await duplicateContentGroups(id, pages, spent);
    return done({ kind: "groups", total: dup.length, columns: [], rows: [], groups, note: dup.length > DUP_PAGES ? `Grouped the first ${DUP_PAGES} of ${dup.length} pages.` : undefined });
  }
  if (key === "html_errors") {
    const rows: Row[] = [];
    let total = 0;
    for (const p of await allPages(id, spent)) {
      const seen = new Set<string>();
      for (const e of arr(obj(p.resource_errors).errors)) {
        const k = `${num(e.line)}:${num(e.column)}:${str(e.message)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        total++;
        if (rows.length < MAX_ROWS) rows.push({ url: str(p.url), line: num(e.line), column: num(e.column), message: str(e.message) });
      }
    }
    return done({ kind: "errors", total, columns: [PAGE, I("line", "Line"), I("column", "Column"), T("message", "Error")], rows });
  }
  if (key === "no_image_alt" || key === "no_image_title") {
    const pages = (await allPages(id, spent)).filter((p) => pageHasIssue(key, p)).sort((a, b) => (num(a.click_depth) ?? 9) - (num(b.click_depth) ?? 9));
    const scan = await scanImages(pages.map((p) => str(p.url) ?? "").filter(Boolean), key === "no_image_alt" ? "alt" : "title");
    return done({
      kind: "images", total: pages.length, columns: [], rows: [], images: scan.images,
      note: `Read ${scan.read} of ${pages.length} affected page${pages.length === 1 ? "" : "s"}${pages.length > scan.asked ? ` (the ${scan.asked} closest to the home page)` : ""}; each image is listed once with every page it appears on.${scan.read < scan.asked ? ` ${scan.asked - scan.read} page${scan.asked - scan.read === 1 ? "" : "s"} didn't answer.` : ""}`,
    });
  }
  if (key === "is_orphan_page" || key === "orphans") {
    const pages = await allPages(id, spent);
    const { data: posts } = await db.from("blog_posts").select("url, title, links").eq("client_id", clientId).limit(2000);
    const rows = internalOrphans(pages.map((p) => ({ url: str(p.url) ?? "", status: num(p.status_code), title: str(obj(p.meta).title), orphan: obj(p.checks).is_orphan_page === true, sitemap: obj(p.checks).from_sitemap === true, words: num(obj(obj(p.meta).content).plain_text_word_count) })), (posts ?? []) as OrphanBlogPost[]);
    return done({ kind: "pages", total: rows.length, columns: [PAGE, T("title", "Title"), { key: "source", label: "Found by", type: "badge" }, T("evidence", "Evidence"), { key: "sitemap", label: "In sitemap", type: "bool" }, I("words", "Words")], rows: rows as unknown as Row[] });
  }
  // every other page-level issue: the crawled pages with the flag
  const pages = (await allPages(id, spent)).filter((p) => pageHasIssue(key, p));
  return done({ kind: "pages", total: pages.length, columns: pageCols(key), rows: pages.slice(0, MAX_ROWS).map(pageRow) });
}

export type DetailResult = { ok: true; detail: AuditDetail; fromCache: boolean } | { ok: false; error: string; sample?: string[] };

/**
 * The stored detail for `key`, or a fresh read from the crawl when there is none for the current audit (or `force`).
 * `db` reads (RLS), `admin` writes. Every query is scoped to `clientId`.
 */
export async function auditDetail(db: SupabaseClient, admin: SupabaseClient, clientId: string, key: string, force = false): Promise<DetailResult> {
  const { data: rows } = await db.from("dfs_cache").select("endpoint, data").eq("client_id", clientId).in("endpoint", ["audit", "audit_task"]);
  const audit = rows?.find((r) => r.endpoint === "audit")?.data as AuditResult | undefined;
  const task = rows?.find((r) => r.endpoint === "audit_task")?.data as AuditTask | undefined;
  if (!audit) return { ok: false, error: "No audit has finished yet." };
  const sample = audit.issues.find((i) => i.key === key)?.urls;
  const id = auditTaskId(audit, task);
  const cached = await readDetail(db, clientId, key);
  if (cached && !force && (!id || cached.taskId === id)) return { ok: true, detail: cached, fromCache: true };
  if (!id) return { ok: false, error: "This audit was stored before details were kept. Run a new audit to see every affected URL.", sample };
  try {
    const detail = await build(db, clientId, key, id);
    // keep earlier AI suggestions for the same crawl
    if (cached?.taskId === id) { detail.ai = cached.ai; detail.alt = cached.alt; detail.altSkipped = cached.altSkipped; }
    if (detail.cost > 0) await recordSpend(admin, clientId, "audit_detail", detail.cost, "manual");
    await saveDetail(admin, clientId, detail);
    return { ok: true, detail, fromCache: false };
  } catch (e) {
    if (e instanceof DfsError && /40401|40400|not found/i.test(e.message)) return { ok: false, error: "DataForSEO no longer keeps this crawl's details (about 30 days). Run a new audit.", sample };
    return { ok: false, error: e instanceof DfsError ? e.message : "Couldn't read the details. Try again.", sample };
  }
}
