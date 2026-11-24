import Link from "next/link";
import { AiScreenTools } from "@/components/aiqw/screen-tools";
import { screenForPath } from "@/lib/aiqw/screens";
import { TabHeader } from "@/components/dashboard/tab-header";
import { EmptyState } from "@/components/dashboard/page-header";
import { SyncButton } from "@/components/ga4x/info";
import { getSession } from "@/lib/analytics/client-context";
import { withParams, type SearchParams } from "@/lib/analytics/url";
import { gscPage, TYPES, type GscView } from "@/lib/gscx/load";
import { cn } from "@/lib/utils";
import { syncGscxNow } from "../gscx-actions";

export type OkGsc = Extract<GscView, { state: "ok" }>;
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60_000); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const sd = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The frame of every Search Console screen: title, period, search type, provisional badge and Sync now. */
export async function GscScreen({ sp, path, title, description, types = false, children }: {
  sp: SearchParams; path: string; title: string; description: string; types?: boolean;
  children: (v: OkGsc) => React.ReactNode | Promise<React.ReactNode>;
}) {
  const v = await gscPage(sp);
  if (!v) return null;
  const { client } = await getSession();
  const canEdit = !!client && ["owner", "admin"].includes(client.role);
  if (v.state !== "ok") {
    return (
      <>
        <TabHeader source="gsc" title={title} description={description} />
        <EmptyState title={v.state === "no_gsc" ? "Search Console isn't connected" : v.state === "not_connected" ? "The Search Console connection needs attention" : "Search Console couldn't be read"}
          body={v.state === "no_gsc" ? `Connect Google Search Console for ${v.clientName} on the Integrations page and pick the site; this screen fills in on the first visit after that.`
            : v.state === "not_connected" ? `${v.property ?? "The site"} is selected but its Google connection isn't active. Reconnect Search Console on the Integrations page.`
            : `${v.message} Try Sync now in a few minutes; if it keeps failing, reconnect Search Console on the Integrations page.`}
          action={{ href: "/integrations", label: "Open Integrations" }} />
      </>
    );
  }
  const { g, period } = v;
  const provisional = g.meta.provisionalFrom && period.end >= g.meta.provisionalFrom;
  return (
    <>
      <TabHeader source="gsc" eyebrow="Search Console" title={title} description={description} actions={canEdit ? <SyncButton action={syncGscxNow} /> : undefined} />
      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md border border-border bg-surface px-2 py-1 font-medium">{g.meta.site.replace(/^sc-domain:/, "")}</span>
        <span className="rounded-md border border-border bg-surface px-2 py-1 text-secondary">{sd(period.start)} – {sd(period.end)} vs {sd(period.pstart)} – {sd(period.pend)}</span>
        <span className="rounded-md border border-border bg-surface px-2 py-1 text-secondary" title="Search Console data is 2–3 days behind; it is never live.">Synced {ago(g.meta.fetchedAt)} · latest day {sd(g.meta.end)}</span>
        {provisional && <span className="rounded-md bg-warn-soft px-2 py-1 text-warn" title="The newest 2–3 days can still change.">Includes provisional days (from {sd(g.meta.provisionalFrom!)})</span>}
        {types && (
          <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Search type">
            {TYPES.map(([k, l]) => {
              const has = g.meta.types.includes(k);
              return <Link key={k} href={withParams(path, sp, { type: k === "web" ? null : k })} aria-current={g.type === k ? "true" : undefined} title={has ? undefined : `No ${l} results for this site in the last 16 months`}
                className={cn("px-2 py-1", g.type === k ? "bg-foreground text-background" : has ? "bg-surface text-secondary hover:bg-surface-muted" : "bg-surface text-faint")}>{l}</Link>;
            })}
          </span>
        )}
      </div>
      {Object.keys(g.meta.errors).length > 0 && <p className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">Some Search Console reports failed on the last sync: {Object.entries(g.meta.errors).map(([k, e]) => `${k} (${e.slice(0, 90)})`).join("; ")}.</p>}
      {await children(v)}
      <AiScreenTools screen={screenForPath(path)} />
    </>
  );
}
