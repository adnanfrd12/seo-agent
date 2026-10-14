import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, parseProvider, requireAdmin } from "@/lib/integrations/http";
import { enqueueSync } from "@/lib/integrations/service";

type Ctx = { params: Promise<{ provider: string }> };

/** Enqueues a background job; never runs an import inside this request. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    assertSameOrigin(request);
    const provider = parseProvider((await params).provider);
    const { client } = await requireAdmin();
    const queued = await enqueueSync(client.id, provider);
    return NextResponse.json({ queued }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
