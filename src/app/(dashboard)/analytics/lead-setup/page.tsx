import { ColChart, Gauge, Treemap } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { CopyButton, DownloadButton, LeadTypeSelect, ServiceAreaForm } from "@/components/ga4x/info";
import { Tag } from "@/components/ga4x/table";
import { Band, Card, Grid, Note, ScreenTasks } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import type { SearchParams } from "@/lib/analytics/url";
import { group, LEAD_TYPES, sum } from "@/lib/ga4x/model";
import { gtagSnippet, gtmContainer, type GapTag } from "@/lib/ga4x/gtm";
import { forScreen } from "@/lib/ga4x/quickwins";
import { cn } from "@/lib/utils";
import { setLeadType, setServiceArea } from "../ga4x-actions";
import { Ga4xScreen } from "../_ga4x/screen";
import { eventColor, labels, plainEvent } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/lead-setup";

export default async function LeadSetupPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { client } = await getSession();
  const canEdit = !!client && ["owner", "admin"].includes(client.role);
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Lead setup" description="Which GA4 events count as leads, which lead actions on the website aren't tracked yet, and how the GA4 property is set up.">
      {({ g, wins, areaSource }) => {
        const evCur = g.events.filter((x) => g.inCur(x));
        const counts = new Map([...group(evCur, (x) => String(x.eventName))].map(([k, v]) => [k, sum(v, (x) => Number(x.eventCount))]));
        for (const f of g.meta.fallbacks) counts.set(f, sum(g.L.filter((x) => g.inCur(x) && x.eventName === f), (x) => Number(x.eventCount)));
        const rows = g.map.map((m) => ({ ...m, n: counts.get(m.event) ?? 0 })).sort((a, b) => Number(b.counts) - Number(a.counts) || b.n - a.n);
        const mxN = Math.max(1, ...rows.map((r) => r.n));
        const has = (t: string) => g.leadEvents.some((e) => g.typeOf(e) === t);
        const nameOf = (t: string) => g.leadEvents.filter((e) => g.typeOf(e) === t).join(" and ");
        const finding = (k: string) => g.meta.crawl?.findings.find((f) => f.kind === k);
        const KINDS: [string, string, string, string][] = [["call", "Phone links (tel:)", "Calls", "phone_click"], ["directions", "Direction links (Google Maps)", "Directions", "direction_click"], ["form", "Forms", "Forms", "form_submit_lead"], ["email", "Email links (mailto:)", "Email", "email_click"], ["sms", "Text / SMS links (sms:)", "Text / chat", "sms_click"], ["chat", "Chat widget", "Text / chat", "chat_start"], ["booking", "Booking links", "Booking", "booking_click"]];
        const gapRows = KINDS.map(([k, action, type, ev]) => {
          const f = finding(k);
          if (!f) return { action, on: g.meta.crawl ? "Not found" : "Not checked", status: "Nothing to track", tone: "mute", gap: null as GapTag | null };
          const on = k === "form" ? f.found.join(", ") : `${f.found.length} on site`;
          if (has(type)) return { action, on, status: `Tracked by ${nameOf(type)}`, tone: "good", gap: null };
          const gap: GapTag | null = k === "call" ? { event: ev, kind: "call", match: "tel:" } : k === "email" ? { event: ev, kind: "email", match: "mailto:" } : k === "sms" ? { event: ev, kind: "sms", match: "sms:" }
            : k === "directions" ? { event: ev, kind: "directions", match: "google\\.[a-z.]+/maps|maps\\.app\\.goo\\.gl|maps\\.apple\\.com" } : k === "form" ? { event: ev, kind: "form", match: "" } : null;
          return { action, on, status: gap ? `Not tracked. Install the generated ${ev} tag.` : `Not tracked. Add an event when the ${k === "chat" ? "chat opens" : "booking is made"} (the widget's own GA4 setting).`, tone: "bad", gap };
        });
        const gaps = gapRows.flatMap((r) => (r.gap ? [r.gap] : []));
        const cfg = g.meta.config;
        const enhanced = ["scroll", "click", "form_start", "view_search_results", "file_download"].some((e) => counts.has(e));
        const namedLead = g.leadEvents.filter((e) => !e.includes("(")), keyCov = namedLead.filter((e) => g.meta.keyEvents.includes(e)).length;
        const audit: [string, boolean | null, string][] = [
          ["Data retention set to 14 months", cfg.retention == null ? null : cfg.retention === "FOURTEEN_MONTHS" || /MONTHS_(26|38|50)/.test(cfg.retention), cfg.retention ? cfg.retention.toLowerCase().replace(/_/g, " ") : "couldn't be read"],
          ["Lead events marked as key events", namedLead.length ? keyCov === namedLead.length : false, `${keyCov} of ${namedLead.length} named lead events`],
          ["Enhanced measurement on", enhanced, enhanced ? "scroll / click / form events arrive" : "no scroll, click or form events"],
          ["Google Search Console linked", cfg.searchConsole, cfg.searchConsole ? "linked" : "not linked"],
          ["Google Ads linked", cfg.googleAds, cfg.googleAds ? "linked" : "not linked"],
          ["BigQuery export linked", cfg.bigquery, cfg.bigquery ? "linked" : "not linked"],
          ["Google signals on (age, gender, interests)", cfg.signals == null ? null : cfg.signals === "GOOGLE_SIGNALS_ENABLED", cfg.signals ? cfg.signals.replace("GOOGLE_SIGNALS_", "").toLowerCase() : "couldn't be read"],
          ["link_url registered as a custom dimension", cfg.customDimensionNames.includes("link_url"), cfg.customDimensionNames.length ? `registered: ${cfg.customDimensionNames.join(", ")}` : "none registered"],
          ["No self-referrals (own domain listed as unwanted referral)", g.meta.streamUrl ? !g.sCur().some((x) => g.medium(x) === "referral" && String(x.sessionSourceMedium).includes(new URL(g.meta.streamUrl!).hostname.replace(/^www\./, ""))) : null, "checked in the traffic"],
          ["Internal traffic filter active", null, "GA4 doesn't share data filters through its API: check Admin → Data filters"],
        ];
        const passed = audit.filter((a) => a[1] === true).length, checkable = audit.filter((a) => a[1] !== null).length;
        const foundKinds = gapRows.filter((r) => r.tone !== "mute");
        const leadsAll = g.lCur(), withSource = sum(leadsAll.filter((x) => g.source(x) !== "(not set)" && g.source(x) !== ""), (x) => Number(x.eventCount));
        const T = g.total();
        const site = g.meta.streamUrl ?? "";
        const gtm = gaps.length ? gtmContainer(g.meta.measurementId ?? null, gaps) : "";
        return (
          <>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="Google Analytics setup check" tech="Property configuration check" sub="Read through the Admin API. Fix each item in GA4 Admin (steps in the quick wins below).">
                <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
                  {audit.map(([l, ok, note]) => (
                    <div key={l} className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 text-[13px]">
                      <span className="min-w-0">{l}<small className="block text-xs text-muted">{note}</small></span>
                      <span className={cn("shrink-0 text-xs font-semibold", ok === true ? "text-positive" : ok === false ? "text-negative" : "text-muted")}>{ok === true ? "Pass" : ok === false ? "Fix" : "Check"}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Tracking coverage" info="Lead actions tracked = lead actions found on the site that GA4 receives an event for ÷ all found. Key event coverage = lead events marked as key events ÷ lead events. Configuration score = checks passed ÷ checks that can be read. Leads with source = leads with a known session source ÷ leads.">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Gauge v={foundKinds.length ? foundKinds.filter((r) => r.tone === "good").length / foundKinds.length : null} label="Lead actions tracked" sub={`${foundKinds.filter((r) => r.tone === "good").length} of ${foundKinds.length} found on the site`} color={C[2]} />
                  <Gauge v={namedLead.length ? keyCov / namedLead.length : null} label="Lead events that are key events" sub={`${keyCov} of ${namedLead.length}`} color={C[0]} />
                  <Gauge v={checkable ? passed / checkable : null} label="Configuration checks passed" sub={`${passed} of ${checkable}`} color={C[4]} />
                  <Gauge v={T.leads ? withSource / T.leads : null} label="Leads with a known source" sub="source isn't (not set)" color={C[6]} />
                </div>
              </Card>
              <Card title="Lead actions each day" tech="Lead events per day" sub="Stacked. A flat line at zero means tracking broke." span={7}>
                <ColChart id="setup-day" labels={labels(g)} series={g.leadEvents.map((e) => ({ name: plainEvent(g, e), tech: e, values: g.daily(g.lCur().filter((x) => x.eventName === e), (x) => Number(x.eventCount)), color: eventColor(g, e) }))} />
              </Card>
              <Card title="Everything visitors did (share)" tech="Event volume" sub="Share of all events." span={5}>
                <Treemap items={[...counts].filter(([k]) => !k.includes("(")).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v], i) => ({ label: k, value: v, color: C[i % C.length] }))} />
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Actions tracked on your website" tech="Events found in this property" sub="Read automatically on connect. Lead events are detected by name, so no explorations or setup are needed in GA4. You can change any type." span={7}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-hairline text-[11px] font-semibold uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 text-left">Event name</th><th className="px-3 py-2 text-right">Event count</th><th className="px-3 py-2 text-left">Lead type</th><th className="px-3 py-2 text-left">Key event</th><th className="px-3 py-2 text-left">Detected by</th></tr></thead>
                    <tbody className="divide-y divide-hairline">
                      {rows.map((r) => (
                        <tr key={r.event}>
                          <td className="px-3 py-2"><span className="font-mono text-xs">{r.event}</span><small className="block text-xs text-muted">{plainEvent(g, r.event)}</small></td>
                          <td className="relative px-3 py-2 text-right tabular-nums">{fmt("int", r.n)}<i className="absolute bottom-1 right-3 block h-[3px] rounded-full bg-[var(--cat-1)] opacity-70" style={{ width: `calc(${((r.n / mxN) * 100).toFixed(0)}% - 1.5rem)` }} /></td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {r.counts && r.type ? <Tag tone="acc">{r.type}</Tag> : r.type === "Form start" ? <Tag>Form start</Tag> : <span className="text-faint">–</span>}
                              <LeadTypeSelect event={r.event} value={r.type ?? ""} auto={!r.override} options={[...LEAD_TYPES, "Form start"]} action={setLeadType} disabled={!canEdit} />
                            </div>
                          </td>
                          <td className="px-3 py-2">{r.key ? <Tag tone="good">Yes</Tag> : ""}</td>
                          <td className="px-3 py-2 text-xs text-secondary">{r.rule}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Actions on your site that aren't tracked yet" tech="Tracking gaps" sub={`Lead actions found on ${site.replace(/^https?:\/\//, "") || "the site"} (${(g.meta.crawl?.pages ?? []).join(", ") || "not checked"}) compared with events GA4 receives. Missing ones get a ready-made Tag Manager tag.`} span={5}>
                <table className="w-full text-sm">
                  <thead className="border-b border-hairline text-[11px] font-semibold uppercase tracking-wide text-muted"><tr><th className="px-2 py-2 text-left">Action</th><th className="px-2 py-2 text-left">On site</th><th className="px-2 py-2 text-left">Status</th></tr></thead>
                  <tbody className="divide-y divide-hairline">
                    {gapRows.map((r) => <tr key={r.action}><td className="px-2 py-2">{r.action}</td><td className="px-2 py-2 text-xs text-secondary">{r.on}</td><td className={cn("px-2 py-2 text-xs", r.tone === "good" ? "text-positive" : r.tone === "bad" ? "text-negative" : "text-muted")}>{r.status}</td></tr>)}
                  </tbody>
                </table>
                {g.meta.crawl?.error && <Note>The website couldn&apos;t be checked: {g.meta.crawl.error}</Note>}
                {gaps.length > 0 && (
                  <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface-sunken p-3">
                    <p className="text-[13px] font-medium">Ready-made tags for {gaps.map((x) => x.event).join(", ")}</p>
                    <p className="text-xs text-secondary">Tag Manager: Admin → Import container → choose this file → Merge. Then publish, mark the events as key events in GA4, and they appear here from the next sync.</p>
                    <div className="flex flex-wrap gap-2"><DownloadButton text={gtm} filename="lead-tracking-gtm.json" label="Download GTM container (.json)" /><CopyButton text={gtagSnippet(gaps)} label="Copy gtag.js snippet (no Tag Manager)" /></div>
                  </div>
                )}
              </Card>
              <Card title="Your service area" sub="Cities you serve: used for 'Leads from service area', the city tags and the local-proof quick wins. One city per line.">
                <ServiceAreaForm initial={areaSource === "Saved on Lead setup" ? g.serviceAreaNames : []} source={`${areaSource}${g.serviceArea.length ? ` (${g.serviceArea.length} cities)` : ""}`} action={setServiceArea} disabled={!canEdit} />
              </Card>
            </Grid>
            <ScreenTasks screen="Lead setup" wins={forScreen(wins, "setup")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
