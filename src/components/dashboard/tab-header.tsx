import Link from "next/link";
import { BookOpen } from "lucide-react";
import { getSession } from "@/lib/analytics/client-context";
import { getDataStatus, type SourceStatus } from "@/lib/overview/status";
import { cn } from "@/lib/utils";

export type TabSource = "ga4" | "gsc" | "gbp" | "bing" | "clarity" | "dfs" | null;
const EYEBROW: Record<Exclude<TabSource, null>, string> = {
  ga4: "Google Analytics 4", gsc: "Search Console", gbp: "Google Business Profile", bing: "Bing Webmaster Tools", clarity: "Microsoft Clarity", dfs: "DataForSEO",
};
const DOT = { ok: "bg-positive", stale: "bg-warn", error: "bg-negative", pending: "bg-muted" } as const;

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
  const src = eyebrow ?? (source ? EYEBROW[source] : null);
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">{title}</h1>
            {status ? (
              <span title={[src, status.note, `Next automatic update ${when(status.nextAt)}`].filter(Boolean).join(" · ")}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-secondary">
                <span className={cn("size-1.5 rounded-full", DOT[status.health])} aria-hidden />
                {src && <span className="font-medium text-foreground">{src}</span>}
                <span className={status.health === "error" ? "text-negative" : undefined}>
                  {status.health === "error" ? "needs attention" : status.health === "pending" ? "waiting for the first sync" : `updated ${ago(status.lastSyncedAt)}`}
                </span>
              </span>
            ) : src ? (
              <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-secondary">{src}</span>
            ) : null}
            {status && <span className="text-xs text-muted">Next update {when(status.nextAt)}{status.note ? ` · ${status.note}` : ""}</span>}
          </div>
          {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-secondary">{description}</p>}
          {status?.error && <Link href="/integrations" className="mt-1.5 inline-block text-xs text-negative underline underline-offset-2">{status.error.slice(0, 120)}</Link>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {guide && guide.length > 0 && (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[13px] text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <BookOpen className="size-3.5" aria-hidden /> What these numbers mean
          </summary>
          <dl className="mt-2 grid gap-x-8 gap-y-3 rounded-lg border border-border bg-surface p-4 text-[13px] sm:grid-cols-2">
            {guide.map((g) => (
              <div key={g.term}><dt className="font-medium">{g.term}</dt><dd className="mt-0.5 leading-relaxed text-secondary">{g.text}</dd></div>
            ))}
          </dl>
        </details>
      )}
    </header>
  );
}
