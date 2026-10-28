import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/auth", "/api/cron"];
// date-driven pages: opened without a range they get the one the user last picked (cookie written by RangeMemory)
const RANGE_PATHS = new Set(["/overview", "/analytics", "/search-console", "/business-profile", "/bing", "/opportunities", "/insights", "/strategy"]);
const RANGE_COOKIE = "seo_range";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validated range parameters from the cookie, or null. Anything unexpected is ignored. */
function savedRange(raw: string | undefined): URLSearchParams | null {
  if (!raw) return null;
  try {
    const p = new URLSearchParams(decodeURIComponent(raw));
    const out = new URLSearchParams();
    const range = p.get("range"), start = p.get("start"), end = p.get("end");
    if (range && ["7", "30", "90", "month"].includes(range)) out.set("range", range);
    else if (start && end && ISO_DATE.test(start) && ISO_DATE.test(end) && start <= end) { out.set("start", start); out.set("end", end); }
    else return null;
    if (p.get("compare") === "1") out.set("compare", "1");
    return out;
  } catch { return null; }
}

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;

export async function proxy(request: NextRequest) {
  // A missing variable used to crash every request with an opaque 500. Say exactly what is wrong
  // (names only, never values) so a fresh deployment is easy to fix.
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return new NextResponse(
      `Server is not configured. Missing environment variables: ${missing.join(", ")}. ` +
        "Add them in your hosting provider's project settings and redeploy.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } },
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // restore the remembered date range on date-driven pages opened without one
  const q = request.nextUrl.searchParams;
  if (request.method === "GET" && RANGE_PATHS.has(path) && !q.has("range") && !q.has("start") && !q.has("end")) {
    const saved = savedRange(request.cookies.get(RANGE_COOKIE)?.value);
    if (saved) {
      const url = request.nextUrl.clone();
      saved.forEach((v, k) => url.searchParams.set(k, v));
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c)); // keep any refreshed auth cookies
      return redirect;
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
