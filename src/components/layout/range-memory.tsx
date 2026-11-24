"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export const RANGE_COOKIE = "seo_range";
/** Fired after the cookie changes, so the sidebar's links follow the newly picked range at once. */
export const RANGE_EVENT = "seo-range-change";

/** The remembered range as query parameters, validated like the proxy does (empty when there is none). */
export function savedRangeQuery(cookie: string): string {
  const m = cookie.match(new RegExp(`(?:^|; )${RANGE_COOKIE}=([^;]*)`));
  if (!m) return "";
  try {
    const p = new URLSearchParams(decodeURIComponent(m[1]));
    const out = new URLSearchParams();
    const range = p.get("range"), start = p.get("start"), end = p.get("end");
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (range && ["7", "30", "90", "month"].includes(range)) out.set("range", range);
    else if (start && end && iso.test(start) && iso.test(end) && start <= end) { out.set("start", start); out.set("end", end); }
    else return "";
    if (p.get("compare") === "1") out.set("compare", "1");
    return out.toString();
  } catch { return ""; }
}

/**
 * Remembers the date range the user last picked (and the compare toggle) in a cookie, so the next
 * visit to any date-driven page, even from the sidebar, opens on the same period. The proxy reads the
 * cookie; this component only ever writes it when the URL actually carries a range.
 */
export function RangeMemory() {
  const sp = useSearchParams();
  useEffect(() => {
    const range = sp.get("range"), start = sp.get("start"), end = sp.get("end");
    if (!range && !(start && end)) return;
    const saved = new URLSearchParams();
    if (range) saved.set("range", range); else { saved.set("start", start!); saved.set("end", end!); }
    if (sp.get("compare") === "1") saved.set("compare", "1");
    try {
      document.cookie = `${RANGE_COOKIE}=${encodeURIComponent(saved.toString())}; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
      window.dispatchEvent(new Event(RANGE_EVENT));
    } catch { /* cookies blocked: the page still works, it just won't remember */ }
  }, [sp]);
  return null;
}
