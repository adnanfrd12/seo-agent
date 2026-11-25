import { BarList, CompareBars, LineChart, Sankey, Scatter, Stack100, Treemap, WhatChanged } from "@/components/ga4x/charts";
import { C, channelColor, deviceColor } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { group, pageGroup, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { labels } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/acquisition";
const MEDIUMS = new Set(["organic", "cpc", "ppc", "paid", "referral", "email", "social", "paid_social", "paidsocial", "display", "affiliate", "(none)", "(not set)", "video", "sms", "push", "audio", "cpm", "banner", "ai-assistant", "organic_social", "social-network", "social-media", "sm", "social network", "social media", "print", "qr", "offline", "retargeting"]);

export default async function AcquisitionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Acquisition" description="Where visitors come from and which sources bring leads.">
      {({ g, wins }) => {
        const T = g.total(), Tp = g.total(true), lab = labels(g);
        const ch = g.by((x) => String(x.ch)).sort((a, b) => b.sessions - a.sessions), chp = g.by((x) => String(x.ch), undefined, true);
        const prevOf = (k: string) => chp.find((r) => r.key === k)?.sessions ?? 0;
        const top = ch.slice(0, 4).map((r) => r.key);
        const sDay = (k: string | null) => g.daily(g.sCur().filter((x) => k == null || x.ch === k), (x) => Number(x.sessions));
        const all = sDay(null);
        const aiS = g.sCur().filter((x) => x.ch === "AI Assistant"), aiL = g.lCur().filter((x) => x.ch === "AI Assistant");
        const ai = [...new Set([...aiS.map(g.ai), ...aiL.map(g.ai)])].map((k) => ({ k, s: sum(aiS.filter((x) => g.ai(x) === k), (x) => Number(x.sessions)), l: sum(aiL.filter((x) => g.ai(x) === k), (x) => Number(x.eventCount)) })).sort((a, b) => b.s - a.s);
        const flows: [string, string, number][] = [];
        for (const [k, v] of group(g.sCur(), (x) => `${x.ch}|${pageGroup(String(x.land))}`)) { const [a, b] = k.split("|"); flows.push([a, b, sum(v, (x) => Number(x.sessions))]); }
        const sm = g.by((x) => String(x.sessionSourceMedium)).sort((a, b) => b.sessions - a.sessions);
        const src = g.by((x) => g.source(x)).sort((a, b) => b.sessions - a.sessions);
        const devs = [...new Set(g.sCur().map((x) => String(x.deviceCategory)))];
        // UTM and tagging audit
        const smRows = [...group(g.sCur(), (x) => String(x.sessionSourceMedium))].map(([k, v]) => ({ k, s: sum(v, (x) => Number(x.sessions)) }));
        const issues: { issue: string; example: string; sessions: number; fix: string }[] = [];
        const bySrc = group(smRows, (r) => r.k.split(" / ")[0].toLowerCase());
        for (const [, v] of bySrc) { const variants = [...new Set(v.map((r) => r.k.split(" / ")[0]))]; if (variants.length > 1) issues.push({ issue: "Mixed case source", example: variants.slice(0, 3).join(" vs "), sessions: sum(v, (r) => r.s), fix: "Use lowercase in all UTM links" }); }
        const unknown = smRows.filter((r) => { const m = (r.k.split(" / ")[1] ?? "").toLowerCase(); return m && !MEDIUMS.has(m); });
        if (unknown.length) issues.push({ issue: "Unknown medium", example: unknown.slice(0, 3).map((r) => r.k).join(", "), sessions: sum(unknown, (r) => r.s), fix: "Use a standard medium (organic, cpc, email, social, referral) so GA4 puts it in the right channel" });
        const noMed = smRows.filter((r) => /\/ \(none\)$|\/ \(not set\)$/.test(r.k) && !/^\(direct\)/.test(r.k));
        if (noMed.length) issues.push({ issue: "Missing medium", example: noMed.slice(0, 3).map((r) => r.k).join(", "), sessions: sum(noMed, (r) => r.s), fix: "Add utm_medium to these links" });
        const host = g.meta.streamUrl ? new URL(g.meta.streamUrl).hostname.replace(/^www\./, "") : null;
        const self = smRows.filter((r) => host && r.k.includes(host) && r.k.endsWith("/ referral"));
        if (self.length) issues.push({ issue: "Self-referral", example: self[0].k, sessions: sum(self, (r) => r.s), fix: "Add the domain to unwanted referrals (GA4 Admin → Data streams → Configure tag settings)" });
        const unas = ch.find((r) => r.key === "Unassigned");
        if (unas?.sessions) issues.push({ issue: "Unassigned channel", example: g.by((x) => (x.ch === "Unassigned" ? String(x.sessionSourceMedium) : null)).sort((a, b) => b.sessions - a.sessions).slice(0, 3).map((r) => r.key).join(", "), sessions: unas.sessions, fix: "Tag these links with standard utm_source / utm_medium values" });
        const adsCur = g.ads.filter((x) => g.inCur(x));
        const camps = [...group(adsCur, (x) => String(x.sessionGoogleAdsCampaignName))].map(([k, v]) => {
          const cost = sum(v, (x) => Number(x.advertiserAdCost)), leads = sum(g.l2Cur().filter((x) => x.sessionCampaignName === k), (x) => Number(x.eventCount));
          return { key: k, clicks: sum(v, (x) => Number(x.advertiserAdClicks)), cost, leads, cpl: leads ? cost / leads : null };
        });
        return (
          <>
            <Band title="Charts" />
            <Grid>
              <Card title="Visits by source over time" tech="Sessions by channel" sub="Daily, top 4 channels." span={8}>
                <LineChart id="acq-ch" labels={lab} series={top.map((k, i) => ({ name: k, values: sDay(k), color: channelColor(k, i) }))} />
              </Card>
              <Card title="Visitors from ChatGPT and other AI tools" tech="AI assistants" info="Sessions from ChatGPT, Perplexity, Gemini and Copilot." span={4}>
                <BarList rows={ai.map((r) => ({ label: r.k, value: r.s, color: C[6], right: `${r.s} · ${r.l} leads` }))} empty="No visits from AI assistants in this period." />
              </Card>
              <Card title="Where each source sends visitors" tech="Channel → landing page" sub="Band width = sessions.">
                <Sankey flows={flows} rightColor={C[2]} />
              </Card>
              <Card title="Sources: visits vs lead rate" tech="Sources: sessions vs lead rate" sub="Sources with 5+ sessions. Bubble = leads." span={7}>
                <Scatter points={sm.filter((r) => r.sessions >= 5).map((r) => ({ x: r.sessions, y: r.lr, s: Math.max(1, r.leads), label: r.key, show: r.leads > 0 || r.sessions >= sm[0].sessions * 0.3, c: r.lr >= T.lr ? C[2] : C[0] }))} xLabel="Sessions (log scale)" yLabel="Lead rate" logX yRef={T.lr} />
              </Card>
              <Card title="Visits by source" tech="Sessions by source" span={5}>
                <Treemap items={src.slice(0, 16).map((r, i) => ({ label: r.key, value: r.sessions, color: C[i % C.length] }))} />
              </Card>
              <Card title="Sources: this month vs last" tech="Channels: this period vs last" sub="Sessions." span={6}>
                <CompareBars rows={ch.map((r) => ({ label: r.key, cur: r.sessions, prev: prevOf(r.key) }))} />
              </Card>
              <Card title="What caused the change in visits" tech="What changed sessions" sub="By channel." span={6}>
                <WhatChanged id="acq-wf" unit="visits" start={Tp.sessions} items={[...new Set([...ch.map((r) => r.key), ...chp.map((r) => r.key)])].map((k) => ({ label: k, value: (ch.find((r) => r.key === k)?.sessions ?? 0) - prevOf(k) }))} />
              </Card>
              <Card title="Share of visits by source" tech="Channel share of sessions" sub="Top 4 channels, daily." span={7}>
                <LineChart id="acq-share" f="pct" labels={lab} series={top.map((k, i) => ({ name: k, values: sDay(k).map((v, j) => (all[j] ? v / all[j] : null)), color: channelColor(k, i) }))} />
              </Card>
              <Card title="Phone vs computer by source" tech="Device mix by channel" span={5}>
                <Stack100 rows={ch.map((r) => ({ label: r.key, parts: devs.map((d) => sum(g.sCur().filter((x) => x.ch === r.key && x.deviceCategory === d), (x) => Number(x.sessions))) }))} names={devs} colors={devs.map((d, i) => deviceColor(d, i))} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Where visitors come from" tech="Traffic acquisition" info="Session default channel group, plus AI Assistant for ChatGPT, Perplexity, Gemini and the like.">
                <Table rows={ch.map((r) => ({ key: r.key, sessions: r.sessions, chg: r.sessions, prev: prevOf(r.key), engaged: r.engaged, er: r.er, aet: r.aet, leads: r.leads, lr: r.lr }))}
                  cols={[{ k: "key", label: "Channel" }, { k: "sessions", label: "Sessions", num: true, bar: C[0] }, { k: "chg", label: "Change", num: true, kind: "delta", prevKey: "prev" }, { k: "engaged", label: "Engaged sessions", num: true }, { k: "er", label: "Engagement rate", num: true, f: "pct" }, { k: "aet", label: "Avg engagement time", num: true, f: "dur" }, { k: "leads", label: "Leads", num: true }, { k: "lr", label: "Lead rate", num: true, f: "pct" }]}
                  foot={{ key: "Total", sessions: T.sessions, engaged: T.engaged, er: T.er, aet: T.aet, leads: T.leads, lr: T.lr }} />
              </Card>
              <Card title="Every website and app that sent visitors" tech="Source / medium" span={7}>
                <Table limit={12} rows={sm.map((r) => ({ key: r.key, sessions: r.sessions, engaged: r.engaged, er: r.er, aet: r.aet, leads: r.leads, lr: r.lr }))}
                  cols={[{ k: "key", label: "Source / medium" }, { k: "sessions", label: "Sessions", num: true, bar: C[0] }, { k: "engaged", label: "Engaged sessions", num: true }, { k: "er", label: "Engagement rate", num: true, f: "pct" }, { k: "aet", label: "Avg engagement time", num: true, f: "dur" }, { k: "leads", label: "Leads", num: true }, { k: "lr", label: "Lead rate", num: true, f: "pct" }]} />
              </Card>
              <Card title="Google Ads results" tech="Google Ads campaigns" info="Cost comes from the Google Ads link (advertiserAdCost)." span={5}>
                {g.meta.config.googleAds ? <Table rows={camps} cols={[{ k: "key", label: "Campaign" }, { k: "clicks", label: "Clicks", num: true }, { k: "cost", label: "Cost", num: true, f: "money" }, { k: "leads", label: "Leads", num: true }, { k: "cpl", label: "Cost per lead", num: true, f: "money" }]} empty="No Google Ads clicks in this period." />
                  : <Missing why={`This GA4 property has no Google Ads link, so GA4 has no ad cost or clicks (advertiserAdCost). ${ch.find((r) => r.key === "Paid Search")?.sessions ? `GA4 still sees ${ch.find((r) => r.key === "Paid Search")!.sessions} Paid Search sessions and ${ch.find((r) => r.key === "Paid Search")!.leads} leads from them.` : ""}`} fix="In Google Ads: Tools → Data manager → Google Analytics (GA4) → Link this property (or in GA4 Admin → Product links → Google Ads links). Cost, clicks and cost per lead appear here from the next sync." />}
              </Card>
              <Card title="Link tracking problems" tech="UTM and tagging audit" sub="Problems that send traffic to the wrong channel.">
                <Table rows={issues} cols={[{ k: "issue", label: "Issue" }, { k: "example", label: "Example", wrap: true }, { k: "sessions", label: "Sessions", num: true }, { k: "fix", label: "Fix", wrap: true }]} empty="No tagging problems found in this period." />
              </Card>
            </Grid>
            <ScreenTasks screen="Acquisition" wins={forScreen(wins, "acq")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
