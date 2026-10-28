import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AUTO_SHARE, getSettings, spend } from "@/lib/dataforseo/budget";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { refreshCore, resolveTarget } from "@/lib/dataforseo/research";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

const STALE_DAYS = 7;

/**
 * Daily. Refreshes the cheap core set (summary, new/lost, rank overview, ranked keywords) for clients
 * whose stored data is older than a week, oldest first, and stops as soon as today's automatic budget
 * (60% of the daily cap) is used. Deep dives and keyword research are never run automatically.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!dfsConfigured()) return NextResponse.json({ skipped: "DataForSEO not configured" });
  const admin = createAdminClient();
  // both come from the Integrations page: the daily budget and the automatic-refresh switch
  const settings = await getSettings(admin);
  if (!settings.autoRefresh) return NextResponse.json({ skipped: "Automatic refresh is turned off on the Integrations page" });
  const deadline = Date.now() + 270_000;

  const { data: clients } = await admin.from("clients").select("id");
  const { data: cached } = await admin.from("dfs_cache").select("client_id, fetched_at").eq("endpoint", "summary");
  const last = new Map((cached ?? []).map((r) => [r.client_id as string, Date.parse(r.fetched_at as string)]));
  const queue = (clients ?? []).map((c) => c.id as string)
    .filter((id) => !last.has(id) || Date.now() - last.get(id)! > STALE_DAYS * 86_400_000)
    .sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0));

  const results: { client: string; fetched: number; cost: number; note?: string }[] = [];
  let stopped: string | null = null;
  for (const id of queue) {
    if (Date.now() > deadline) { stopped = "time"; break; }
    let spentNow: number;
    try { spentNow = await spend(admin); } catch (e) { return NextResponse.json({ skipped: e instanceof Error ? e.message : "spend tracking unavailable" }); }
    if (spentNow >= settings.dailyBudget * AUTO_SHARE) { stopped = "budget"; break; }
    const target = await resolveTarget(admin, id); // derives the domain from Bing / Search Console / Business Profile
    if (!target || !target.auto_refresh) continue;
    const rep = await refreshCore({ admin, clientId: id, source: "auto" }, target);
    results.push({ client: id, fetched: rep.fetched.length, cost: Number(rep.cost.toFixed(4)), note: rep.errors[0] });
    if (rep.stoppedByBudget) { stopped = "budget"; break; }
  }
  return NextResponse.json({ refreshed: results.length, remaining: Math.max(0, queue.length - results.length), stopped, spentToday: Number((await spend(admin).catch(() => 0)).toFixed(3)), results });
}

export const GET = handle;
export const POST = handle;
