"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { withParams, type SearchParams } from "@/lib/analytics/url";

/**
 * A labelled <select> that updates one URL search param. The navigation runs in a transition, so
 * the current data stays on screen (no flicker) and a small spinner shows until the new data lands.
 */
export function FilterSelect({
  label, name, value, options, path, sp, resetKeys = [],
}: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  path: string;
  sp: SearchParams;
  resetKeys?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="text-xs text-muted">
      <span className="flex items-center gap-1">
        {label}
        {pending && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
      </span>
      <select
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const href = withParams(path, sp, {
            [name]: e.target.value || null,
            ...Object.fromEntries(resetKeys.map((k) => [k, null])),
          });
          startTransition(() => router.push(href, { scroll: false }));
        }}
        className="mt-0.5 block min-w-36 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
