import { ExternalLink } from "lucide-react";
import type { BizInfo } from "@/lib/google/gbp-view";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const hrs = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) + (m || 0) / 60; };

/** Opening hours as a week of bars on a 24-hour axis; each row prints its times, closed days say so. */
export function HoursChart({ hours }: { hours: { day: string; open: string; close: string }[] }) {
  return (
    <div>
      <p className="mb-2 font-medium">Opening hours</p>
      <ul className="space-y-1.5 text-xs" aria-label="Opening hours">
        {DAYS.map((d) => {
          const list = hours.filter((h) => h.day === d);
          return (
            <li key={d} className="grid grid-cols-[2.25rem_minmax(0,1fr)_7rem] items-center gap-2">
              <span className="text-muted">{d.charAt(0) + d.slice(1, 3).toLowerCase()}</span>
              <span className="relative h-2.5 rounded-full bg-surface-muted" aria-hidden>
                {list.map((h, i) => {
                  const a = hrs(h.open), b = hrs(h.close) || 24;
                  return <span key={i} className="absolute inset-y-0 rounded-full bg-series" style={{ left: `${(a / 24) * 100}%`, width: `${(Math.max(0, (b > a ? b : 24) - a) / 24) * 100}%` }} />;
                })}
              </span>
              <span className="text-right tabular-nums text-secondary">{list.length ? list.map((h) => `${h.open}–${h.close}`).join(", ") : "Closed"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The business information card: categories, contact details, description, service area, hours and completeness. */
export function BusinessInfo({ info }: { info: BizInfo }) {
  const rows: [string, React.ReactNode][] = ([
    ["Name", info.name], ["Primary category", info.primaryCategory],
    ["Secondary categories", info.additionalCategories.length ? info.additionalCategories.join(", ") : null],
    ["Phone", info.phone], ["Website", info.website], ["Address", info.address],
    ["Service area", info.serviceArea.length ? info.serviceArea.join("; ") : null],
    ["Status", info.status ? info.status.charAt(0) + info.status.slice(1).toLowerCase().replace(/_/g, " ") : null],
    ["Store code", info.storeCode], ["Labels", info.labels.length ? info.labels.join(", ") : null],
  ] as [string, React.ReactNode][]).filter(([, v]) => v);
  return (
    <section className="rounded-[10px] border border-border bg-surface p-4 text-sm" aria-label="Business information">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Business information</h2>
        <span className="text-xs text-muted">source: {info.source}{info.updatedAt ? ` · ${new Date(info.updatedAt).toLocaleDateString()}` : ""}</span>
      </div>
      {info.completeness && (
        <div className="mb-3">
          <div className="flex justify-between text-xs"><span className="font-medium">Profile completeness</span><span className="tabular-nums">{info.completeness.score}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden><div className="h-full rounded-full bg-series" style={{ width: `${info.completeness.score}%` }} /></div>
          {info.completeness.missing.length > 0 && <p className="mt-1 text-xs text-muted">Missing: {info.completeness.missing.join(", ")}</p>}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
            {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}
          </dl>
          {info.description && <p className="whitespace-pre-line text-secondary">{info.description}</p>}
          {info.mapsUri?.startsWith("https://") && (
            <a href={info.mapsUri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
              Open on Google Maps <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
        {info.hours.length > 0 && <HoursChart hours={info.hours} />}
      </div>
    </section>
  );
}
