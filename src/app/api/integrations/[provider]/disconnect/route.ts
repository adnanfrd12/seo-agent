import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, parseProvider, requireAdmin } from "@/lib/integrations/http";
import { disconnect } from "@/lib/integrations/service";

type Ctx = { params: Promise<{ provider: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    assertSameOrigin(request);
    const provider = parseProvider((await params).provider);
    const { client } = await requireAdmin();
    await disconnect(client.id, provider);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
