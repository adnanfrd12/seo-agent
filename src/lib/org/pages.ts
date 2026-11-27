import { NAV, type NavGroup, type NavItem } from "@/lib/analytics/nav";

/**
 * Page access per organization ("plan"): platform super-admins choose which dashboard pages an organization may
 * use (organizations.enabled_pages, null = every page including pages added later). Pages are the sidebar's hrefs
 * (src/lib/analytics/nav.ts), items and sub-tabs alike. Pure functions: the server guard and the sidebar filter
 * both use them.
 *
 * Matching: a path is governed by the most specific sidebar href it falls under (the href itself or a sub-path), so
 * turning off a sub-tab blocks that tab and its sub-pages while the rest of the section stays open. Paths outside
 * the sidebar (reports, APIs, public pages) aren't gated here. Settings (including the user's own profile),
 * Integrations, invitations and sign-in are always allowed.
 */
export const ALWAYS_ALLOWED = ["/settings", "/integrations", "/invite", "/login", "/auth"];

const clean = (p: string) => p.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Every page href in the sidebar (items and sub-tabs), most specific first. */
export function navHrefs(nav: NavGroup[] = NAV): string[] {
  const set = new Set<string>();
  for (const g of nav) for (const i of g.items) { set.add(i.href); for (const c of i.children ?? []) set.add(c.href); }
  return [...set].sort((a, b) => b.length - a.length);
}
const DEFAULT_HREFS = navHrefs(NAV);

export const isAlwaysAllowed = (path: string) => ALWAYS_ALLOWED.some((a) => under(clean(path), a));

/** Whether an organization with these enabled pages may open `pathname` (null or undefined = every page). */
export function pageAllowed(enabledPages: readonly string[] | null | undefined, pathname: string, nav: NavGroup[] = NAV): boolean {
  if (!enabledPages) return true;
  const path = clean(pathname);
  if (isAlwaysAllowed(path)) return true;
  const href = (nav === NAV ? DEFAULT_HREFS : navHrefs(nav)).find((h) => under(path, h));
  return href === undefined || enabledPages.includes(href);
}

/**
 * The sidebar without the pages an organization can't use. A section keeps the sub-tabs that are allowed (its link
 * moves to the first allowed one when its own page is off, and a sub-tab heading carries over to the next kept
 * sub-tab); sections and groups left empty disappear.
 */
export function filterNav(nav: NavGroup[], enabledPages: readonly string[] | null | undefined): NavGroup[] {
  if (!enabledPages) return nav;
  const ok = (href: string) => pageAllowed(enabledPages, href, nav);
  const item = (i: NavItem): NavItem[] => {
    if (!i.children?.length) return ok(i.href) ? [i] : [];
    const kept: NonNullable<NavItem["children"]> = [];
    let heading: string | undefined;
    for (const c of i.children) {
      if (c.group) heading = c.group;
      if (!ok(c.href)) continue;
      kept.push(heading && !c.group ? { ...c, group: heading } : c);
      heading = undefined;
    }
    if (!kept.length) return ok(i.href) ? [{ ...i, children: undefined }] : [];
    return [{ ...i, href: ok(i.href) ? i.href : kept[0].href, children: kept }];
  };
  return nav.map((g) => ({ ...g, items: g.items.flatMap(item) })).filter((g) => g.items.length > 0);
}

/** Where to send someone whose page is turned off: the first allowed sidebar page (Settings when none is). */
export function firstAllowedHref(enabledPages: readonly string[] | null | undefined, nav: NavGroup[] = NAV): string {
  for (const g of filterNav(nav, enabledPages)) for (const i of g.items) if (!isAlwaysAllowed(i.href)) return i.href;
  return "/settings";
}

/**
 * The checklist the platform page shows: every page that can be turned off, grouped like the sidebar. A section's
 * own page is listed with its sub-tabs (it usually is the first sub-tab already).
 */
export interface PageOption { href: string; label: string; section?: string }
export function pageOptions(nav: NavGroup[] = NAV): { group: string; sections: { label: string; pages: PageOption[] }[] }[] {
  return nav.map((g) => ({
    group: g.title,
    sections: g.items.filter((i) => !isAlwaysAllowed(i.href)).map((i) => {
      const pages: PageOption[] = (i.children ?? []).map((c) => ({ href: c.href, label: c.label, section: i.label }));
      if (!pages.some((p) => p.href === i.href)) pages.unshift({ href: i.href, label: i.label });
      return { label: i.label, pages };
    }),
  })).filter((g) => g.sections.length > 0);
}

/** Cleans a submitted list: known, gate-able hrefs only, in sidebar order, no duplicates. */
export function normalizeEnabledPages(hrefs: readonly string[], nav: NavGroup[] = NAV): string[] {
  const wanted = new Set(hrefs);
  const out: string[] = [];
  for (const g of pageOptions(nav)) for (const s of g.sections) for (const p of s.pages) if (wanted.has(p.href) && !out.includes(p.href)) out.push(p.href);
  return out;
}
