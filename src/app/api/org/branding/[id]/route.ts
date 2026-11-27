import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_PUBLIC_BRANDING, getPublicBranding, UUID_RE } from "@/lib/org/branding";

/**
 * Public branding for the sign-in page (/login?org=<organization id>): display name, logo, favicon, colours and the
 * company name and website. Nothing else: no ids, members, settings or contact details. An unknown organization,
 * or one that hasn't turned on sign-in page branding, gets the default branding, so the answer never reveals
 * whether an organization exists. No sign-in needed (listed as public in src/proxy.ts); cached briefly.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.toLowerCase();
  if (!UUID_RE.test(id)) return NextResponse.json(DEFAULT_PUBLIC_BRANDING, { status: 400, headers: { "cache-control": "no-store" } });
  const body = await getPublicBranding(id);
  return NextResponse.json(body, {
    headers: {
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      "x-content-type-options": "nosniff",
    },
  });
}
