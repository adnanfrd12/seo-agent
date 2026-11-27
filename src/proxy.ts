import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isRangePath } from "@/lib/analytics/range-paths";

/** Same name as PATH_HEADER in lib/analytics/client-context.ts (not imported: that module is server-only). */
const PATH_HEADER = "x-sa-path";

// /invite: invitation links must open signed out (the page itself checks the token); /api/org/branding: public
// logo/name/colours for a branded login page (no private fields)
const PUBLIC_PREFIXES = ["/login", "/auth", "/api/cron", "/privacy", "/terms", "/data-deletion", "/platforms", "/api/platform-webhooks", "/invite", "/api/org/branding"];
/** public without a login: the homepage, crawler files and the legal aliases below */
const PUBLIC_EXACT = new Set(["/", "/robots.txt", "/sitemap.xml"]);
/** old or common legal URLs, permanently (301) redirected to the current pages */
const LEGAL_REDIRECTS: Record<string, string> = {
  "/privacy-policy": "/privacy",
  "/terms-of-service": "/terms",
  "/terms-and-conditions": "/terms",
  "/delete-data": "/data-deletion",
  "/permissions": "/platforms",
  "/integrations/permissions": "/platforms",
};
// date-driven pages (isRangePath): opened without a range they get the one the user last picked (cookie written by RangeMemory)
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
  const alias = LEGAL_REDIRECTS[request.nextUrl.pathname.replace(/\/+$/, "") || "/"];
  if (alias) {
    const url = request.nextUrl.clone();
    url.pathname = alias;
    return NextResponse.redirect(url, 301);
  }

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

  // the path being rendered, for the page-access check of getSession() (layouts don't re-render on soft
  // navigations, pages do). Always overwritten here, so a value sent by the browser is never trusted.
  const path0 = request.nextUrl.pathname;
  request.headers.set(PATH_HEADER, path0);

  // public pages (login, legal, homepage, webhooks, cron) need no session: skip the Supabase check entirely so
  // they're served without an extra round trip (the session is refreshed on the next dashboard request)
  if (PUBLIC_EXACT.has(path0) || PUBLIC_PREFIXES.some((p) => path0 === p || path0.startsWith(`${p}/`))) return NextResponse.next({ request });

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
  const isPublic = PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // restore the remembered date range on date-driven pages opened without one
  const q = request.nextUrl.searchParams;
  if (request.method === "GET" && isRangePath(path) && !q.has("range") && !q.has("start") && !q.has("end")) {
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
