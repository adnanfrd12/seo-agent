import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/integrations/http";
import { revalidatePath } from "@/lib/revalidate";
import { settleConnection } from "@/lib/social/composio";
import { refreshPlatform } from "@/lib/social/fetch";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "@/lib/social/platforms";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const thanks = (label: string) => new NextResponse(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;text-align:center">` +
  `<h1 style="font-size:1.25rem">${label} is connected</h1><p>Thank you. You can close this tab.</p></body>`,
  { headers: { "content-type": "text/html; charset=utf-8" } },
);

/**
 * Composio sends the browser here after the platform login. Signed-in owners go back to /social with the
 * platform's stats already read; anyone else (a client who used a shared link) sees a short thank-you page.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("platform") ?? "";
  const p = (PLATFORMS as readonly string[]).includes(raw) ? (raw as Platform) : null;
  const label = p ? PLATFORM_INFO[p].label : "The account";
  const back = (qs: string) => NextResponse.redirect(new URL(`/social?${qs}`, request.url));
  if (request.nextUrl.searchParams.get("status") === "failed") return back(`connect_error=${encodeURIComponent(`${label} login was cancelled or failed.`)}`);

  let clientId: string;
  try { clientId = (await requireAdmin()).client.id; }
  catch { return thanks(label); }
  if (!p) return back("connect_error=" + encodeURIComponent("Unknown platform."));

  try {
    const c = await settleConnection(clientId, p);
    if (!c || c.status !== "ACTIVE") return back(`connect_error=${encodeURIComponent(`${label} login didn't finish. Press Connect again.`)}`);
    const row = await refreshPlatform({ admin: createAdminClient(), clientId, source: "manual" }, p);
    revalidatePath("/social");
    return row.status === "ok" ? back(`connected=${p}`) : back(`connected=${p}&connect_error=${encodeURIComponent(`${label} is connected, but reading it failed: ${row.error ?? row.needs ?? "unknown"}`)}`);
  } catch {
    return back(`connected=${p}&connect_error=${encodeURIComponent(`${label} is connected; press Refresh stats to read it.`)}`);
  }
}
