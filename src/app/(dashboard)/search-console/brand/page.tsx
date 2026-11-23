import { BarList, CalHeat, CompareBars, Donut, LineChart } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { GscSettingsForm } from "@/components/ga4x/gsc-settings";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Missing } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import type { SearchParams } from "@/lib/analytics/url";
import { queryTable } from "@/lib/gscx/analysis";
import { addDays, groupM, m } from "@/lib/gscx/g";
import { alt, isQuestion, lev } from "@/lib/gscx/model";
import { saveGscSettings } from "../gscx-actions";
import { GscScreen } from "../_gscx/screen";
import { labels, QueryTable, siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/brand";

export default async function BrandPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { client } = await getSession();
  const canEdit = !!client && ["owner", "admin"].includes(client.role);
  return (
    <GscScreen sp={sp} path={PATH} title="Brand" description="People searching the business by name vs finding it by topic, what they add to the name, and reputation checks.">
      {({ g, wins, settingsSource }) => {
        const setForm = <Card title="Brand, competitor, city and service lists" sub="Every brand, competitor, city and service number on these screens comes from these lists (case-insensitive, whole words). Edit them to match the business."><GscSettingsForm initial={g.settings} sources={settingsSource} action={saveGscSettings} disabled={!canEdit} /></Card>;
        if (!g.settings.brand.length) return <><Missing title="No brand terms" why="Brand numbers need the business name and its variants, and none could be found." fix="Add brand terms below (business name, misspellings, domain, owner's name)." /><div className="mt-4"><Grid>{setForm}</Grid></div></>;
        const qc = g.q(), qprev = g.q(true);
        const B = m(qc.filter((x) => g.isBrand(String(x.query)))), N2 = m(qc.filter((x) => !g.isBrand(String(x.query))));
        const Bp = m(qprev.filter((x) => g.isBrand(String(x.query)))), Np = m(qprev.filter((x) => !g.isBrand(String(x.query))));
        const tot = g.totals(), hidden = Math.max(0, tot.clicks - B.clicks - N2.clicks);
        const brandQs = [...g.queries()].filter(([q]) => g.isBrand(q)), brandQsP = [...g.queries(true)].filter(([q]) => g.isBrand(q));
        const strip = new RegExp(`\\b(${alt(g.settings.brand)})\\b`, "gi");
        const rest = (q: string) => q.replace(strip, " ").replace(/\s+/g, " ").trim();
        const mods = new Map<string, number>();
        for (const [q, v] of brandQs) for (const w of rest(q).split(" ").filter((x) => x.length > 1)) mods.set(w, (mods.get(w) ?? 0) + v.impressions);
        const GROUPS: [string, RegExp][] = [["Reviews", /\b(reviews?|rating|ratings|yelp|google)\b/i], ["Phone / contact", /\b(phone|number|contact|call|email|address|hours)\b/i], ["City / location", new RegExp(`\\b(${alt(g.settings.cities)}|near|location|directions)\\b`, "i")], ["Cost", /\b(cost|price|prices|pricing|quote|how much)\b/i], ["Legit / trust", /\b(legit|scam|bbb|complaints?|lawsuit)\b/i], ["Services", new RegExp(`\\b(${alt(g.settings.services)})`, "i")], ["Owner / jobs", /\b(owner|ceo|founder|jobs?|careers?|hiring)\b/i]];
        const grp = (xs: typeof brandQs) => GROUPS.map(([, re]) => xs.filter(([q]) => re.test(rest(q))).reduce((a, [, v]) => a + v.impressions, 0));
        const gc = grp(brandQs), gp = grp(brandQsP);
        const s90 = addDays(g.meta.end, -89), bd = groupM(g.Q.filter((x) => String(x.date) >= s90 && g.isBrand(String(x.query))), (x) => String(x.date));
        const daily = (pred: (q: string) => boolean) => g.daily(qc.filter((x) => pred(String(x.query))), (x) => Number(x.clicks));
        // misspellings: query tokens 1-2 edits from a one-word brand term, not already brand terms
        const terms = g.settings.brand.filter((t) => !t.includes(" ") && t.length >= 5);
        const miss = [...g.queries()].filter(([q]) => !g.isBrand(q)).flatMap(([q, v]) => { const d = Math.min(...q.split(/\s+/).flatMap((tok) => terms.map((t) => lev(tok, t)))); const d2 = Math.min(...terms.map((t) => lev(q.replace(/\s+/g, ""), t))); const dist = Math.min(d, d2); return dist >= 1 && dist <= 2 ? [{ q, impr: v.impressions, d: dist }] : []; }).sort((a, b) => b.impr - a.impr);
        const trust = queryTable(g, (q) => g.isBrand(q) && (isQuestion(q) || /\b(legit|scam|reviews?|bbb|complaints?|rating)\b/i.test(q)));
        return (
          <>
            <Kpis>
              <Kpi label="Clicks from searches for your name" tech="Brand clicks" value={fmt("int", B.clicks)} cur={B.clicks} prev={Bp.clicks} />
              <Kpi label="Clicks from topic searches" tech="Non-brand clicks" value={fmt("int", N2.clicks)} cur={N2.clicks} prev={Np.clicks} />
              <Kpi label="Share from your name" tech="Brand share" value={fmt("pct", B.clicks + N2.clicks ? B.clicks / (B.clicks + N2.clicks) : 0)} />
              <Kpi label="Searches for your name" tech="Brand queries" value={fmt("int", brandQs.length)} cur={brandQs.length} prev={brandQsP.length} />
            </Kpis>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="People searching your name vs finding you by topic" tech="Brand vs non-brand clicks" sub="Daily. Brand demand is a proxy for word of mouth and offline marketing." span={8}>
                <LineChart id="gsc-brand-daily" labels={labels(g)} series={[{ name: "Brand", values: daily(g.isBrand), color: C[4] }, { name: "Non-brand", values: daily((q) => !g.isBrand(q)), color: C[0] }]} />
              </Card>
              <Card title="What people type along with your business name" tech="What people search with the brand" sub="Words next to the brand name, by impressions." span={4}>
                <BarList rows={[...mods].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w, v]) => ({ label: w, value: v, color: C[4] }))} empty="People search the name on its own, with no extra words." />
              </Card>
              <Card title="Where clicks come from: your name, topics, private searches" tech="Clicks: brand, non-brand, hidden" sub="Hidden = anonymized queries that can't be classified." span={5}>
                <Donut parts={[{ label: "Brand", value: B.clicks, color: C[4] }, { label: "Non-brand", value: N2.clicks, color: C[0] }, { label: "Hidden", value: hidden, color: "var(--cat-other)" }]} />
              </Card>
              <Card title="Words added to your name: this month vs last" tech="Brand modifiers: this period vs last" sub="Impressions." span={7}>
                <CompareBars color={C[4]} rows={GROUPS.map(([l], i) => ({ label: l, cur: gc[i], prev: gp[i] }))} />
              </Card>
              <Card title="Clicks from people searching your name, each day" tech="Brand clicks calendar" sub="Daily brand clicks over 90 days. Spikes often follow ads, mailers or events.">
                <CalHeat values={Array.from({ length: 90 }, (_, i) => bd.get(addDays(s90, i))?.clicks ?? 0)} start={s90} color={C[4]} label="brand clicks" />
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Questions people ask about your business" tech="Brand questions and trust checks" sub="Brand queries that are questions or reputation checks." span={8}>
                <QueryTable rows={trust} site={siteOf(g)} empty="0: nobody searched the business name as a question or a reputation check in this period." />
              </Card>
              <Card title="Misspellings of your business name" tech="Possible misspellings" sub="Queries 1–2 letters away from the brand, not yet in the brand list." span={4}>
                <Table rows={miss.map((x) => ({ q: x.q, impr: x.impr, d: x.d }))} cols={[{ k: "q", label: "Query", wrap: true }, { k: "impr", label: "Impr.", num: true }, { k: "d", label: "Edit distance", num: true }]} empty="No misspellings found: add any you know to the brand list." />
              </Card>
              <Card title="Searches for your name where you're not first" tech="Brand queries not at position 1" sub="Brand searches where another page or site may outrank you.">
                <QueryTable rows={queryTable(g, g.isBrand).filter((r) => r.pos >= 1.5)} site={siteOf(g)} empty="The site ranks first for every brand search." />
              </Card>
              {setForm}
            </Grid>
            <Tasks screen="Brand" id="brand" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
