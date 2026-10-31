import { Search, X } from "lucide-react";
import Link from "next/link";
import { first, withParams, type SearchParams } from "@/lib/analytics/url";

/** GET-form text filter for one URL param; keeps every other param, resets the table's pager. */
export function SearchBox({
  path, sp, name, placeholder, resetKey, label,
}: { path: string; sp: SearchParams; name: string; placeholder: string; resetKey: string; label: string }) {
  const current = first(sp[name]) ?? "";
  return (
    <form action={path} method="get" role="search" className="relative flex items-center">
      {Object.entries(sp).flatMap(([k, v]) =>
        k === name || k === resetKey || first(v) === undefined
          ? []
          : [<input key={k} type="hidden" name={k} value={first(v)} />],
      )}
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint" aria-hidden />
      <input
        type="search" name={name} defaultValue={current} placeholder={placeholder} aria-label={label} maxLength={200}
        className="h-8 w-56 rounded-md border border-border-strong bg-surface pl-8 pr-7 text-[13px] outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent"
      />
      {current && (
        <Link
          href={withParams(path, sp, { [name]: null, [resetKey]: null })} aria-label={`Clear ${label}`}
          className="absolute right-1.5 rounded p-0.5 text-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </Link>
      )}
    </form>
  );
}
