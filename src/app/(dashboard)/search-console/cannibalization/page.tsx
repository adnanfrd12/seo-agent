import { Sankey, Stack100 } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Insight, Missing } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { cannibal } from "@/lib/gscx/analysis";
import { addDays } from "@/lib/gscx/g";
import { pathOf } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { sd, siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/cannibalization";
const P = (v: number) => `${Math.round(v * 100)}%`;

export default async function CannibalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Cannibalization" description="Searches where your own pages compete with each other.">
      {({ g, wins }) => {
        const cs = cannibal(g);
        const top = cs[0];
        const flows: [string, string, number][] = cs.slice(0, 8).flatMap((c) => c.pages.map((p) => [c.query.length > 30 ? `${c.query.slice(0, 29)}…` : c.query, pathOf(p.page), p.impressions] as [string, string, number]));
        const from = addDays(g.meta.end, -55);
        const tPages = top ? top.pages.map((p) => p.page) : [];
        const fixes = cs.slice(0, 6).map((c) => {
          const [a, b] = c.pages;
          const home = c.pages.find((p) => pathOf(p.page) === "/");
          const text = home && home !== a ? `The home page takes ${P(home.share)} of "${c.query}". Add a link from the home page to ${pathOf(a.page)} and remove the term from the home title/H1.`
            : b.share < 0.3 ? `Merge the useful parts of ${pathOf(b.page)} into ${pathOf(a.page)} and 301 redirect it, or make ${pathOf(b.page)} clearly about a different topic.`
            : `Decide which page should own "${c.query}" (${pathOf(a.page)} has ${P(a.share)}, ${pathOf(b.page)} ${P(b.share)}). Point internal links with this anchor text at the owner and take the term out of the other page's title.`;
          return { tone: (c.switches >= 3 ? "bad" : "warn") as "bad" | "warn", title: `"${c.query}"`, text, when: `${c.pages.length} pages · ${c.switches} switch${c.switches === 1 ? "" : "es"} in 8 weeks` };
        });
        return (
          <>
            <Grid>
              <Card title="How to fix it" tech="Suggested fixes">
                {fixes.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{fixes.map((f) => <Insight key={f.title} {...f} />)}</div>
                  : <p className="text-sm text-muted">No search is split between two of your pages (each holding 10%+ of its impressions) in this period.</p>}
              </Card>
            </Grid>
            <Band title="Charts" />
            <Grid>
              <Card title="Searches split between your own pages" tech="Query → competing pages" info="Impressions flowing from each query to the pages Google showed." span={7}>
                {flows.length ? <Sankey flows={flows} rightColor={C[1]} /> : <Missing why="No search had two of your pages each holding 10%+ of its impressions (20+ impressions)." fix="Nothing to fix; this fills in if pages start competing." />}
              </Card>
              <Card title="Google keeps switching which page it shows" tech="Ranking page switches, weekly" sub={top ? `Which page Google showed for '${top.query}' each week (share of impressions).` : "Weekly share of impressions per page for the most split query."} span={5}>
                {top ? <Stack100 rows={top.weekly.map((w) => ({ label: `Week of ${sd(addDays(from, w.w * 7))}`, parts: tPages.map((p) => w.pages[p] ?? 0) }))} names={tPages.map(pathOf)} /> : <Missing why="No competing pages in this period." fix="Nothing to fix." />}
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Your own pages competing against each other" tech="Queries ranking with several pages" info="Each query's impressions split across competing pages, and how often the ranking page switched in 8 weeks.">
                <Table site={siteOf(g)} limit={30} rows={cs.flatMap((c) => c.pages.map((p) => ({ q: c.query, page: pathOf(p.page), share: p.share, pos: p.pos, sw: c.switches })))} cols={[{ k: "q", label: "Query", wrap: true }, { k: "page", label: "Page", kind: "page" }, { k: "share", label: "Share of impressions", num: true, f: "pct", bar: C[1] }, { k: "pos", label: "Position", num: true, f: "dec1" }, { k: "sw", label: "Page switches", num: true }]} empty="0: no query is split between your own pages." />
              </Card>
            </Grid>
            <Tasks screen="Cannibalization" id="cannibal" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
