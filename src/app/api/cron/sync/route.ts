import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
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
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: enqueued, error } = await admin.rpc("enqueue_daily_sync");
  if (error) return NextResponse.json({ error: "Could not enqueue" }, { status: 500 });
  const result = await processQueue();
  return NextResponse.json({ enqueued, ...result });
}

export const GET = handle;
export const POST = handle;
