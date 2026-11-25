import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { syncGa4xNow } from "@/app/(dashboard)/analytics/ga4x-actions";
import { syncClarityNow } from "@/app/(dashboard)/clarity/actions";
import { selectBingSites, syncBingNow } from "@/app/(dashboard)/integrations/bing-actions";
import { selectLbmLocations, syncLbmNow } from "@/app/(dashboard)/integrations/lbm-actions";
import { syncGscxNow } from "@/app/(dashboard)/search-console/gscx-actions";
import { BingError, userSites } from "@/lib/bing/api";
import { decryptSecret } from "@/lib/crypto";
import { HttpError } from "@/lib/integrations/http";
import { enqueueSync, selectResources } from "@/lib/integrations/service";
import { nextRun } from "@/lib/jobs/log";
import { LbmError, listLocations, type LbmLocation } from "@/lib/lbm/api";
import { loadDataStatus } from "@/lib/overview/status";
import { loadSocial } from "@/lib/social/fetch";
import { processQueue } from "@/lib/sync/worker";
import { bullets, plural, read, ToolError, write, type ExecResult, type NovaTool } from "../../kit";
import { socialLastRead } from "./social";
import { clip, compactObj, fit, when } from "./shared";

/**
 * Data syncs: connection status and freshness of every source, "Sync now" for each (Integrations page, and the
 * Analytics / Search Console sections' own Sync now), and choosing which property, site or location is tracked.
 * Connecting, disconnecting and API keys stay on the Integrations page.
 */

type Conn = { id: string; provider: string; status: string; last_synced_at: string | null; last_error: string | null; account_email: string | null };
type Res = { id: string; provider: string; external_id: string; display_name: string | null; is_selected: boolean; connection_id: string | null; timezone: string | null; metadata: Record<string, unknown> | null };
type Job = { provider: string; status: string; job_type: string; error: string | null; created_at: string; finished_at: string | null; resource_id: string | null };
type Data = { conns: Conn[]; res: Res[]; jobs: Job[] };

async function integrations(admin: SupabaseClient, clientId: string): Promise<Data> {
  const [c, r, j] = await Promise.all([
    admin.from("integration_connections").select("id, provider, status, last_synced_at, last_error, account_email").eq("client_id", clientId),
    admin.from("integration_resources").select("id, provider, external_id, display_name, is_selected, connection_id, timezone, metadata").eq("client_id", clientId),
    admin.from("analytics_sync_jobs").select("provider, status, job_type, error, created_at, finished_at, resource_id").eq("client_id", clientId).order("created_at", { ascending: false }).limit(80),
  ]);
  return { conns: (c.data ?? []) as Conn[], res: (r.data ?? []) as Res[], jobs: (j.data ?? []) as Job[] };
}

const nameOf = (r: Res) => r.display_name || r.external_id;
const conn = (d: Data, provider: string) => d.conns.find((c) => c.provider === provider) ?? null;
const ACTIVE = new Set(["queued", "running"]);

/* ------------------------------------------------------------------ sync now */
const SYNC = {
  ga4: { label: "Google Analytics 4", provider: "ga4", reports: false },
  ga4_reports: { label: "GA4 reports (Analytics pages)", provider: "ga4", reports: true },
  search_console: { label: "Search Console", provider: "gsc", reports: false },
  search_console_reports: { label: "Search Console reports (Search Console pages)", provider: "gsc", reports: true },
  business_profile: { label: "Business Profile", provider: "gbp", reports: false },
  bing: { label: "Bing Webmaster Tools", provider: "bing", reports: false },
  clarity: { label: "Microsoft Clarity", provider: "clarity", reports: false },
} as const;
type SyncKey = keyof typeof SYNC;
const SYNC_KEYS = Object.keys(SYNC) as [SyncKey, ...SyncKey[]];

/** The selected resources a sync would import: selected, and their connection is connected (what enqueue_sync_job picks). */
function syncTargets(d: Data, provider: string): Res[] {
  const ok = new Set(d.conns.filter((c) => c.status === "connected").map((c) => c.id));
  return d.res.filter((r) => r.provider === provider && r.is_selected && ok.has(r.connection_id ?? ""));
}

