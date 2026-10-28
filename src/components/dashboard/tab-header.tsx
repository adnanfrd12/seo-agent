import Link from "next/link";
import { BookOpen } from "lucide-react";
import { getSession } from "@/lib/analytics/client-context";
import { getDataStatus, type SourceStatus } from "@/lib/overview/status";
import { cn } from "@/lib/utils";

export type TabSource = "ga4" | "gsc" | "gbp" | "bing" | "clarity" | "dfs" | null;
const EYEBROW: Record<Exclude<TabSource, null>, string> = {
  ga4: "Google Analytics 4", gsc: "Search Console", gbp: "Google Business Profile", bing: "Bing Webmaster Tools", clarity: "Microsoft Clarity", dfs: "DataForSEO",
};
const DOT = { ok: "bg-positive", stale: "bg-[#D4970A]", error: "bg-negative", pending: "bg-muted" } as const;

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }) : "—");

function pickStatus(all: SourceStatus[], source: TabSource): SourceStatus | undefined {
  if (!source) return undefined;
  if (source === "gbp") return all.find((s) => s.key === "lbm") ?? all.find((s) => s.key === "gbp");
  return all.find((s) => s.key === source);
}

/**
 * The top of every analytics tab: what the tab is for, when its data was last updated and when the
 * next automatic update is due (so a provider's delay is never mistaken for a fault), plus an optional
 * plain-language guide to the metrics on the page.
 */
export async function TabHeader({ source, eyebrow, title, description, actions, guide }: {
  source: TabSource; eyebrow?: string; title: string; description?: string; actions?: React.ReactNode;
  guide?: { term: string; text: string }[];
}) {
  let status: SourceStatus | undefined;
  if (source) {
    try {
      const { client } = await getSession();
      if (client) status = pickStatus(await getDataStatus(client.id), source);
    } catch { /* freshness is a nicety; never break the page for it */ }
  }
  return (
    <header className="rise mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 border-l-4 border-accent pl-4">
          {(eyebrow ?? (source ? EYEBROW[source] : null)) && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow ?? EYEBROW[source!]}</p>}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      {status && (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" title={status.note}>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", DOT[status.health])} aria-hidden />
            <span className={cn("font-medium", status.health === "error" ? "text-negative" : "text-foreground")}>
              {status.health === "error" ? "Needs attention" : status.health === "pending" ? "Waiting for the first sync" : `Updated ${ago(status.lastSyncedAt)}`}
            </span>
          </span>
          <span>Next automatic update {when(status.nextAt)}</span>
          <span>{status.note}</span>
          {status.error && <Link href="/integrations" className="text-negative underline">{status.error.slice(0, 90)}</Link>}
        </p>
      )}

      {guide && guide.length > 0 && (
        <details className="group mt-3 rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-accent">
            <BookOpen className="size-4" aria-hidden /> What do these numbers mean?
          </summary>
          <dl className="grid gap-x-8 gap-y-3 border-t border-border px-4 py-3 text-sm sm:grid-cols-2">
            {guide.map((g) => (
              <div key={g.term}><dt className="font-semibold">{g.term}</dt><dd className="text-muted">{g.text}</dd></div>
            ))}
          </dl>
        </details>
      )}
    </header>
  );
}
