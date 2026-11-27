"use client";

import { useEffect } from "react";

const ICON_LINKS = 'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]';

/** Points every tab icon link at `href`, remembering the defaults; null puts the defaults back. */
function apply(href: string | null) {
  document.head.querySelectorAll<HTMLLinkElement>(ICON_LINKS).forEach((link) => {
    const saved = link.dataset.brandDefault;
    if (href) {
      if (saved === undefined) {
        link.dataset.brandDefault = JSON.stringify({ href: link.getAttribute("href"), type: link.getAttribute("type"), sizes: link.getAttribute("sizes") });
      }
      if (link.getAttribute("href") !== href) link.setAttribute("href", href);
      link.removeAttribute("type");
      link.removeAttribute("sizes");
    } else if (saved !== undefined) {
      try {
        const d = JSON.parse(saved) as Record<"href" | "type" | "sizes", string | null>;
        for (const k of ["href", "type", "sizes"] as const) { if (d[k] == null) link.removeAttribute(k); else link.setAttribute(k, d[k]); }
      } catch { /* leave it */ }
      delete link.dataset.brandDefault;
    }
  });
}

/**
 * Shows an organization's favicon in the browser tab. The page metadata already lists it; this makes it the only
 * candidate, because browsers otherwise may keep the app's default favicon.ico. null = the default icons.
 */
export function useBrandFavicon(href: string | null) {
  useEffect(() => {
    if (!href) return;
    apply(href);
    // the metadata can be re-rendered on navigation: keep the icon when links are added
    const observer = new MutationObserver(() => apply(href));
    observer.observe(document.head, { childList: true });
    return () => { observer.disconnect(); apply(null); };
  }, [href]);
}
