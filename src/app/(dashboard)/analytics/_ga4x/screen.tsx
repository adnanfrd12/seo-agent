import Link from "next/link";
import { AiScreenTools } from "@/components/aiqw/screen-tools";
import { screenForPath } from "@/lib/aiqw/screens";
import { TabHeader } from "@/components/dashboard/tab-header";
import { EmptyState } from "@/components/dashboard/page-header";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { SyncButton } from "@/components/ga4x/info";
import { getSession } from "@/lib/analytics/client-context";
import { withParams, type SearchParams } from "@/lib/analytics/url";
import { ga4xPage, type Ga4xView } from "@/lib/ga4x/load";
import { shortDate } from "@/lib/ga4x/model";
import { cn } from "@/lib/utils";
import { syncGa4xNow } from "../ga4x-actions";

export type OkView = Extract<Ga4xView, { state: "ok" }>;

const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60_000); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

/**
 * The frame of every GA4 leads screen: title, period, property, qualified/all leads switch and Sync now.
 * Shows a clear empty state when GA4 isn't connected.
 */
export async function Ga4xScreen({ sp, path, title, description, users, children }: {
  sp: SearchParams; path: string; title: string; description: string; users?: boolean;
  children: (v: OkView) => React.ReactNode | Promise<React.ReactNode>;
}) {
  const v = await ga4xPage(sp, { users });
  if (!v) return null;
  const { client } = await getSession();
  const canEdit = !!client && ["owner", "admin"].includes(client.role);
  if (v.state !== "ok") {
    return (
      <>
        <TabHeader source="ga4" title={title} description={description} />
        <EmptyState title={v.state === "no_ga4" ? "Google Analytics isn't connected" : v.state === "not_connected" ? "The GA4 connection needs attention" : "GA4 couldn't be read"}
          body={v.state === "no_ga4" ? `Connect Google Analytics 4 for ${v.clientName} on the Integrations page and pick its property; this screen fills in on the first visit after that.`
            : v.state === "not_connected" ? `${v.property ?? "The property"} is selected but its Google connection isn't active. Reconnect Google Analytics on the Integrations page.`
            : `${v.message} Try Sync now in a few minutes; if it keeps failing, reconnect Google Analytics on the Integrations page.`}
          action={{ href: "/integrations", label: "Open Integrations" }} />
      </>
    );
  }
  const { g, period, qualified } = v;
  const props = v.propertyChoices.length > 1 ? [{ value: "", label: "Best match" }, ...v.propertyChoices.map((c) => ({ value: c.id, label: c.name }))] : null;
  return (
    <>
      <TabHeader source="ga4" eyebrow="Google Analytics 4" title={title} description={description}
        actions={canEdit ? <SyncButton action={syncGa4xNow} /> : undefined} />
      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md border border-border bg-surface px-2 py-1 font-medium">{g.meta.propertyName ?? "GA4 property"}</span>
        <span className="rounded-md border border-border bg-surface px-2 py-1 text-secondary">{shortDate(period.start)} – {shortDate(period.end)} vs {shortDate(period.pstart)} – {shortDate(period.pend)}</span>
        <span className="rounded-md border border-border bg-surface px-2 py-1 text-secondary" title={`Stored ${g.meta.start} to ${g.meta.end}`}>Synced {ago(g.meta.fetchedAt)} · data to {shortDate(g.meta.end)}</span>
        <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Which leads to count">
          <Link href={withParams(path, sp, { leads: null })} aria-current={qualified ? "true" : undefined} className={cn("px-2 py-1", qualified ? "bg-foreground text-background" : "bg-surface text-secondary hover:bg-surface-muted")} title="Leads from bot-like traffic (day × country × browser slices with many visits and almost no engagement) are left out. Visit counts are always GA4’s own.">Qualified leads</Link>
          <Link href={withParams(path, sp, { leads: "all" })} aria-current={!qualified ? "true" : undefined} className={cn("px-2 py-1", !qualified ? "bg-foreground text-background" : "bg-surface text-secondary hover:bg-surface-muted")}>All leads</Link>
        </span>
        {g.botSlices.size > 0 && <span className="rounded-md bg-warn-soft px-2 py-1 text-warn">{g.botSlices.size} bot-like slice{g.botSlices.size > 1 ? "s" : ""}: their leads {qualified ? "left out" : "counted"} (visits always match GA4)</span>}
        {g.users?.error && <span className="rounded-md bg-negative-soft px-2 py-1 text-negative" title={g.users.error}>User counts couldn&apos;t be read</span>}
        {props && <div className="ml-auto"><FilterSelect label="Property" name="property" value={typeof sp.property === "string" ? sp.property : ""} options={props} path={path} sp={sp} /></div>}
      </div>
      {Object.keys(g.meta.errors).length > 0 && (
        <p className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">Some GA4 reports failed on the last sync and show as empty: {Object.entries(g.meta.errors).map(([k, e]) => `${k} (${e.slice(0, 90)})`).join("; ")}.</p>
      )}
      {await children(v)}
      <AiScreenTools screen={screenForPath(path)} />
    </>
  );
}
