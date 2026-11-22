import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTarget } from "@/lib/dataforseo/research";

/**
 * SEOSignalX through its read-only MCP server (https://seosignalx.com/api/mcp, Streamable HTTP, bearer token in
 * SEOSIGNALX_MCP_TOKEN). The server offers: list/get projects, list/get saved audits, list patches and the feature
 * catalog. Only the saved audits it has are shown (E-E-A-T, Semantic, Speed, Robots.txt, Crawl Optimization);
 * site-audit crawl data, GSC, keywords and the rest of the SEOSignalX app aren't served by the MCP.
 *
 * A client is matched to the SEOSignalX project with the same domain. Results are stored in dfs_cache
 * (endpoint "seosignalx", key "<projectId>:<toolKey>") and refreshed in the background every few hours.
 */
const ENDPOINT = "https://seosignalx.com/api/mcp";
export const CACHE_ENDPOINT = "seosignalx";
export const STALE_MS = 6 * 3_600_000;

export const AUDITS = [
  { key: "eeat", label: "E-E-A-T", href: "/seosignalx/eeat" },
  { key: "semantic", label: "Semantic", href: "/seosignalx/semantic" },
  { key: "speed", label: "Speed", href: "/seosignalx/speed" },
  { key: "robots", label: "Robots.txt", href: "/seosignalx/robots" },
  { key: "crawlOptimization", label: "Crawl Optimization", href: "/seosignalx/crawl-optimization" },
] as const;
export type AuditKey = (typeof AUDITS)[number]["key"];

/** Names for audits without their own page (shown on the generic audit page); unknown keys are spelled out. */
const OTHER_LABELS: Record<string, string> = {
  security: "Security Audit", duplicate: "Duplicate Checker", plagiarism: "Plagiarism Checker", linkChecker: "Advanced Link Checker",
  schemaAuditor: "Schema Auditor", schema: "Schema Auditor", backlinks: "Backlinks Audit", gscAudit: "GSC Audit", bing: "Bing Webmaster",
  crawlVisualizer: "Crawl Visualizer", onPage: "On-Page Analyzer", pageSeo: "Page SEO Optimization",
};
export function auditLabel(key: string): string {
  const known = AUDITS.find((a) => a.key === key);
  if (known) return `${known.label} Audit`.replace("Audit Audit", "Audit");
  return OTHER_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}
/** Where an audit is shown: its own page for the five known ones, the generic page for any other. */
export const auditHref = (key: string) => AUDITS.find((a) => a.key === key)?.href ?? `/seosignalx/audits/${encodeURIComponent(key)}`;
/** At most this many saved audits are read per sync (each is one MCP call). */
const MAX_AUDITS = 20;

export const sxConfigured = () => Boolean(process.env.SEOSIGNALX_MCP_TOKEN?.trim());

/** One MCP session: initialize, then call tools. Text results are JSON (truncated ones are repaired). */
async function session() {
  const token = process.env.SEOSIGNALX_MCP_TOKEN?.trim();
  if (!token) throw new Error("SEOSIGNALX_MCP_TOKEN isn't set.");
  let sid: string | null = null, id = 0;
  const rpc = async (method: string, params: unknown, notify = false) => {
    const res = await fetch(ENDPOINT, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) },
      body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params }),
    });
    sid = res.headers.get("mcp-session-id") ?? sid;
    if (res.status === 401 || res.status === 403) throw new Error("SEOSignalX rejected the MCP token. Generate a new one in SEOSignalX → MCP.");
    const text = await res.text();
    if (notify) return null;
    if (!res.ok) throw new Error(`SEOSignalX MCP error ${res.status}.`);
    const data = /^data: (.*)$/m.exec(text)?.[1] ?? text;
    return JSON.parse(data) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } };
  };
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "seo-insights", version: "1.0" } });
  await rpc("notifications/initialized", {}, true);
  return async <T>(name: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; truncated: boolean; message?: string }> => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r?.error) throw new Error(r.error.message ?? "SEOSignalX MCP call failed.");
    const text = (r?.result?.content ?? []).map((c) => c.text ?? "").join("");
    const truncated = /\[Output truncated[^\]]*\]\s*$/.test(text);
    try { return { data: JSON.parse(truncated ? repairJson(text) : text) as T, truncated }; }
    catch { return { data: null, truncated, message: text.slice(0, 200) }; }
  };
}

