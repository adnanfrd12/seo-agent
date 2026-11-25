import { BubbleMap, CalHeat, ColChart, CompareBars, Donut, Heat, LineChart, Scatter, Stack100, WhatChanged } from "@/components/ga4x/charts";
import { C, fmt, typeColor } from "@/components/ga4x/fmt";
import { Table, type Col } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Note, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGeo } from "@/lib/ga4x/geo";
import { sum, weekday, WEEKDAYS } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { eventColor, HOUR_BUCKETS, labels, leadCalendar, mapPoints, plainEvent, TYPE_PLAIN, typeMissing } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/leads";

export default async function LeadsOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Leads overview" description="Every lead from the website, by type, source, time and place.">
      {async ({ g, wins, clientId }) => {
        const T = g.total(), Tp = g.total(true), lab = labels(g), evs = g.leadEvents, types = g.types();
        const cur = g.lCur(), prv = g.lPrev();
        const evDaily = (e: string, prev = false) => g.daily((prev ? prv : cur).filter((x) => x.eventName === e), (x) => Number(x.eventCount), prev);
        const ch = g.by((x) => String(x.ch)).sort((a, b) => b.leads - a.leads || b.sessions - a.sessions), chp = g.by((x) => String(x.ch), undefined, true);
        const cum = (prev: boolean) => { let t = 0; return g.leadsDaily(prev).map((v) => (t += v)); };
        const heat = WEEKDAYS.map((d) => HOUR_BUCKETS.map(([, a, b]) => sum(g.l2Cur().filter((x) => { const h = Number(String(x.dateHour).slice(11, 13)); return weekday(String(x.dateHour).slice(0, 10)) === d && h >= a && h < b; }), (x) => Number(x.eventCount))));
        const lp = g.by((x) => String(x.land)).filter((r) => r.sessions >= 10);
        const geo = await loadGeo(createAdminClient(), clientId);
        const pts = mapPoints(g, geo, cur.map((x) => ({ city: String(x.city), country: String(x.country), v: Number(x.eventCount) })));
        const { start, cal } = leadCalendar(g);
        const dS = g.daily(g.sCur(), (x) => Number(x.sessions)), dL = g.leadsDaily();
        const byDow = types.map((t) => ({ name: TYPE_PLAIN[t], color: typeColor(t), values: WEEKDAYS.map((d) => sum(cur.filter((x) => g.typeOf(String(x.eventName)) === t && weekday(String(x.date)) === d), (x) => Number(x.eventCount))) }));
        const nvr = ["new", "returning"];
        const byNew = types.map((t) => ({ name: TYPE_PLAIN[t], color: typeColor(t), values: nvr.map((v) => sum(g.l2Cur().filter((x) => g.typeOf(String(x.eventName)) === t && x.newVsReturning === v), (x) => Number(x.eventCount))) }));
        const cols: Col[] = [{ k: "key", label: "Channel" }, { k: "sessions", label: "Sessions", num: true }, { k: "leads", label: "Leads", num: true, bar: C[2] }, { k: "lr", label: "Lead rate", num: true, f: "pct" }, ...evs.map((e) => ({ k: e, label: e, num: true }))];
        return (
          <>
            <Kpis>
              <Kpi label="All leads" value={fmt("int", T.leads)} cur={T.leads} prev={Tp.leads} spark={dL} color={C[4]} />
              {evs.map((e) => <Kpi key={e} label={plainEvent(g, e)} tech={e} value={fmt("int", T.ev[e] ?? 0)} cur={T.ev[e] ?? 0} prev={Tp.ev[e] ?? 0} note={g.typeOf(e) ?? undefined} spark={evDaily(e)} color={eventColor(g, e)} />)}
              {types.filter((t) => !g.eventsOfType(t).length).map((t) => <Kpi key={t} label={TYPE_PLAIN[t]} value="000" note={t} missing={typeMissing(g, t)} />)}
            </Kpis>
            <Band title="Charts" />
            <Grid>
              <Card title="Leads each day (all types together)" tech="Leads per day by event" span={8}>
                <ColChart id="leads-day" labels={lab} series={evs.map((e) => ({ name: plainEvent(g, e), tech: e, values: evDaily(e), color: eventColor(g, e) }))} />
              </Card>
              <Card title="Types of leads" tech="Lead mix" sub="Share of all leads." span={4}>
                <Donut parts={evs.map((e) => ({ label: plainEvent(g, e), tech: e, value: T.ev[e] ?? 0, color: eventColor(g, e) }))} />
              </Card>
              <Card title="When leads come in" tech="Leads by hour and weekday" sub={`Time zone: ${g.meta.timezone}.`} span={4}>
                <Heat rows={WEEKDAYS} cols={HOUR_BUCKETS.map((b) => b[0])} m={heat} color={C[2]} />
              </Card>
              <Card title="Lead types: this month vs last" tech="Lead types: this period vs last" span={6}>
                <CompareBars rows={types.map((t) => ({ label: TYPE_PLAIN[t], cur: T.types[t] ?? 0, prev: Tp.types[t] ?? 0 }))} color={C[2]} />
              </Card>
              <Card title="Leads adding up over the month" tech="Cumulative leads" span={6}>
                <LineChart id="leads-cum" labels={lab} series={[{ name: "This period", values: cum(false), color: C[2], area: true }, { name: "Previous period", values: cum(true), color: C[2], dash: true }]} noToggle />
              </Card>
              <Card title="Types of leads from each source" tech="Lead mix by channel" span={6}>
                <Stack100 rows={ch.filter((r) => r.leads).map((r) => ({ label: r.key, parts: evs.map((e) => r.ev[e] ?? 0) }))} names={evs.map((e) => plainEvent(g, e))} colors={evs.map((e) => eventColor(g, e))} />
              </Card>
              <Card title="What caused the change in leads" tech="What changed leads" sub="By channel." span={6}>
                <WhatChanged id="leads-wf" unit="leads" start={Tp.leads} items={[...new Set([...ch.map((r) => r.key), ...chp.map((r) => r.key)])].map((k) => ({ label: k, value: (ch.find((r) => r.key === k)?.leads ?? 0) - (chp.find((r) => r.key === k)?.leads ?? 0) }))} />
              </Card>
              <Card title="Pages: visits vs how many become leads" tech="Landing pages: traffic vs lead rate" sub="Pages with 10+ sessions. Bubble = leads." span={7}>
                <Scatter points={lp.map((r) => ({ x: r.sessions, y: r.lr, s: Math.max(1, r.leads), label: r.key, show: r.leads > 0 || r.sessions === Math.max(...lp.map((x) => x.sessions)), c: r.lr >= T.lr ? C[2] : C[1] }))} xLabel="Sessions (log scale)" yLabel="Lead rate" logX yRef={T.lr} />
              </Card>
              <Card title="Leads by town (map)" tech="Leads on the map" span={5}>
                <BubbleMap pts={pts} color={C[2]} label="leads" /><Note>City positions © OpenStreetMap contributors.</Note>
              </Card>
              <Card title="Leads each day (calendar)" tech="Daily leads calendar">
                <CalHeat values={cal} start={start} color={C[2]} label="leads" />
              </Card>
              {evs.map((e) => (
                <Card key={e} title={plainEvent(g, e)} tech={e} sub={`Total: ${fmt("int", T.ev[e] ?? 0)} vs ${fmt("int", Tp.ev[e] ?? 0)}.`} span={6}>
                  <LineChart id={`leads-ev-${e}`} labels={lab} series={[{ name: "This period", values: evDaily(e), color: eventColor(g, e), area: true }, { name: "Previous period", values: evDaily(e, true), color: eventColor(g, e), dash: true }]} h={170} />
                </Card>
              ))}
              <Card title="Share of visits that became leads, each day" tech="Lead rate over time" sub="Leads ÷ visits, daily.">
                <LineChart id="leads-lr" labels={lab} f="pct" series={[{ name: "Lead rate", values: dL.map((v, i) => (dS[i] ? v / dS[i] : null)), color: C[4], area: true }, { name: "Previous period", values: g.leadsDaily(true).map((v, i) => { const s = g.daily(g.sPrev(), (x) => Number(x.sessions), true)[i]; return s ? v / s : null; }), color: C[4], dash: true }]} />
              </Card>
              <Card title="Leads by day of the week" span={6}>
                <ColChart id="leads-dow" labels={WEEKDAYS} series={byDow} />
              </Card>
              <Card title="Leads from new and returning visitors" span={6}>
                <ColChart id="leads-nvr" labels={nvr} series={byNew} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Which sources turn visitors into leads" tech="Lead rate by channel" sub="Leads per 100 sessions." span={8}>
                <Table cols={cols} rows={ch.map((r) => ({ key: r.key, sessions: r.sessions, leads: r.leads, lr: r.lr, ...Object.fromEntries(evs.map((e) => [e, r.ev[e] ?? 0])) }))}
                  foot={{ key: "Total", sessions: T.sessions, leads: T.leads, lr: T.lr, ...Object.fromEntries(evs.map((e) => [e, T.ev[e] ?? 0])) }} />
              </Card>
              <Card title="Lead events by type" tech="lead_map" sub="Change types on Lead setup." span={4}>
                <Table cols={[{ k: "e", label: "Event", kind: "event" }, { k: "t", label: "Type", kind: "tag" }, { k: "n", label: "Leads", num: true }]} rows={evs.map((e) => ({ e, t: g.typeOf(e), n: T.ev[e] ?? 0 }))} />
              </Card>
            </Grid>
            <ScreenTasks screen="Leads overview" wins={forScreen(wins, "leads")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}

