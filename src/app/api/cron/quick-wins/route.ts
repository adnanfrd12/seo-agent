import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { collectAll, submitAll } from "@/lib/aiqw/nightly";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Nightly AI quick wins (clients with "Nightly run" on in AI quick wins → Settings):
 *   ?phase=submit  07:00 UTC (02:00 US Central): candidates for every client, one Message Batch each (half price)
 *   ?phase=collect 11:00 UTC: finished batches are validated and saved, then the morning email goes out
 * A batch that isn't finished by then is collected by the next run.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const phase = request.nextUrl.searchParams.get("phase") === "collect" ? "collect" : "submit";
  // collect first in both phases, so a batch left from yesterday is never in the way
  const collected = await collectAll(admin);
  const submitted = phase === "submit" ? await submitAll(admin) : [];
  return NextResponse.json({ phase, collected, submitted });
}
