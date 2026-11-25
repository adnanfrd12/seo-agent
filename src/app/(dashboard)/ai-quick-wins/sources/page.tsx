import { PageHeader } from "@/components/dashboard/page-header";
import { SourceBadge } from "@/components/aiqw/badges";
import { Tag } from "@/components/ga4x/table";
import { Band, Card, Grid } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceStatus } from "@/lib/aiqw/platforms";
import { SOURCE_INFO } from "@/lib/aiqw/sources-info";
import { loadItems } from "@/lib/aiqw/store";
import { SOURCES } from "@/lib/aiqw/types";

/** Every platform and data source the portal uses, what each adds to quick wins, and whether it holds data for this client. */
export default async function SourcesPage() {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const [st, items] = await Promise.all([sourceStatus(admin, client.id), loadItems(admin, client.id)]);
  const used = (s: string) => items.filter((w) => (w.status === "todo" || w.status === "doing") && w.seen_run && (w.sources as string[]).includes(s)).length;
  return (
    <>
      <PageHeader title="Data sources" description="What each data source adds to quick wins." />
      <Band title="Sources" sub={`${SOURCES.filter((s) => st[s].ok).length} of ${SOURCES.length} hold data for ${client.name}.`} />
      <Grid>
        <Card title="What each source adds">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead><tr className="border-b border-border text-xs text-muted"><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">What it adds</th><th className="py-2 pr-3 font-medium">Rules it feeds</th><th className="py-2 pr-3 font-medium">Example</th><th className="py-2 text-right font-medium">Open items</th></tr></thead>
              <tbody>
                {SOURCES.map((s) => (
                  <tr key={s} className="border-b border-hairline align-top">
                    <td className="py-2 pr-3"><SourceBadge s={s} /></td>
                    <td className="py-2 pr-3"><Tag tone={st[s].ok ? "good" : "warn"}>{st[s].ok ? "Data" : "No data"}</Tag><span className="mt-0.5 block text-xs text-muted">{st[s].note}</span></td>
                    <td className="py-2 pr-3">{SOURCE_INFO[s].adds}</td>
                    <td className="py-2 pr-3 text-secondary">{SOURCE_INFO[s].rules}</td>
                    <td className="py-2 pr-3 text-xs text-muted">{SOURCE_INFO[s].example}</td>
                    <td className="py-2 text-right tabular-nums">{used(s)}</td>
                  </tr>
                ))}
                <tr className="align-top"><td className="py-2 pr-3"><SourceBadge s="claude" /></td><td className="py-2 pr-3"><Tag tone="acc">API</Tag></td><td className="py-2 pr-3">Prioritises, writes the title, steps and suggested text, explains why and groups related changes. Never invents numbers or pages.</td><td className="py-2 pr-3 text-secondary">All rules</td><td className="py-2 pr-3 text-xs text-muted">Rewrite the title to: Channel Letters in Houston | LED Lights and Signs</td><td className="py-2 text-right tabular-nums">{items.filter((w) => w.seen_run && (w.status === "todo" || w.status === "doing")).length}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      </Grid>
    </>
  );
}
