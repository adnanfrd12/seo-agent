import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing of one-time sign-in links built from a token hash (the invitation page's emailed sign-in link):
 * verifies the link with Supabase, which signs the person in (session cookies) and confirms their address, then
 * continues to `next`. Works in any browser (no PKCE verifier needed). Public under the proxy's /auth prefix.
 */
const TYPES = new Set<string>(["magiclink", "email", "invite", "signup", "recovery"]);

/** Only same-site paths ("/x", never "//host" or "/\host"), as in /auth/callback. */
function safeNext(raw: string | null): string {
  return raw && /^\/(?![/\\])/.test(raw) ? raw : "/overview";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const fail = () => NextResponse.redirect(new URL("/login?error=callback", request.url));
  if (!tokenHash || !type || !TYPES.has(type)) return fail();
  const { error } = await (await createClient()).auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
  if (error) return fail();
  return NextResponse.redirect(new URL(safeNext(params.get("next")), request.url));
}