/** Closes JSON that was cut off (SEOSignalX truncates MCP answers at ~80 KB): drops the unfinished tail and closes brackets. */
export function repairJson(text: string): string {
  const s = text.replace(/\[Output truncated[^\]]*\]\s*$/, "");
  let inStr = false, esc = false, lastSafe = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "}" || c === "]") lastSafe = i + 1;
    else if (c === ",") lastSafe = i;
  }
  const cut = s.slice(0, lastSafe).replace(/,\s*$/, "");
  const open: string[] = [];
  inStr = false; esc = false;
  for (const c of cut) {
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{" || c === "[") open.push(c); else if (c === "}" || c === "]") open.pop();
  }
  return cut + open.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
}

export interface SxProject { id: string; name: string; domain: string; fullUrl: string; createdAt: string; updatedAt: string; lastCrawlAt: string | null }
export interface SxPatch { id?: string; title?: string; name?: string; status?: string; type?: string; createdAt?: string; updatedAt?: string; [k: string]: unknown }
export interface SxAudit<T = Record<string, unknown>> { toolKey: string; projectUrl: string; updatedAt: string; result: T; truncated?: boolean }
export interface SxBundle {
  fetchedAt: string; project: SxProject | null; projects: SxProject[]; patches: SxPatch[];
  /** every saved audit SEOSignalX has for the project, by its tool key (the five known ones and any other) */
  audits: Partial<Record<string, SxAudit>>; available: string[]; error?: string;
}

const host = (d: string | null | undefined) => (d ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Reads everything the MCP has for the client's project (5-10 calls, all free and read-only). */
export async function fetchBundle(domain: string | null): Promise<SxBundle> {
  const call = await session();
  const { data: list } = await call<{ projects?: SxProject[] }>("seosignalx_list_projects");
  const projects = list?.projects ?? [];
  const project = projects.find((p) => host(p.domain) === host(domain) || host(p.fullUrl) === host(domain)) ?? null;
  const out: SxBundle = { fetchedAt: new Date().toISOString(), project, projects, patches: [], audits: {}, available: [] };
  if (!project) return out;
  const [{ data: saved }, { data: patches }] = await Promise.all([
    call<{ audits?: { toolKey: string }[] }>("seosignalx_list_saved_audits", { projectId: project.id }),
    call<{ patches?: SxPatch[] }>("seosignalx_list_patches", { projectId: project.id }),
  ]);
  out.patches = patches?.patches ?? [];
  out.available = (saved?.audits ?? []).map((a) => a.toolKey);
  // every saved audit, not only the five with their own page, so a newly saved one (e.g. Security) shows up by itself
  for (const key of out.available.slice(0, MAX_AUDITS)) {
    const { data, truncated } = await call<SxAudit>("seosignalx_get_saved_audit", { projectId: project.id, toolKey: key });
    if (data?.result) out.audits[key] = { ...data, truncated };
  }
  return out;
}

/** The domain used to find the client's SEOSignalX project. */
export async function clientDomain(admin: SupabaseClient, clientId: string) {
  return (await resolveTarget(admin, clientId))?.domain ?? null;
}

export async function loadBundle(admin: SupabaseClient, clientId: string): Promise<{ bundle: SxBundle | null; fetchedAt: string | null }> {
  const { data } = await admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", CACHE_ENDPOINT).eq("params_hash", "bundle").maybeSingle();
  return { bundle: (data?.data as SxBundle | null) ?? null, fetchedAt: (data?.fetched_at as string | null) ?? null };
}

export async function refreshBundle(admin: SupabaseClient, clientId: string): Promise<SxBundle> {
  let bundle: SxBundle;
  try { bundle = await fetchBundle(await clientDomain(admin, clientId)); }
  catch (e) {
    const prev = (await loadBundle(admin, clientId)).bundle;
    bundle = { ...(prev ?? { project: null, projects: [], patches: [], audits: {}, available: [] }), fetchedAt: prev?.fetchedAt ?? new Date().toISOString(), error: e instanceof Error ? e.message : "SEOSignalX couldn't be reached." };
  }
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: CACHE_ENDPOINT, params_hash: "bundle", params: { source: "mcp" }, data: bundle, row_count: Object.keys(bundle.audits).length, cost: 0, fetched_at: new Date().toISOString() },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  return bundle;
}

export const isStale = (fetchedAt: string | null) => !fetchedAt || Date.now() - Date.parse(fetchedAt) > STALE_MS;
