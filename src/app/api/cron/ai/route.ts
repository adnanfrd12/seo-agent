import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runAnalysis, type RunKind } from "@/lib/ai/run";
import { serverEnv } from "@/lib/env";
import { activeClientIds } from "@/lib/activity";
import { loggedRun } from "@/lib/jobs/log";
import { monthRange, previousMonth, shiftDays, todayIn } from "@/lib/analytics/range";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Daily.
 *  - Monthly: AI insights and the 30-day strategy for the last complete month, once per client, from the 4th
 *    (Search Console's 2-3 day lag has settled). Never spends tokens twice on the same period.
 *  - Weekly refresh: for clients opened in the last 14 days, a rolling "last 28 days" insights run when the
 *    previous one is over 6 days old AND the underlying numbers have changed (otherwise it is skipped).
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serverEnv().ANTHROPIC_API_KEY) return NextResponse.json({ skipped: "ANTHROPIC_API_KEY not set" });
  const admin = createAdminClient();
  const deadline = Date.now() + 270_000;
  try {
    const summary = await loggedRun(admin, "ai", async () => {
      const { data: clients } = await admin.from("clients").select("id, timezone");
      const { data: tracked } = await admin.from("integration_resources").select("client_id").eq("is_selected", true).in("provider", ["ga4", "gsc", "gbp", "bing"]);
      const withData = new Set((tracked ?? []).map((r) => r.client_id));
      const active = await activeClientIds(admin);
      const results: { client: string; kind: RunKind; outcome: string }[] = [];

      for (const c of clients ?? []) {
        if (!withData.has(c.id)) continue;
        const today = todayIn(c.timezone);
        if (Number(today.slice(8, 10)) >= 4) {
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
        // weekly rolling refresh for clients people actually use
        if (active.has(c.id) && Date.now() < deadline) {
          const { data: last } = await admin.from("ai_analysis_runs").select("created_at").eq("client_id", c.id).eq("kind", "insights").in("status", ["succeeded", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (!last || Date.now() - Date.parse(last.created_at) > 6 * 86_400_000) {
            const end = shiftDays(today, -3);
            const r = await runAnalysis(admin, c.id, null, { start: shiftDays(end, -27), end }, "insights", { skipIfUnchanged: true });
            results.push({ client: c.id, kind: "insights", outcome: r.ok ? (r.skipped ? "skipped: data unchanged" : `weekly refresh saved ${r.kept}`) : r.error });
          }
        }
      }
      return { generated: results.length, results };
    });
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "AI run failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
