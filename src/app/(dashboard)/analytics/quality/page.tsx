import { CalHeat, Gauge, LineChart } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Insight, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { notableChanges } from "@/lib/ga4x/insights";
import { addDays, group, shortDate, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { labels } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/quality";
const P = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;

export default async function QualityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} users title="Insights and data quality" description="What changed, bot and spam traffic, whether lead tracking still works, and how trustworthy the numbers are.">
      {({ g, wins }) => {
        const insights = notableChanges(g);
        // bot slices over the last 14 stored days (as the sample shows) plus the selected period
        const from = addDays(g.meta.end, -13) < g.p.start ? addDays(g.meta.end, -13) : g.p.start;
        const bots = [...group(g.GE.filter((x) => String(x.date) >= from), (x) => `${x.date}|${x.country}|${x.browser}`)].map(([k, v]) => { const [d, c, b] = k.split("|"); const s = sum(v, (x) => Number(x.sessions)), e = sum(v, (x) => Number(x.engagedSessions)); return { d: shortDate(d), date: d, c, b, sessions: s, pv: sum(v, (x) => Number(x.screenPageViews)), er: s ? e / s : 0 }; })
          .filter((r) => r.sessions > 15 && r.er < 0.2).sort((a, b) => b.pv - a.pv);
        const end = g.p.end, start = g.meta.start, n = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
        const botPv = new Array<number>(Math.max(0, n)).fill(0);
        for (const x of g.GE) if (g.isBot(x)) { const i = Math.round((Date.parse(String(x.date)) - Date.parse(start)) / 86_400_000); if (i >= 0 && i < n) botPv[i] += Number(x.screenPageViews); }
        const dAll = g.daily(g.geoCur(), (x) => Number(x.sessions)), dBot = g.daily(g.geoCur().filter(g.isBot), (x) => Number(x.sessions));
        // lead tracking health: per lead event, average a day over 28 days and days since last seen
        const health = g.leadEvents.map((e) => {
          const rows = g.L.filter((x) => x.eventName === e);
          const last = rows.reduce((m, x) => (String(x.date) > m ? String(x.date) : m), "");
          const since = addDays(g.meta.end, -27);
          const avg = sum(rows.filter((x) => String(x.date) >= since), (x) => Number(x.eventCount)) / 28;
          const days = last ? Math.round((Date.parse(g.meta.end) - Date.parse(last)) / 86_400_000) : null;
          return { e, avg, last: days, lastTxt: days == null ? "never" : days === 0 ? "today" : `${days} day${days > 1 ? "s" : ""} ago`, lastTone: days == null || (avg >= 1 && days >= 3) ? "bad" : days <= 1 ? "good" : "warn" };
        });
        const all = g.sCur(), tot = sum(all, (x) => Number(x.sessions)) || 1, geoAll = g.geoCur(), geoTot = sum(geoAll, (x) => Number(x.sessions)) || 1;
        const gshare = (f: (x: (typeof geoAll)[number]) => boolean) => sum(geoAll.filter(f), (x) => Number(x.sessions)) / geoTot;
        const share = (f: (x: (typeof all)[number]) => boolean) => sum(all.filter(f), (x) => Number(x.sessions)) / tot;
        const host = g.meta.streamUrl ? new URL(g.meta.streamUrl).hostname.replace(/^www\./, "") : null;
        const selfRef = sum(all.filter((x) => host && String(x.sessionSourceMedium).includes(host) && g.medium(x) === "referral"), (x) => Number(x.sessions));
        const ag = g.users?.ageGender ?? [];
        const unknownDemo = sum(ag.filter((r) => r.age === "unknown" || r.gender === "unknown"), (r) => r.users) / Math.max(1, sum(ag, (r) => r.users));
        const T = g.total(), forms = g.eventsOfType("Forms").map((e) => [e, T.ev[e] ?? 0] as const).filter(([, v]) => v > 0);
        const dupForms = forms.length > 1 && Math.min(...forms.map((f) => f[1])) / Math.max(...forms.map((f) => f[1])) > 0.4;
        const checks: { c: string; v: string; s: string; sTone: string }[] = [
          { c: "(not set) landing page share", v: P(share((x) => x.landingPagePlusQueryString === "(not set)")), s: share((x) => x.landingPagePlusQueryString === "(not set)") > 0.05 ? "Fix" : "OK", sTone: "" },
          { c: "Unassigned channel share", v: P(share((x) => x.ch === "Unassigned")), s: share((x) => x.ch === "Unassigned") > 0.05 ? "Fix" : "OK", sTone: "" },
          { c: "(not set) city share", v: P(gshare((x) => x.city === "(not set)")), s: gshare((x) => x.city === "(not set)") > 0.15 ? "Info" : "OK", sTone: "" },
          { c: "Self-referrals", v: `${selfRef} sessions`, s: selfRef ? "Fix" : "OK", sTone: "" },
          { c: "Thresholding applied", v: ag.length ? `Age and gender: ${P(unknownDemo)} unknown` : "Age and gender not available", s: "Info", sTone: "" },
          { c: "Bot-like slices (many sessions, < 20% engaged)", v: `${g.botSlices.size} slices · ${P(gshare(g.isBot))} of sessions`, s: g.botSlices.size ? (g.qualified ? "Excluded" : "Info") : "OK", sTone: "" },
          { c: "Several events count the same form", v: forms.map(([e, v]) => `${e}: ${v}`).join(" · ") || "one form event", s: dupForms ? "Fix" : "OK", sTone: "" },
          { c: "Duplicate lead events (< 5 s apart)", v: "Needs the BigQuery export", s: "Info", sTone: "" },
        ].map((r) => ({ ...r, sTone: r.s === "OK" || r.s === "Excluded" ? "good" : r.s === "Fix" ? "warn" : "mute" }));
        const cfg = g.meta.config;
        const cfgChecks = [cfg.retention === "FOURTEEN_MONTHS", g.leadEvents.length > 0 && g.leadEvents.every((e) => e.includes("(") || g.meta.keyEvents.includes(e)), !!cfg.searchConsole, !!cfg.googleAds, !!cfg.bigquery, cfg.signals === "GOOGLE_SIGNALS_ENABLED", cfg.customDimensionNames.includes("link_url"), selfRef === 0];
        const Tall = g.totalAll();
        return (
          <>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="Insights" sub="Each day and slice compared with the same weekday over the previous 4 weeks.">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{insights.map((c) => <Insight key={c.title} {...c} />)}</div>
              </Card>
              <Card title="Data health" info="Configuration score = setup checks passed ÷ all checks. Qualified leads = leads outside bot-like slices ÷ all leads. Human sessions = 1 − bot-like sessions ÷ sessions. Pages with a landing page value = 1 − sessions with landing page (not set) ÷ sessions.">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Gauge v={cfgChecks.filter(Boolean).length / cfgChecks.length} label="Configuration score" sub={`${cfgChecks.filter(Boolean).length} of ${cfgChecks.length} checks`} color={C[4]} />
                  <Gauge v={Tall.leads ? g.total().leads / Tall.leads : null} label="Qualified leads" sub={Tall.leads ? undefined : "No leads yet"} color={C[2]} />
                  <Gauge v={1 - gshare(g.isBot)} label="Human sessions" color={C[0]} />
                  <Gauge v={1 - share((x) => x.landingPagePlusQueryString === "(not set)")} label="Pages with a landing page value" color={C[3]} />
                </div>
              </Card>
              <Card title="Fake traffic by day" tech="Bot page views calendar" sub="Days with bursts of zero-engagement page views." span={6}>
                <CalHeat values={botPv} start={start} color={C[7]} label="bot page views" />
              </Card>
              <Card title="Share of visits that are fake" tech="Bot share of sessions" sub="Daily." span={6}>
                <LineChart id="q-bot" f="pct" labels={labels(g)} series={[{ name: "Bot share", values: dBot.map((v, i) => (dAll[i] ? v / dAll[i] : 0)), color: C[7], area: true }]} />
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Fake (bot) traffic" tech="Bot and spam traffic" sub={`Day, country and browser slices with many page views and almost no engagement (over 15 sessions, under 20% engaged). ${g.qualified ? "Excluded from lead reports." : "Included now (All leads)."}`} span={7}>
                <Table rows={bots} facets={[{ k: "c", label: "Country" }, { k: "b", label: "Browser" }]} cols={[{ k: "d", label: "Day" }, { k: "c", label: "Country" }, { k: "b", label: "Browser" }, { k: "sessions", label: "Sessions", num: true }, { k: "pv", label: "Page views", num: true, bar: C[7] }, { k: "er", label: "Engagement rate", num: true, f: "pct" }]} empty="No bot-like traffic in this period." />
              </Card>
              <Card title="Is lead tracking working?" tech="Lead tracking health" sub="Alerts when a lead event that usually arrives stops for 3 days." span={5}>
                <Table rows={health} cols={[{ k: "e", label: "Event", kind: "event" }, { k: "avg", label: "Per day (28d)", num: true, f: "dec1" }, { k: "lastTxt", label: "Last seen", kind: "status" }]} empty="No lead events are counted yet." />
              </Card>
              <Card title="Data checks" tech="Data quality">
                <Table rows={checks.map((r) => ({ c: r.c, v: r.v, s: r.s, sTone: r.sTone }))} cols={[{ k: "c", label: "Check" }, { k: "v", label: "Value", wrap: true }, { k: "s", label: "Status", kind: "tag" }]} />
              </Card>
            </Grid>
            <ScreenTasks screen="Insights and data quality" wins={forScreen(wins, "quality")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
