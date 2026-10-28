"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export const RANGE_COOKIE = "seo_range";

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
    } catch { /* cookies blocked: the page still works, it just won't remember */ }
  }, [sp]);
  return null;
}