/** Why a source can't be synced now (null = it can). */
function blocked(d: Data, key: SyncKey): string | null {
  const { provider } = SYNC[key];
  if (syncTargets(d, provider).length) return null;
  const cs = provider === "gbp" ? d.conns.filter((c) => c.provider === "gbp" || c.provider === "lbm") : d.conns.filter((c) => c.provider === provider);
  const live = cs.filter((c) => c.status !== "disconnected");
  if (!live.length) return "not connected";
  if (!live.some((c) => c.status === "connected")) return `the connection ${live[0].status === "error" ? `has an error${live[0].last_error ? ` (${clip(live[0].last_error, 120)})` : ""}` : `is ${live[0].status}`}: reconnect it on Integrations`;
  return "connected, but nothing is selected to track";
}

function syncLine(d: Data, key: SyncKey): string {
  const { label, provider } = SYNC[key];
  const what = `${label}${provider === "clarity" ? "" : ` for ${syncTargets(d, provider).map(nameOf).join(", ")}`}`;
  switch (key) {
    case "ga4": case "search_console": return `${what}: import the last 14 days (Overview, reports and history).`;
    case "ga4_reports": return `${what}: read every report again now (last 190 days), about 1-2 minutes.`;
    case "search_console_reports": return `${what}: read performance (16 months), sitemaps and crawl again, plus up to 60 URL inspections, about 1-2 minutes.`;
    case "business_profile": return `${what}: performance, keywords, reviews and rankings.`;
    case "bing": return `${what}: search performance, crawl and keyword data.`;
    case "clarity": {
      const today = new Date().toISOString().slice(0, 10);
      const done = d.jobs.filter((j) => j.provider === "clarity" && ["succeeded", "partial"].includes(j.status) && (j.finished_at ?? "") >= `${today}T00:00:00`).length;
      return `${what}: the last day of behaviour data and recordings. Clarity's API allows only a few requests a day, so at most 3 syncs a day import data (${done} so far today).`;
    }
  }
}

/** Queued sources that already have a sync waiting or running: no second job is added, the worker just runs it now. */
function waitingLine(d: Data, keys: SyncKey[], tz: string): string | null {
  const w = keys.filter((k) => !SYNC[k].reports).map((k) => ({ k, job: d.jobs.find((j) => j.provider === SYNC[k].provider && ACTIVE.has(j.status)) })).filter((x) => x.job);
  if (!w.length) return null;
  const since = w.map((x) => x.job!.created_at).sort()[0];
  return `Already queued or running (oldest since ${when(since, tz)}): ${w.map((x) => SYNC[x.k].label).join(", ")}. No second sync is added; the sync worker is started so ${w.length === 1 ? "it runs" : "they run"} now.`;
}

type Part = { key: SyncKey; ok: boolean; message: string };
async function runSync(clientId: string, key: SyncKey): Promise<Part> {
  const res = (r: { ok: boolean; message?: string; error?: string }): Part => ({ key, ok: r.ok, message: (r.ok ? r.message : r.error ?? r.message) ?? (r.ok ? "Done." : "It didn't work.") });
  try {
    switch (key) {
      // the Integrations card's Sync Now (/api/integrations/[provider]/sync): queue a manual job; the worker is started below
      case "ga4": case "search_console": {
        const queued = await enqueueSync(clientId, key === "ga4" ? "ga4" : "gsc");
        return { key, ok: true, message: queued > 0 ? "Sync queued." : "A sync is already queued or running." };
      }
      case "ga4_reports": return res(await syncGa4xNow());
      case "search_console_reports": return res(await syncGscxNow());
      // queues every selected Business Profile location, whether it comes through Local Brand Manager or Google
      case "business_profile": return res(await syncLbmNow());
      case "bing": return res(await syncBingNow());
      case "clarity": return res(await syncClarityNow());
    }
  } catch (e) {
    return { key, ok: false, message: e instanceof HttpError ? e.message : (e instanceof Error ? e.message : "It didn't work.").slice(0, 200) };
  }
}

