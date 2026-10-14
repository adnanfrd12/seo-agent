import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, parseProvider, requireAdmin } from "@/lib/integrations/http";
import { startConnect } from "@/lib/integrations/service";

type Ctx = { params: Promise<{ provider: string }> };

/** Starts the Composio OAuth flow; the browser is sent to the returned redirectUrl. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    assertSameOrigin(request);
    const provider = parseProvider((await params).provider);
    const { client } = await requireAdmin();
    const redirectUrl = await startConnect(client.id, provider);
    return NextResponse.json({ redirectUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
