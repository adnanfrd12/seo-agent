import { PageHeader } from "@/components/dashboard/page-header";
import { BarList } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { ruleLabel } from "@/lib/aiqw/labels";
import { loadCandidates } from "@/lib/aiqw/store";

/** Debug view: the last run's candidates (found by code, before Claude) with their facts and counts per rule. */
export default async function CandidatesPage() {
  const { client } = await getSession();
  if (!client) return null;
  const last = await loadCandidates(createAdminClient(), client.id);
  const sent = new Set(last?.sent ?? []);
  const rows = (last?.candidates ?? []).map((c) => ({
    id: c.candidate_id, rule: ruleLabel(c.rule), page: c.page_url, gain: c.computed_gain, unit: c.gain_unit, effort: c.effort_hint, sent: sent.has(c.candidate_id) ? "Sent" : "Not sent",
    sources: c.sources.join(", "), facts: c.facts.map((f) => `${f.name}: ${f.value}`).join(" · ").slice(0, 600), queries: c.queries.map((q) => q.query).slice(0, 5).join(", "),
  }));
  return (
    <>
      <PageHeader title="Candidates (debug)" description="What the rules found before Claude saw anything: every number here is computed in code from the APIs. The last run sent the ones marked Sent." />
      <Kpis>
        <Kpi label="Candidates found" value={String(rows.length)} note={last ? `run of ${new Date(last.at).toLocaleString()}` : "no run yet"} />
        <Kpi label="Sent to Claude" value={String(sent.size)} note="top 150 whole site · 40 per screen · all for one page" />
        <Kpi label="Rules that fired" value={String(Object.keys(last?.perRule ?? {}).length)} />
      </Kpis>
      <Band title="Counts per rule" />
      <Grid>
        <Card title="Candidates per rule" span={12}>
          <BarList rows={Object.entries(last?.perRule ?? {}).sort((a, b) => b[1] - a[1]).map(([r, n], i) => ({ label: ruleLabel(r), value: n, color: C[i % C.length] }))} empty="0: no run yet." />
        </Card>
      </Grid>
      <Band title="Candidates" sub="Filter by rule or by whether the last run sent it." />
      <Grid>
        <Card title="Every candidate with its facts">
          <Table limit={40} rows={rows} facets={[{ k: "rule", label: "Rule" }, { k: "sent", label: "Sent" }]} empty="0 candidates: run Generate quick wins first." cols={[
            { k: "rule", label: "Rule" }, { k: "page", label: "Page", wrap: true }, { k: "gain", label: "Gain", num: true, f: "dec1" }, { k: "unit", label: "Unit" }, { k: "effort", label: "Effort" },
            { k: "sent", label: "Sent" }, { k: "sources", label: "Sources" }, { k: "queries", label: "Queries", wrap: true }, { k: "facts", label: "Facts", wrap: true },
          ]} />
        </Card>
      </Grid>
    </>
  );
}