/* ------------------------------------------------------------------ what is tracked */
const TRACK = {
  ga4: { source: "Google Analytics 4", one: "property", many: "properties", provider: "ga4" },
  search_console: { source: "Search Console", one: "site", many: "sites", provider: "gsc" },
  business_profile: { source: "Business Profile (Google)", one: "location", many: "locations", provider: "gbp" },
  bing: { source: "Bing", one: "site", many: "sites", provider: "bing" },
  local_brand_manager: { source: "Local Brand Manager", one: "location", many: "locations", provider: "lbm" },
} as const;
type TrackKey = keyof typeof TRACK;
const TRACK_KEYS = Object.keys(TRACK) as [TrackKey, ...TrackKey[]];

async function secretOf(admin: SupabaseClient, connectionId: string): Promise<string | null> {
  const { data } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", connectionId).maybeSingle();
  try { return data?.refresh_token_encrypted ? decryptSecret(data.refresh_token_encrypted) : null; } catch { return null; }
}

/** `alt`: other ways to name it (a property's external id, a site without https://, a location's Google id) */
type Choice = { id: string; name: string; detail?: string; tracked: boolean; alt?: string[] };

/** Everything that can be tracked for a source, with what is tracked now. Bing and Local Brand Manager are asked live (read-only). */
async function choices(admin: SupabaseClient, clientId: string, d: Data, key: TrackKey): Promise<{ choices: Choice[]; note?: string; lbm?: LbmLocation[] }> {
  const { provider } = TRACK[key];
  const c = conn(d, provider);
  // Business Profile locations can come through Local Brand Manager instead of Google
  const hint = key === "business_profile" && conn(d, "lbm")?.status === "connected" ? " This client's Business Profile comes through Local Brand Manager: use local_brand_manager." : "";
  if (!c || c.status === "disconnected") throw new ToolError(`${TRACK[key].source} isn't connected for this client: connect it on the Integrations page first.${hint}`);
  if (c.status !== "connected") throw new ToolError(`The ${TRACK[key].source} connection ${c.status === "error" ? "has an error" : `is ${c.status}`}${c.last_error ? ` (${clip(c.last_error, 160)})` : ""}: reconnect it on the Integrations page first.${hint}`);
  if (key === "bing") {
    const keyStr = await secretOf(admin, c.id);
    if (!keyStr) throw new ToolError("The Bing API key isn't stored: reconnect Bing on the Integrations page.");
    try {
      const sites = await userSites(keyStr);
      const tracked = new Set(d.res.filter((r) => r.provider === "bing" && r.is_selected).map((r) => r.external_id));
      return { choices: (sites ?? []).map((s) => ({ id: s.Url, name: s.Url, detail: s.IsVerified ? "verified" : "not verified", tracked: tracked.has(s.Url), alt: [s.Url.replace(/^https?:\/\/(www\.)?/i, "")] })).sort((a, b) => a.name.localeCompare(b.name)) };
    } catch (e) { throw new ToolError(e instanceof BingError ? e.message : "Couldn't load the Bing sites. Try again."); }
  }
  if (key === "local_brand_manager") {
    const token = await secretOf(admin, c.id);
    if (!token) throw new ToolError("The Local Brand Manager token isn't stored: reconnect it on the Integrations page.");
    try {
      const all = (await listLocations(token)).filter((l) => l.gbp_id);
      const tracked = new Set(d.res.filter((r) => r.provider === "gbp" && r.is_selected && r.connection_id === c.id).map((r) => String(r.metadata?.lbm_id ?? "")));
      return { lbm: all, choices: all.map((l) => ({ id: l.id, name: l.name, detail: [l.address, l.enabled ? null : "disabled in LBM"].filter(Boolean).join(" · ") || undefined, tracked: tracked.has(l.id), alt: [l.gbp_id!, `locations/${l.gbp_id}`] })).sort((a, b) => a.name.localeCompare(b.name)) };
    } catch (e) { throw new ToolError(e instanceof LbmError ? e.message : "Couldn't load the Local Brand Manager locations. Try again."); }
  }
  // Google (Composio / direct OAuth): the resources found when the account was connected
  const rows = d.res.filter((r) => r.provider === provider && r.connection_id === c.id);
  return {
    choices: rows.map((r) => ({ id: r.id, name: nameOf(r), detail: [r.external_id !== nameOf(r) ? r.external_id : null, r.timezone].filter(Boolean).join(" · ") || undefined, tracked: r.is_selected, alt: [r.external_id, r.external_id.replace(/^sc-domain:/, "")] })),
    note: rows.length ? undefined : `No ${TRACK[key].many} were found for the connected Google account.`,
  };
}

