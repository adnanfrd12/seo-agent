"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** RE2 check in the browser (Search Console's regex engine has no lookarounds or backreferences). */
function re2Error(rx: string): string | null {
  if (rx.length > 4096) return "Longer than 4,096 characters.";
  if (/\(\?[=!<]/.test(rx)) return "Lookaheads and lookbehinds aren't supported in RE2.";
  if (/\[1-9]/.test(rx)) return "Backreferences aren't supported in RE2.";
  try { new RegExp(rx, "i"); return null; } catch (e) { return e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : "Invalid pattern."; }
}

/** Free-text regex that filters the screen as you type (debounced), with an error for invalid patterns. */
export function RegexBox({ value, hrefFor }: { value: string; hrefFor: Record<string, string> & { base: string } }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  const err = v ? re2Error(v) : null;
  useEffect(() => {
    if (v === value || err) return;
    const t = setTimeout(() => start(() => router.replace(`${hrefFor.base}${hrefFor.base.includes("?") ? "&" : "?"}${v ? `rx=${encodeURIComponent(v)}` : ""}`, { scroll: false })), 450);
    return () => clearTimeout(t);
  }, [v, value, err, hrefFor.base, router]);
  return (
    <div className="min-w-0 flex-1">
      <label className="text-xs font-medium text-muted">Regex (RE2, case-insensitive)
        <div className="mt-1 flex items-center gap-2">
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. \b(cost|price)\b|^how" spellCheck={false}
            className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-sm text-foreground" aria-invalid={!!err} />
          {pending && <Loader2 className="size-4 animate-spin" aria-label="Filtering" />}
        </div>
      </label>
      {err && <p role="alert" className="mt-1 text-xs text-negative">{err}</p>}
    </div>
  );
}
