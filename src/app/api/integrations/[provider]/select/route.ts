import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, errorResponse, HttpError, parseProvider, requireAdmin } from "@/lib/integrations/http";
import { selectResources } from "@/lib/integrations/service";

type Ctx = { params: Promise<{ provider: string }> };
const body = z.object({ resourceIds: z.array(z.uuid()).max(100) });

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    assertSameOrigin(request);
    const provider = parseProvider((await params).provider);
    const { client } = await requireAdmin();
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "resourceIds must be a list of ids");
    const result = await selectResources(client.id, provider, [...new Set(parsed.data.resourceIds)]);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
