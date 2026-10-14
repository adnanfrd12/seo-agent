"use client";

import { useRouter } from "next/navigation";
import { withParams, type SearchParams } from "@/lib/analytics/url";

/** A labelled <select> that updates one URL search param on change (and resets the given pagers). */
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
  return (
    <label className="text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) =>
          router.push(
            withParams(path, sp, {
              [name]: e.target.value || null,
              ...Object.fromEntries(resetKeys.map((k) => [k, null])),
            }),
            { scroll: false },
          )
        }
        className="mt-0.5 block min-w-36 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
