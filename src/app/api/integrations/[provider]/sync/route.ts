import { after, NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, parseProvider, requireAdmin } from "@/lib/integrations/http";
import { enqueueSync } from "@/lib/integrations/service";
import { processQueue } from "@/lib/sync/worker";

export const maxDuration = 300;

type Ctx = { params: Promise<{ provider: string }> };

/** Enqueues a job and returns immediately; the import runs after the response is sent. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    assertSameOrigin(request);
    const provider = parseProvider((await params).provider);
    const { client } = await requireAdmin();
    const queued = await enqueueSync(client.id, provider);
    // always kick the worker: it also drains jobs that were queued earlier but never picked up
    after(() => processQueue().catch((e) => console.error("worker failed:", e instanceof Error ? e.message : e)));
    return NextResponse.json({ queued }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
