import { Table, type Col } from "@/components/ga4x/table";
import { ScreenTasks } from "@/components/ga4x/ui";
import type { QRow } from "@/lib/gscx/analysis";
import { addDays, type G } from "@/lib/gscx/g";
import { pathOf } from "@/lib/gscx/model";
import { gscForScreen, type GscWin } from "@/lib/gscx/quickwins";

export const sd = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const labels = (g: G) => Array.from({ length: g.p.days }, (_, i) => sd(addDays(g.p.start, i)));
export const weekOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

/** The standard query table: Query | Clicks | Δ clicks | Impressions | CTR | Position | Δ pos | Landing page. */
export function QueryTable({ rows, limit = 15, empty, site }: { rows: QRow[]; limit?: number; empty?: string; site?: string }) {
  const cols: Col[] = [{ k: "query", label: "Query", wrap: true }, { k: "clicks", label: "Clicks", num: true }, { k: "dClicks", label: "Δ clicks", num: true }, { k: "impressions", label: "Impressions", num: true },
    { k: "ctr", label: "CTR", num: true, f: "pct" }, { k: "pos", label: "Position", num: true, f: "dec1" }, { k: "dPos", label: "Δ pos", num: true, f: "dec1" }, { k: "page", label: "Landing page", kind: "page" }];
  return <Table site={site} limit={limit} empty={empty} cols={cols} rows={rows.map((r) => ({ query: r.query, clicks: r.clicks, dClicks: r.dClicks, impressions: r.impressions, ctr: r.ctr, pos: r.pos, dPos: r.dPos, page: pathOf(r.page) }))} />;
}
export const siteOf = (g: G) => { const u = g.inv[0]?.url; try { return u ? new URL(u).origin : `https://${g.meta.site.replace(/^sc-domain:/, "")}`; } catch { return undefined; } };

export function Tasks({ screen, id, wins }: { screen: string; id: string; wins: GscWin[] }) {
  return <ScreenTasks screen={screen} wins={gscForScreen(wins, id)} unit="clicks/mo" href="/search-console/quick-wins" />;
}
