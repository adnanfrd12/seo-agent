import { PlayCircle } from "lucide-react";
import type { IssueKey, Recording, RecordingSet } from "@/lib/clarity/recordings";
import { CopyBrief } from "./copy-brief";

export interface IssueSummary { key: IssueKey; label: string; pct: number | null; count: number | null; why: string; fix: string }

const path = (u: string | null) => { if (!u) return "(unknown page)"; try { const x = new URL(u); return `${x.pathname}${x.search}` || "/"; } catch { return u; } };

export interface BriefError { message: string; count: number; pages: string[] }

function brief(site: string, issues: (IssueSummary & { recs: Recording[] })[], errors: BriefError[]): string {
  const lines = [`Website issues found by Microsoft Clarity — ${site}`, ""];
  for (const i of issues) {
    lines.push(`${i.label}${i.pct != null ? ` — ${i.pct.toFixed(1)}% of sessions` : ""}`, `What it means: ${i.why}`, `Suggested fix: ${i.fix}`, "Recordings:");
    for (const r of i.recs) lines.push(`- ${path(r.url)} (${r.at ?? "?"} UTC, ${r.duration ?? "?"}${r.lcp ? `, load LCP ${r.lcp}` : ""}): ${r.link}`);
    lines.push("");
  }
  if (errors.length) {
    lines.push("JavaScript error messages (last 3 days, from Clarity; no file/line/stack is available there):");
    for (const e of errors) lines.push(`- "${e.message}" ×${e.count} on ${e.pages.slice(0, 8).join(", ")}${e.pages.length > 8 ? ", …" : ""}`);
    lines.push("");
  }
  lines.push("Recordings open in Clarity's player (sign in with an account that has access to the project).");
  return lines.join("\n");
}

/**
 * Under the alerts: for each Clarity issue, the session recordings that show it happening, so the
 * customer can see what's going on and the brief can be passed to the web design team.
 */
export function IssueRecordings({ set, issues, site, errors = [] }: { set: RecordingSet | null; issues: IssueSummary[]; site: string; errors?: BriefError[] }) {
  const withRecs = issues.map((i) => ({ ...i, recs: set?.issues[i.key] ?? [] }))
    .filter((i) => i.recs.length || (i.count ?? 0) > 0)
    .sort((a, b) => Number(b.recs.length > 0) - Number(a.recs.length > 0) || (b.pct ?? 0) - (a.pct ?? 0));
  if (!withRecs.length && !set?.error) return null;

  return (
    <section aria-label="Issue recordings" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Recordings of each issue</h2>
          <p className="text-sm text-muted">
            Visitor sessions from the last 3 days{set ? ` · pulled ${new Date(set.fetchedAt).toLocaleString()}` : ""}
          </p>
        </div>
        {withRecs.some((i) => i.recs.length) && <CopyBrief text={brief(site, withRecs.filter((i) => i.recs.length), errors)} />}
      </div>
      {set?.error && !withRecs.some((i) => i.recs.length) && (
        <p className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Recordings couldn’t be pulled: {set.error}</p>
      )}
      {!set && <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">Recordings are pulled with the next daily Clarity sync.</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {withRecs.map((i) => (
          <article key={i.key} className="min-w-0 rounded-[10px] border border-border bg-surface">
            <header className="border-b border-hairline px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{i.label}</h3>
                {i.pct != null && <span className="text-xs tabular-nums text-muted">{i.pct.toFixed(1)}% of sessions</span>}
              </div>
              <p className="mt-1 text-[13px] text-secondary">{i.why}</p>
              <p className="mt-1 text-[13px]"><span className="font-medium">Fix: </span>{i.fix}</p>
            </header>
            {i.recs.length ? (
              <ul className="divide-y divide-hairline">
                {i.recs.slice(0, 6).map((r) => (
                  <li key={r.link} className="flex items-start gap-3 px-4 py-2.5">
                    <a href={r.link} target="_blank" rel="noopener noreferrer" aria-label={`Watch recording of ${path(r.url)}`}
                      className="mt-0.5 shrink-0 text-foreground hover:text-accent"><PlayCircle className="size-5" aria-hidden /></a>
                    <div className="min-w-0 flex-1">
                      <a href={r.link} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:underline" title={r.url ?? undefined}>{path(r.url)}</a>
                      <p className="text-xs text-muted">
                        {[r.at && `${r.at} UTC`, r.duration, r.pages != null && `${r.pages} page${r.pages === 1 ? "" : "s"}`, r.clicks != null && `${r.clicks} clicks`, r.lcp && `LCP ${r.lcp}`].filter(Boolean).join(" · ")}
                      </p>
                      {r.events.length > 0 && <p className="mt-0.5 truncate text-xs text-secondary" title={r.events.join(" · ")}>{r.events.join(" · ")}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">No recording of this in the last 3 days.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
