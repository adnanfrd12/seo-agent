/**
 * Page keys shared by the Clarity page, its client components and the sync: a page is its path
 * without query or hash, so ad-click variants (?gclid=...) of one page count as that page.
 */
export function pagePath(u: string | null | undefined): string {
  if (!u) return "(unknown page)";
  try { return new URL(u).pathname || "/"; } catch { return u.split(/[?#]/)[0] || "/"; }
}
