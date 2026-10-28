import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { nextRun } from "@/lib/jobs/log";

export type SourceHealth = "ok" | "stale" | "error" | "pending";
export interface SourceStatus {
  key: string; label: string; health: SourceHealth; lastSyncedAt: string | null; nextAt: string | null; error: string | null;
  /** what to expect from this provider, so a delay is never mistaken for a fault */
  note: string;
}

const META: Record<string, { label: string; job: "sync" | "research"; note: string }> = {
  ga4: { label: "Google Analytics 4", job: "sync", note: "Final numbers arrive 24-48 hours late" },
  gsc: { label: "Search Console", job: "sync", note: "Google reports search data with a 2-3 day delay" },
  gbp: { label: "Business Profile (Google)", job: "sync", note: "Performance data arrives a few days late" },
  lbm: { label: "Local Brand Manager", job: "sync", note: "Last ~25 days of daily metrics; reviews and rankings in full" },
  bing: { label: "Bing Webmaster", job: "sync", note: "Updated daily; query and page data is weekly" },
  clarity: { label: "Microsoft Clarity", job: "sync", note: "Clarity only serves the last 1-3 days, so history builds daily" },
};

/** Per-source freshness for one client, from stored sync results (no provider calls). */
export async function loadDataStatus(supabase: SupabaseClient, clientId: string): Promise<SourceStatus[]> {
  const [{ data: conns }, { data: dfs }, { data: snaps }] = await Promise.all([
    supabase.from("integration_connections").select("provider, status, last_error, last_synced_at").eq("client_id", clientId),
    supabase.from("dfs_cache").select("fetched_at").eq("client_id", clientId).order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("competitor_snapshots").select("snapshot_date").eq("client_id", clientId).eq("is_self", true).order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const out: SourceStatus[] = [];
  const lbmOk = (conns ?? []).some((c) => c.provider === "lbm" && c.status === "connected");
  for (const c of conns ?? []) {
    const m = META[c.provider];
    if (!m) continue;
    if (c.provider === "gbp" && lbmOk) continue; // Business Profile data comes through Local Brand Manager
    if (c.status === "disconnected") continue;
    const age = c.last_synced_at ? Date.now() - Date.parse(c.last_synced_at) : null;
    const health: SourceHealth = c.status === "error" ? "error" : c.status === "pending" ? "pending" : age === null ? "pending" : age > 48 * 3_600_000 ? "stale" : "ok";
    out.push({ key: c.provider, label: m.label, health, lastSyncedAt: c.last_synced_at, nextAt: nextRun(m.job).toISOString(), error: c.last_error, note: m.note });
  }
  const dfsAt = [dfs?.fetched_at, snaps?.snapshot_date ? `${snaps.snapshot_date}T07:30:00Z` : null].filter(Boolean).sort().at(-1) as string | undefined;
  if (dfsAt) {
    const age = Date.now() - Date.parse(dfsAt);
    out.push({ key: "dfs", label: "DataForSEO (rankings, links, competitors)", health: age > 8 * 86_400_000 ? "stale" : "ok", lastSyncedAt: dfsAt, nextAt: nextRun("research").toISOString(), error: null,
      note: "Third-party estimates; core data refreshes weekly, competitors daily" });
  }
  const order = ["ga4", "gsc", "gbp", "lbm", "bing", "clarity", "dfs"];
  return out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** Same data, de-duplicated within one request so a page header and the Overview can both ask for it. */
export const getDataStatus = cache(async (clientId: string) => loadDataStatus(await createClient(), clientId));
