import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Only same-site paths ("/x", never "//host" or "/\host"), so the callback can't become an open redirect. */
function safeNext(raw: string | null): string {
  return raw && /^\/(?![/\\])/.test(raw) ? raw : "/overview";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const next = safeNext(params.get("next"));
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=callback", request.url));
  } else if (params.get("error")) {
    // e.g. the user cancelled Google sign-in, or a reset link expired
    return NextResponse.redirect(new URL("/login?error=callback", request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
