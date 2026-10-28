import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { loggedRun } from "@/lib/jobs/log";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { processQueue } from "@/lib/sync/worker";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Scheduler entry point: enqueue daily jobs for every connected resource, then process the queue. */
const MAX_CHAIN = 15; // 15 chained runs x ~4 minutes x 3 workers comfortably covers a few hundred daily jobs

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const depth = Number(request.headers.get("x-chain-depth") ?? 0) || 0;
  try {
    const summary = await loggedRun(admin, "sync", async () => {
      // only the first run of the day enqueues; chained runs just keep draining
      let enqueued = 0;
      if (depth === 0) {
        const { data, error } = await admin.rpc("enqueue_daily_sync");
        if (error) throw new Error("Could not enqueue");
        enqueued = data ?? 0;
      }
      const result = await processQueue();
      const { count } = await admin.from("analytics_sync_jobs").select("id", { count: "exact", head: true })
        .eq("status", "queued").lte("run_after", new Date().toISOString());
      return { enqueued, depth, remaining: count ?? 0, ...result };
    });
    // Work left over: start another run in the background instead of waiting a whole day.
    if (summary.remaining > 0 && depth < MAX_CHAIN) {
      const next = new URL("/api/cron/sync", request.nextUrl.origin);
      after(() => fetch(next, { method: "POST", headers: { authorization: request.headers.get("authorization") ?? "", "x-chain-depth": String(depth + 1) } }).catch(() => undefined));
    }
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Sync run failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
