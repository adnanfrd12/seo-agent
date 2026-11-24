import { fmtInt } from "@/lib/analytics/format";

type Split = { mobile_maps: number; desktop_maps: number; mobile_search: number; desktop_search: number };

const MAPS = "var(--cat-1)";
const SEARCH = "var(--cat-3)";
const light = (c: string) => `color-mix(in oklab, ${c} 42%, transparent)`;

/**
 * Where the profile was seen: one 100% bar split into Maps and Search on mobile and desktop, then each
 * surface with its own mobile / desktop rows. Every number and share is printed, so colour is never the only cue.
 */
export function ViewsByWhere({ split }: { split: Split }) {
  const total = split.mobile_maps + split.desktop_maps + split.mobile_search + split.desktop_search;
  const share = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : "—");
  const segments = [
    { label: "Maps, mobile", value: split.mobile_maps, color: MAPS },
    { label: "Maps, desktop", value: split.desktop_maps, color: light(MAPS) },
    { label: "Search, mobile", value: split.mobile_search, color: SEARCH },
    { label: "Search, desktop", value: split.desktop_search, color: light(SEARCH) },
  ];
  const groups = [
    { name: "Maps", color: MAPS, rows: [["Mobile", split.mobile_maps], ["Desktop", split.desktop_maps]] as const },
    { name: "Search", color: SEARCH, rows: [["Mobile", split.mobile_search], ["Desktop", split.desktop_search]] as const },
  ];

  return (
    <section aria-label="Views by where" className="flex min-w-0 flex-col rounded-[10px] border border-border bg-surface">
      <header className="flex items-start justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <div>
          <h3 className="text-[15px] font-semibold">Views by where</h3>
          <p className="mt-0.5 text-xs text-muted">Google Maps or Google Search, on a phone or a computer</p>
        </div>
        <p className="text-right"><span className="block text-xl font-semibold leading-none tabular-nums">{fmtInt(total)}</span><span className="text-[11px] text-muted">total views</span></p>
      </header>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4 sm:px-5">
        {total === 0 ? <p className="py-6 text-center text-sm text-muted">No views in this period.</p> : (
          <>
            <div>
              <div className="flex h-3 gap-[2px]" role="img" aria-label={segments.map((s) => `${s.label} ${fmtInt(s.value)} (${share(s.value)})`).join(", ")}>
                {segments.map((s) => s.value > 0 && (
                  <span key={s.label} title={`${s.label}: ${fmtInt(s.value)} (${share(s.value)})`} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flexGrow: s.value, flexBasis: 0, background: s.color }} />
                ))}
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
                {segments.map((s) => <li key={s.label} className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />{s.label}</li>)}
              </ul>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {groups.map((g) => {
                const sum = g.rows[0][1] + g.rows[1][1];
                return (
                  <div key={g.name}>
                    <p className="flex items-baseline justify-between border-b border-hairline pb-1.5 text-sm font-semibold">
                      {g.name}<span className="flex gap-3 tabular-nums"><span>{fmtInt(sum)}</span><span className="w-9 text-right font-normal text-muted">{share(sum)}</span></span>
                    </p>
                    <ul className="mt-2 space-y-2 text-[13px]">
                      {g.rows.map(([label, v], i) => (
                        <li key={label} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto_2.25rem] items-center gap-3">
                          <span className="text-secondary">{label}</span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                            <span className="block h-full rounded-full" style={{ width: `${sum ? (v / sum) * 100 : 0}%`, background: i ? light(g.color) : g.color }} />
                          </span>
                          <span className="text-right tabular-nums">{fmtInt(v)}</span>
                          <span className="text-right tabular-nums text-muted">{share(v)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
