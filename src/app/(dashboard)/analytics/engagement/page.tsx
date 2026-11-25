import { BarList, Scatter, Stack100, Treemap } from "@/components/ga4x/charts";
import { C, GOOD, MUTED } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing, Note, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { group, pageGroup, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";

export const maxDuration = 120;
const PATH = "/analytics/engagement";

export default async function EngagementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} users title="Engagement" description="Which pages people read and what they do there.">
      {({ g, wins }) => {
        const pg = [...group(g.pages.filter(g.inCur), (x) => String(x.pagePath))].map(([k, v]) => ({ key: k, views: sum(v, (x) => Number(x.screenPageViews)), sec: sum(v, (x) => Number(x.userEngagementDuration)), title: String(v[0].pageTitle ?? "") }));
        const leadsOn = new Map([...group(g.l2Cur(), (x) => String(x.pagePath))].map(([k, v]) => [k, sum(v, (x) => Number(x.eventCount))]));
        const users = g.users?.byPage ?? {};
        const pages = pg.map((p) => ({ ...p, users: users[p.key] ?? null, aet: users[p.key] ? p.sec / users[p.key] : p.views ? p.sec / p.views : 0, onPage: leadsOn.get(p.key) ?? 0 })).sort((a, b) => b.views - a.views);
        const pe = g.pageEvents.filter(g.inCur);
        const scroll = [...group(pe, (x) => String(x.pagePath))].map(([k, v]) => ({ k, pv: sum(v.filter((x) => x.eventName === "page_view"), (x) => Number(x.eventCount)), sc: sum(v.filter((x) => x.eventName === "scroll"), (x) => Number(x.eventCount)) })).filter((r) => r.pv > 0).sort((a, b) => b.pv - a.pv).slice(0, 6);
        const out = [...group(g.links.filter((x) => g.inCur(x) && x.eventName === "click" && String(x.outbound) === "true"), (x) => String(x.linkDomain || "(not set)"))].map(([k, v]) => ({ k, n: sum(v, (x) => Number(x.eventCount)) })).sort((a, b) => b.n - a.n).slice(0, 8);
        const terms = [...group(g.search.filter(g.inCur), (x) => String(x.searchTerm))].map(([k, v]) => ({ k, n: sum(v, (x) => Number(x.eventCount)) })).sort((a, b) => b.n - a.n).slice(0, 8);
        const lp = g.by((x) => String(x.land)).sort((a, b) => b.sessions - a.sessions);
        const variants = new Map([...group(g.sCur(), (x) => String(x.land))].map(([k, v]) => [k, new Set(v.map((x) => String(x.landingPagePlusQueryString))).size]));
        const evs = [...group(g.events.filter(g.inCur), (x) => String(x.eventName))].map(([k, v]) => { const n = sum(v, (x) => Number(x.eventCount)), u = g.users?.byEvent[k] ?? null; return { e: k, n, users: u, per: u ? n / u : null }; }).sort((a, b) => b.n - a.n);
        const sections = [...group(pages, (p) => pageGroup(p.key))].map(([k, v], i) => ({ label: k, value: sum(v, (p) => p.views), color: C[i % C.length] }));
        return (
          <>
            <Band title="Charts" />
            <Grid>
              <Card title="How far people read" tech="Scroll depth by page" sub="Page views scrolled to 90%." info="Share of page views that reached 90% (scroll event ÷ page_view)." span={4}>
                {scroll.some((r) => r.sc) ? <BarList rows={scroll.map((r) => ({ label: r.k, value: Math.min(1, r.sc / r.pv), color: C[3] }))} f="pct" max={1} />
                  : <Missing why="GA4 receives no scroll events from this site." fix="Turn on Enhanced measurement → Scrolls (GA4 Admin → Data streams → your web stream)." />}
              </Card>
              <Card title="Links people clicked to other sites" tech="Outbound clicks" info="Outbound click events, by link_domain." span={4}>
                <BarList rows={out.map((r) => ({ label: r.k, value: r.n, color: C[4] }))} empty="No clicks on links to other sites in this period." />
              </Card>
              <Card title="What people searched for on your site" tech="Site search terms" info="view_search_results events, by search_term." span={4}>
                {terms.length ? <BarList rows={terms.map((r) => ({ label: r.k, value: r.n, color: C[5] }))} />
                  : <Missing why="GA4 receives no view_search_results events: the site has no search box, or search tracking is off." fix="If the site has a search box, turn on Enhanced measurement → Site search and check its query parameter (q, s, search)." />}
              </Card>
              <Card title="Pages: views vs time spent" tech="Pages: views vs engagement time" sub="Bubble = leads on the page." span={7}>
                <Scatter points={pages.filter((p) => p.views >= 5).slice(0, 40).map((p) => ({ x: p.views, y: p.aet, s: Math.max(1, p.onPage), label: p.key, show: p.onPage > 0 || p.views === pages[0]?.views, c: p.onPage ? C[2] : C[0] }))} xLabel="Views (log scale)" yLabel="Avg engagement time" yf="dur" logX />
              </Card>
              <Card title="How long visits last" tech="Session engagement time" sub="Sessions per time bucket." span={5}>
                <Missing why="Engagement time per session (to sort visits into under 10s, 10–30s … 5m+) is only in the BigQuery export; the Data API gives averages, not each session." fix="Link GA4 to BigQuery (GA4 Admin → Product links → BigQuery links → daily export) and share the dataset with this portal." />
                <Note>Average engagement per visit in this period: {Math.round(g.total().aet)}s.</Note>
              </Card>
              <Card title="Views by part of the site" tech="Views by section" span={6}>
                <Treemap items={sections} />
              </Card>
              <Card title="Visits that engaged, by page" tech="Engaged vs not, by landing page" span={6}>
                <Stack100 rows={lp.slice(0, 8).map((r) => ({ label: r.key, parts: [r.engaged, r.sessions - r.engaged] }))} names={["Engaged", "Not engaged"]} colors={[GOOD, MUTED]} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Most visited pages" tech="Pages and screens">
                <Table site={g.meta.streamUrl} limit={12} rows={pages.map((p) => ({ key: p.key, views: p.views, users: p.users, aet: p.aet, onPage: p.onPage }))}
                  cols={[{ k: "key", label: "Page path", kind: "page" }, { k: "views", label: "Views", num: true, bar: C[0] }, { k: "users", label: "Users", num: true }, { k: "aet", label: "Avg engagement time", num: true, f: "dur" }, { k: "onPage", label: "Leads on page", num: true }]} />
              </Card>
              <Card title="Pages people arrive on" tech="Landing pages (cleaned)" sub="Tracking parameters removed." info="Tracking parameters removed, with how many raw variants were merged." span={7}>
                <Table site={g.meta.streamUrl} limit={12} rows={lp.map((r) => ({ key: r.key, sessions: r.sessions, er: r.er, leads: r.leads, lr: r.lr, variants: variants.get(r.key) ?? 1 }))}
                  cols={[{ k: "key", label: "Landing page", kind: "page" }, { k: "sessions", label: "Sessions", num: true, bar: C[2] }, { k: "er", label: "Engagement rate", num: true, f: "pct" }, { k: "leads", label: "Leads", num: true }, { k: "lr", label: "Lead rate", num: true, f: "pct" }, { k: "variants", label: "Raw variants", num: true }]} />
              </Card>
              <Card title="Everything visitors did" tech="Events" span={5}>
                <Table limit={20} rows={evs} cols={[{ k: "e", label: "Event name", kind: "event" }, { k: "n", label: "Count", num: true, bar: C[1] }, { k: "users", label: "Users", num: true }, { k: "per", label: "Per user", num: true, f: "dec2" }]} />
              </Card>
            </Grid>
            <ScreenTasks screen="Engagement" wins={forScreen(wins, "eng")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
