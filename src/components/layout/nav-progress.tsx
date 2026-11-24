"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Fire this before a programmatic navigation (router.push) so the progress bar shows for it too. */
export const NAV_START_EVENT = "seo-nav-start";
const here = () => `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;

/**
 * A thin bar at the top while an in-app navigation is loading. Route changes already show the page skeleton; this
 * covers navigations within the same page (date range, filters, tabs, pagination), which otherwise give no feedback
 * until the new data arrives. It disappears as soon as the URL changes (the new page is shown).
 */
export function NavProgress() {
  const path = usePathname();
  const sp = useSearchParams();
  const current = `${path}?${sp.toString()}`;
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    // capture phase: runs before next/link handles (and prevents) the click
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      const to = `${url.pathname}?${url.searchParams.toString()}`;
      const now = here();
      if (to !== now) setFrom(now);
    };
    const onStart = () => setFrom(here());
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAV_START_EVENT, onStart);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener(NAV_START_EVENT, onStart); };
  }, []);

  useEffect(() => {
    if (from === null) return;
    // safety net: a navigation that never completes (offline, cancelled) doesn't leave the bar running
    const t = setTimeout(() => setFrom(null), 20_000);
    return () => clearTimeout(t);
  }, [from]);

  // the new URL arrived: done (reset during render, so a later return to the old URL doesn't show it again)
  if (from !== null && from !== current) { setFrom(null); return null; }
  if (from === null) return null;
  return <div role="progressbar" aria-label="Loading" aria-busy="true" className="nav-progress" />;
}
