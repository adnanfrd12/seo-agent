import { PageHeader } from "@/components/dashboard/page-header";
import { ColChart } from "@/components/ga4x/charts";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { dfsMonthSpend } from "@/lib/aiqw/dfs";
import { clientSettings } from "@/lib/aiqw/run";
import { screenLabel } from "@/lib/aiqw/screens";
import { claudeMonthSpend, listRuns } from "@/lib/aiqw/store";
import type { RunState } from "@/lib/aiqw/types";

const scopeText = (r: RunState) => r.scope.kind === "site" ? "Whole site" : r.scope.kind === "screen" ? screenLabel(r.scope.screen) : r.scope.kind === "page" ? `Page ${r.scope.url}` : "One item";

/** Audit log of every run (who, scope, sources, counts, tokens, cost) and month-to-date spend. */
export default async function RunsPage() {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const [runs, claude, dfs, dfsQw, { settings }] = await Promise.all([listRuns(admin, client.id, 100), claudeMonthSpend(admin, client.id), dfsMonthSpend(admin, client.id), dfsMonthSpend(admin, client.id, true), clientSettings(admin, client.id)]);
  const month = new Date().toISOString().slice(0, 7);
  const mine = runs.filter((r) => r.startedAt.startsWith(month));
  const tok = mine.reduce((a, r) => ({ input: a.input + r.usage.input, output: a.output + r.usage.output, cache: a.cache + r.usage.cacheRead }), { input: 0, output: 0, cache: 0 });
  const byDay = new Map<string, number>();
  for (const r of mine) byDay.set(r.startedAt.slice(0, 10), (byDay.get(r.startedAt.slice(0, 10)) ?? 0) + r.usage.cost);
  const days = [...byDay].sort((a, b) => a[0].localeCompare(b[0]));
  const rows = runs.map((r) => ({
    when: new Date(r.startedAt).toLocaleString(), who: r.startedBy ?? (r.trigger === "nightly" ? "Nightly schedule" : "–"), scope: scopeText(r), depth: r.depth, sources: r.sources.length,
    status: r.status, statusTone: r.status === "done" ? "good" : r.status === "failed" ? "bad" : "warn",
    candidates: r.counts.candidates, kept: r.counts.kept, skipped: r.counts.skipped, rejected: r.counts.rejected, calls: r.usage.calls,
    tokens: r.usage.input + r.usage.cacheRead + r.usage.cacheWrite + r.usage.output, cache: r.usage.cacheRead, cost: r.usage.cost, dfs: r.usage.dfsCost, error: r.error ?? "",
  }));
  return (
    <>
      <PageHeader title="Runs and spend" description="Every quick-wins run, with tokens, cost and this month's spend." />
      <Kpis>
        <Kpi label="Claude spend this month" value={`$${claude.toFixed(2)}`} note={`budget $${settings.monthlyBudget.toFixed(2)}`} />
        <Kpi label="DataForSEO for quick wins, this month" value={`$${dfsQw.toFixed(2)}`} note={`limit $${settings.dfsMonthlyBudget.toFixed(2)} · all DataForSEO use $${dfs.toFixed(2)}`} />
        <Kpi label="Runs this month" value={String(mine.length)} />
        <Kpi label="Input tokens" value={tok.input.toLocaleString()} note="uncached, this month" />
        <Kpi label="Cache reads" value={tok.cache.toLocaleString()} note="billed at 10% of the input price" />
        <Kpi label="Output tokens" value={tok.output.toLocaleString()} />
      </Kpis>
      <Band title="Charts" />
      <Grid>
        <Card title="Claude spend by day" tech="Sum of logged run cost ($)" span={12}>
          <ColChart id="aiqw-spend" labels={days.map(([d]) => d.slice(5))} series={[{ name: "Claude $", color: "var(--cat-1)", values: days.map(([, v]) => Math.round(v * 1000) / 1000) }]} f="dec2" />
        </Card>
      </Grid>
      <Band title="Audit log" />
      <Grid>
        <Card title="Every run">
          <Table limit={30} rows={rows} facets={[{ k: "status", label: "Status" }, { k: "scope", label: "Scope" }]} empty="No runs yet." cols={[
            { k: "when", label: "Started" }, { k: "who", label: "By" }, { k: "scope", label: "Scope", wrap: true }, { k: "depth", label: "Depth" }, { k: "sources", label: "Sources", num: true },
            { k: "status", label: "Status", kind: "tag" }, { k: "candidates", label: "Candidates", num: true }, { k: "kept", label: "Kept", num: true }, { k: "skipped", label: "Skipped", num: true },
            { k: "rejected", label: "Rejected", num: true }, { k: "calls", label: "Calls", num: true }, { k: "tokens", label: "Tokens", num: true }, { k: "cache", label: "Cache reads", num: true },
            { k: "cost", label: "Claude $", num: true, f: "dec2" }, { k: "dfs", label: "DataForSEO $", num: true, f: "dec2" }, { k: "error", label: "Error", wrap: true },
          ]} />
        </Card>
      </Grid>
    </>
  );
}