/** Matches the model's items (ids, external ids, URLs or names) to choices; a ToolError lists the real options. */
function pick(list: Choice[], items: string[], key: TrackKey): Choice[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  const out: Choice[] = [];
  const options = () => `${list.slice(0, 12).map((c) => `${c.name} (id ${c.id})`).join("; ")}${list.length > 12 ? `; and ${list.length - 12} more (get_data_sync_status choices_for lists them)` : ""}`;
  for (const it of items) {
    const n = norm(it);
    const exact = list.find((c) => c.id === it.trim());
    const m = exact ? [exact] : list.filter((c) => [c.id, c.name, ...(c.alt ?? [])].some((v) => norm(v) === n));
    if (m.length > 1) throw new ToolError(`"${clip(it, 80)}" matches ${m.length} ${TRACK[key].many}: ${m.slice(0, 6).map((c) => `${c.name} (id ${c.id})`).join("; ")}. Use the id.`);
    if (!m.length) throw new ToolError(`"${clip(it, 80)}" isn't one of the available ${TRACK[key].source} ${TRACK[key].many}. Options: ${options()}.`);
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

export const syncTools: NovaTool[] = [
  read({
    name: "get_data_sync_status",
    description: "Data sources: connection, what is tracked, last sync, errors, waiting or running syncs and the next automatic sync, plus section reports, DataForSEO, blog and social freshness. choices_for lists what a source can track (ids for select_tracked_items).",
    schema: z.object({
      choices_for: z.enum(TRACK_KEYS).optional(),
      search: z.string().trim().max(80).optional().describe("filter the choices by name"),
    }),
    async run(ctx, i) {
      const id = ctx.client.id, tz = ctx.client.timezone;
      const [d, status, metas, blogLast, blogCount, social] = await Promise.all([
        integrations(ctx.admin, id), loadDataStatus(ctx.admin, id).catch(() => []),
        ctx.admin.from("dfs_cache").select("endpoint, fetched_at, data").eq("client_id", id).in("endpoint", ["ga4x", "gscx"]).like("params_hash", "%:meta"),
        ctx.admin.from("blog_posts").select("fetched_at").eq("client_id", id).order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
        ctx.admin.from("blog_posts").select("id", { count: "exact", head: true }).eq("client_id", id),
        loadSocial(ctx.admin, id).catch(() => ({})),
      ]);
      const health = new Map(status.map((s) => [s.key, s]));
      const LABEL: Record<string, string> = { ga4: "Google Analytics 4", gsc: "Search Console", gbp: "Business Profile (Google)", lbm: "Local Brand Manager (Business Profile)", bing: "Bing Webmaster Tools", clarity: "Microsoft Clarity" };
      const sources = d.conns.filter((c) => c.status !== "disconnected" && LABEL[c.provider]).map((c) => {
        const tracked = c.provider === "lbm" ? d.res.filter((r) => r.provider === "gbp" && r.connection_id === c.id && r.is_selected) : d.res.filter((r) => r.provider === c.provider && r.connection_id === c.id && r.is_selected);
        const jobProvider = c.provider === "lbm" ? "gbp" : c.provider;
        const ids = new Set(tracked.map((r) => r.id));
        const jobs = d.jobs.filter((j) => j.provider === jobProvider && ids.has(j.resource_id ?? ""));
        const last = jobs.find((j) => !ACTIVE.has(j.status)), active = jobs.find((j) => ACTIVE.has(j.status));
        const h = health.get(c.provider);
        return compactObj({
          source: LABEL[c.provider], connection: c.status, account: c.account_email, tracking: tracked.map(nameOf), last_sync: c.last_synced_at,
          health: h?.health ?? (c.status === "error" ? "error" : undefined), note: h?.note, error: c.last_error ?? undefined,
          latest_finished_sync: last ? compactObj({ status: last.status, type: last.job_type, finished: last.finished_at ?? last.created_at, error: last.error ? clip(last.error, 300) : undefined }) : undefined,
          sync_waiting: active ? `${active.job_type} sync ${active.status} since ${active.created_at}` : undefined,
        });
      });
      const connected = new Set(d.conns.filter((c) => c.status !== "disconnected").map((c) => c.provider));
      const meta = (e: string) => {
        const m = (metas.data ?? []).filter((r) => r.endpoint === e).sort((a, b) => String(b.fetched_at).localeCompare(String(a.fetched_at)))[0];
        if (!m) return undefined;
        const errs = Object.keys(((m.data as { errors?: Record<string, string> } | null)?.errors) ?? {});
        return compactObj({ last_synced: m.fetched_at, failed_reports: errs.length ? errs : undefined });
      };
      const out: Record<string, unknown> = {
        sources,
        not_connected: Object.entries(LABEL).filter(([k]) => !connected.has(k) && !(k === "gbp" && connected.has("lbm"))).map(([, v]) => v),
        section_reports: compactObj({ ga4_reports: meta("ga4x"), search_console_reports: meta("gscx") }),
        dataforseo: health.get("dfs") ? { last_update: health.get("dfs")!.lastSyncedAt, health: health.get("dfs")!.health, note: health.get("dfs")!.note } : "no DataForSEO data yet",
        blog: { posts: blogCount.count ?? 0, last_read: blogLast.data?.fetched_at ?? null },
        social: socialLastRead(social),
        next_automatic_sync: nextRun("sync").toISOString(),
        times: `ISO timestamps (UTC); the client's time zone is ${tz}`,
        can_sync_now: SYNC_KEYS.filter((k) => !blocked(d, k)),
        cannot_sync: Object.fromEntries(SYNC_KEYS.map((k) => [k, blocked(d, k)]).filter(([, v]) => v)),
      };
      if (i.choices_for) {
        const c = await choices(ctx.admin, id, d, i.choices_for);
        const q = i.search?.toLowerCase();
        const list = q ? c.choices.filter((x) => x.name.toLowerCase().includes(q) || (x.detail ?? "").toLowerCase().includes(q) || x.id.toLowerCase().includes(q)) : c.choices;
        out.choices = compactObj({ for: i.choices_for, total: list.length, tracked_now: c.choices.filter((x) => x.tracked).map((x) => x.name), note: c.note, items: list.slice(0, 60).map((x) => compactObj({ id: x.id, name: x.name, detail: x.detail, tracked: x.tracked || undefined })), more: list.length > 60 ? `${list.length - 60} more: use search to narrow` : undefined });
      }
      return fit(out, () => {
        const ch = out.choices as { items?: unknown[] } | undefined;
        if (ch?.items && ch.items.length > 15) { ch.items = ch.items.slice(0, 15); return true; }
        return false;
      });
    },
    summary: (i) => (i.choices_for ? "Checked data sources and what can be tracked" : "Checked data sources and syncs"),
  }),

  write({
    name: "sync_data_sources",
    description: "Sync data now. ga4, search_console, business_profile, bing, clarity queue the regular import (Integrations' Sync Now; data arrives within minutes); ga4_reports and search_console_reports re-read the Analytics and Search Console sections' reports now (1-2 minutes each).",
    schema: z.object({ sources: z.array(z.enum(SYNC_KEYS)).min(1).max(SYNC_KEYS.length) }),
    async prepare(ctx, i) {
      const d = await integrations(ctx.admin, ctx.client.id);
      const wanted = [...new Set(i.sources)];
      const ok = wanted.filter((k) => !blocked(d, k));
      const skipped = wanted.filter((k) => blocked(d, k)).map((k) => `${SYNC[k].label}: ${blocked(d, k)}`);
      if (!ok.length) return { error: `Nothing can be synced: ${skipped.join("; ")}.` };
      const reports = ok.filter((k) => SYNC[k].reports).length;
      return {
        title: ok.length === 1 ? `Sync ${SYNC[ok[0]].label} now` : `Sync ${ok.length} data sources now`,
        detail: [
          bullets(ok.map((k) => syncLine(d, k))),
          waitingLine(d, ok, ctx.client.timezone) ?? "",
          skipped.length ? `Skipped: ${skipped.join("; ")}.` : "",
          ok.some((k) => !SYNC[k].reports) ? "Queued imports run in the background and usually finish within a few minutes. Free (the providers' own APIs)." : "Free (the providers' own APIs).",
        ].filter(Boolean).join("\n"),
        input: { sources: ok },
        ...(reports ? { expectSeconds: 100 } : {}),
      };
    },
    async execute(x, i) {
      const started = Date.now();
      const parts = await Promise.all(i.sources.map((k) => runSync(x.client.id, k)));
      // the Integrations route starts the worker after queueing GA4 / Search Console; the other actions start it themselves
      if (parts.some((p) => (p.key === "ga4" || p.key === "search_console") && p.ok)) {
        after(() => processQueue({ budgetMs: Math.max(20_000, 270_000 - (Date.now() - started)) }).then(() => undefined, () => undefined));
      }
      const good = parts.filter((p) => p.ok), bad = parts.filter((p) => !p.ok);
      const line = (p: Part) => `${SYNC[p.key].label}: ${p.message.replace(/\.$/, "")}`;
      const paths = ["/integrations", "/overview", ...i.sources.map((k) => ({ ga4: "/analytics", ga4_reports: "/analytics", search_console: "/search-console", search_console_reports: "/search-console", business_profile: "/business-profile", bing: "/bing", clarity: "/clarity" })[k])];
      const r: ExecResult = good.length
        ? { ok: true, message: `${good.map(line).join(". ")}.${bad.length ? ` Didn't work: ${bad.map(line).join(". ")}.` : ""}`, paths: [...new Set(paths)] }
        : { ok: false, message: `${bad.map(line).join(". ")}.` };
      return r;
    },
  }),

  write({
    name: "select_tracked_items",
    description: "Choose what a connected source tracks, replacing the current selection: GA4 properties, Search Console sites, Google Business Profile locations, Bing sites or Local Brand Manager locations (ids from get_data_sync_status choices_for). Starts an import.",
    schema: z.object({
      source: z.enum(TRACK_KEYS),
      items: z.array(z.string().trim().min(1).max(500)).min(1).max(50).describe("ids from choices_for (Bing: the site URLs)"),
    }),
    async prepare(ctx, i) {
      const d = await integrations(ctx.admin, ctx.client.id);
      const c = await choices(ctx.admin, ctx.client.id, d, i.source);
      const chosen = pick(c.choices, i.items, i.source);
      if (i.source === "bing" && chosen.length > 20) return { error: "Bing can track at most 20 sites per client." };
      const before = c.choices.filter((x) => x.tracked);
      const same = before.length === chosen.length && chosen.every((x) => x.tracked);
      if (same) return { error: `Already tracking exactly ${chosen.map((x) => x.name).join(", ")}: nothing to change.` };
      const start = chosen.filter((x) => !x.tracked), stop = before.filter((x) => !chosen.includes(x)), keep = chosen.filter((x) => x.tracked);
      const lines = [
        ...(start.length ? [`Start tracking: ${start.map((x) => x.name).join(", ")}`] : []),
        ...(stop.length ? [`Stop tracking: ${stop.map((x) => x.name).join(", ")}`] : []),
        ...(keep.length ? [`Keep tracking: ${keep.map((x) => x.name).join(", ")}`] : []),
      ];
      const ids = chosen.map((x) => x.id);
      if (i.source === "business_profile") {
        // the Google selection save clears every Business Profile location, so Local Brand Manager ones are passed along to keep them
        const google = conn(d, "gbp")!;
        const viaLbm = d.res.filter((r) => r.provider === "gbp" && r.is_selected && r.connection_id !== google.id && !ids.includes(r.id));
        if (viaLbm.length) { ids.push(...viaLbm.map((r) => r.id)); lines.push(`Local Brand Manager locations stay tracked: ${viaLbm.map(nameOf).join(", ")}`); }
      }
      const history = { ga4: "the last 90 days now, then older history in the background (up to 5 years)", search_console: "the last 90 days now, then older history in the background (up to 16 months)", business_profile: "the last 90 days now, then older history in the background (up to 18 months)", bing: "all the history Bing keeps (about 16 months), in about a minute", local_brand_manager: "performance, keywords, reviews and rankings, in about a minute" }[i.source];
      lines.push(`Imports ${history}.`, "Items no longer selected stop syncing; their stored data isn't deleted.");
      const t = TRACK[i.source];
      return {
        title: `${t.source}: track ${chosen.length === 1 ? `the ${t.one}` : `${chosen.length} ${t.many}`} ${clip(chosen.map((x) => x.name).join(", "), 110)}${stop.length ? ` instead of ${clip(stop.map((x) => x.name).join(", "), 60)}` : ""}`,
        detail: bullets(lines), input: { source: i.source, items: ids },
        // Local Brand Manager's location list is read again on Confirm
        ...(i.source === "local_brand_manager" ? { expectSeconds: 15 } : {}),
      };
    },
    async execute(x, i): Promise<ExecResult> {
      if (i.source === "bing") {
        const r = await selectBingSites(i.items);
        return r.ok ? { ok: true, message: r.message, paths: ["/integrations", "/bing"] } : { ok: false, message: r.error };
      }
      if (i.source === "local_brand_manager") {
        const d = await integrations(x.admin, x.client.id);
        const c = await choices(x.admin, x.client.id, d, "local_brand_manager");
        const picks = i.items.map((id) => c.lbm?.find((l) => l.id === id)).filter((l): l is LbmLocation => Boolean(l?.gbp_id)).map((l) => ({ id: l.id, gbpId: l.gbp_id!, name: l.name }));
        if (picks.length !== i.items.length) return { ok: false, message: "Some of those locations are no longer in Local Brand Manager. Ask Nova again." };
        const r = await selectLbmLocations(picks);
        return r.ok ? { ok: true, message: r.message, paths: ["/integrations", "/business-profile"] } : { ok: false, message: r.error };
      }
      // GA4, Search Console and Google Business Profile: what /api/integrations/[provider]/select does
      const provider = i.source === "ga4" ? "ga4" : i.source === "search_console" ? "gsc" : "gbp";
      const ids = [...new Set(i.items)];
      // selectResources() clears the selection before it checks the ids: make sure they all still exist first
      const { data: found } = await x.admin.from("integration_resources").select("id").eq("client_id", x.client.id).eq("provider", provider).in("id", ids);
      if ((found ?? []).length !== ids.length) return { ok: false, message: "Some of those items are no longer available (was the account reconnected?). Ask Nova again." };
      try {
        const r = await selectResources(x.client.id, provider, ids);
        after(() => processQueue().then(() => undefined, () => undefined));
        return { ok: true, message: `Saved: tracking ${plural(r.selected, provider === "ga4" ? "property" : provider === "gsc" ? "site" : "location", provider === "ga4" ? "properties" : undefined)}.${r.queued > 0 ? " Import queued: recent data first, then older history in the background." : ""}`, paths: ["/integrations", "/overview"] };
      } catch (e) {
        return { ok: false, message: e instanceof HttpError ? e.message : "Couldn't save the selection." };
      }
    },
  }),
];
