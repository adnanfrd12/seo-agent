import { NextResponse, type NextRequest } from "next/server";
import { parseProvider, requireAdmin } from "@/lib/integrations/http";
import { completeConnect } from "@/lib/integrations/service";

type Ctx = { params: Promise<{ provider: string }> };

/** Composio redirects here after Google OAuth. Result is shown on /integrations. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const back = (qs: string) => NextResponse.redirect(new URL(`/integrations?${qs}`, request.url));
  try {
    const provider = parseProvider((await params).provider);
    if (request.nextUrl.searchParams.get("status") === "failed") {
      return back(`error=${encodeURIComponent("Google authorization was cancelled or failed")}&provider=${provider}`);
    }
    const { client } = await requireAdmin();
    const result = await completeConnect(client.id, provider);
    return result.ok
      ? back(`connected=${provider}`)
      : back(`error=${encodeURIComponent(result.reason)}&provider=${provider}`);
  } catch {
    return back("error=" + encodeURIComponent("Could not complete the connection"));
  }
}
