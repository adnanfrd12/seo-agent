import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runAnalysis, type RunKind } from "@/lib/ai/run";
import { serverEnv } from "@/lib/env";
import { monthRange, previousMonth, todayIn } from "@/lib/analytics/range";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Daily, but generates at most once per client per month: AI insights and the 30-day strategy for
 * the last complete month, so they're ready before anyone opens the page. Waits until the 4th so
 * Search Console's 2-3 day lag has settled. Skips clients without GA4/GSC/Business Profile/Bing data and anything already
 * generated (or running) for that month, so it never spends tokens twice on the same period.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serverEnv().ANTHROPIC_API_KEY) return NextResponse.json({ skipped: "ANTHROPIC_API_KEY not set" });
  const admin = createAdminClient();
  const deadline = Date.now() + 270_000;
  const { data: clients } = await admin.from("clients").select("id, timezone");
  const { data: tracked } = await admin.from("integration_resources").select("client_id").eq("is_selected", true).in("provider", ["ga4", "gsc", "gbp", "bing"]);
  const withData = new Set((tracked ?? []).map((r) => r.client_id));
  const results: { client: string; kind: RunKind; outcome: string }[] = [];

  for (const c of clients ?? []) {
    if (!withData.has(c.id)) continue;
    const today = todayIn(c.timezone);
    if (Number(today.slice(8, 10)) < 4) continue;
    const range = monthRange(previousMonth(today));
    for (const kind of ["insights", "strategy"] as RunKind[]) {
      if (Date.now() > deadline) break;
      const { data: existing } = await admin.from("ai_analysis_runs").select("id").eq("client_id", c.id).eq("kind", kind)
        .eq("range_start", range.start).eq("range_end", range.end).in("status", ["succeeded", "running"]).limit(1);
      if (existing?.length) continue;
      const r = await runAnalysis(admin, c.id, null, { start: range.start, end: range.end }, kind);
      results.push({ client: c.id, kind, outcome: r.ok ? `saved ${r.kept}` : r.error });
    }
  }
  return NextResponse.json({ generated: results });
}

export const GET = handle;
export const POST = handle;
