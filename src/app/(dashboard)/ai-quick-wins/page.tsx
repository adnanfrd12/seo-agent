import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { GeneratePanel } from "@/components/aiqw/generate-panel";
import { WinList } from "@/components/aiqw/win-list";
import { Band, Card, Grid, Kpi, Kpis } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import { pathOf } from "@/lib/gscx/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { dfsMonthSpend } from "@/lib/aiqw/dfs";
import { sourceStatus } from "@/lib/aiqw/platforms";
import { clientSettings } from "@/lib/aiqw/run";
import { activeRun, claudeMonthSpend, listRuns, loadItems } from "@/lib/aiqw/store";
import type { StoredWin } from "@/lib/aiqw/types";

// a run started from this page continues after the response (Claude calls in the background)
export const maxDuration = 300;

export default async function AiQuickWinsPage() {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const [items, runs, status, claude, dfs, { settings }, inv] = await Promise.all([
    loadItems(admin, client.id), listRuns(admin, client.id, 10), sourceStatus(admin, client.id), claudeMonthSpend(admin, client.id), dfsMonthSpend(admin, client.id, true), clientSettings(admin, client.id),
    admin.from("dfs_cache").select("params_hash, data").eq("client_id", client.id).eq("endpoint", "gscx").like("params_hash", "%:inventory").limit(1).maybeSingle(),
  ]);
  const canEdit = ["owner", "admin"].includes(client.role);
  // pages as quick wins name them: a path, or host + path for http:// and www. variants (pathOf keeps those apart),
  // so a one-page run can be pointed at any page a quick win can be about
  const isPage = (p: string) => (p.startsWith("/") || /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\//i.test(p)) && !p.includes("#");
  const pages = [...new Set([...((inv.data?.data as { url: string }[] | null) ?? []).map((r) => pathOf(r.url)), ...items.map((w) => w.page_url)].filter(isPage))].sort();
  const done = runs.filter((r) => r.status === "done" || r.status === "failed");
  const last = done[0] ?? null;
  const active = activeRun(runs)?.id ?? null;
  const open = items.filter((w) => (w.status === "todo" || w.status === "doing") && w.seen_run);
  const byKey = new Map(items.map((w) => [w.key, w]));
  const lastSite = done.find((r) => r.status === "done" && r.diff);
  const name = (k: string) => byKey.get(k)?.title ?? k;
  const list = (keys: string[]) => keys.slice(0, 6).map((k) => <li key={k} className="truncate">{name(k)}</li>);
  const gainSum = (u: StoredWin["gain_unit"]) => Math.round(open.filter((w) => w.gain_unit === u).reduce((a, w) => a + w.computed_gain, 0) * 10) / 10;

  return (
    <>
      <PageHeader title="AI quick wins" description="A ranked to-do list from your data, with ready-to-paste text." />
      <Kpis>
        <Kpi label="Open quick wins" value={String(open.length)} note={`${items.filter((w) => w.status === "done").length} done · ${items.filter((w) => w.status === "dismissed").length} dismissed`} />
        <Kpi label="Estimated gain, open items" value={`+${gainSum("clicks/mo")}`} note={`clicks/mo · +${gainSum("leads/mo")} leads/mo`} />
        <Kpi label="Claude spend this month" value={`$${claude.toFixed(2)}`} note={`of $${settings.monthlyBudget.toFixed(2)} budget · ${settings.model}`} />
        <Kpi label="DataForSEO for quick wins, this month" value={`$${dfs.toFixed(2)}`} note={`limit $${settings.dfsMonthlyBudget.toFixed(2)}`} />
        <Kpi label="Last run" value={last ? new Date(last.startedAt).toLocaleDateString() : "Never"} note={last ? `${last.trigger} · ${last.status} · $${last.usage.cost.toFixed(3)}` : "Press Generate"} />
        <Kpi label="Nightly run" value={settings.nightly ? "On" : "Off"} note={<Link href="/ai-quick-wins/settings" className="underline">Change in settings</Link>} />
      </Kpis>
      <span id="generate" className="block scroll-mt-20" aria-hidden />
      <Band title="Generate" />
      <GeneratePanel status={status} pages={pages} lastRun={last ? { at: last.startedAt, trigger: last.trigger, kept: last.counts.kept, cost: last.usage.cost } : null}
        latest={runs[0] ?? null} recent={runs[0] ? items.filter((w) => w.run_id === runs[0].id && w.seen_run && w.rank > 0).sort((a, b) => a.rank - b.rank).slice(0, 5) : []} activeRun={active} canEdit={canEdit} />
      {lastSite?.diff && (
        <>
          <Band title="What changed since the last run" sub={`Run of ${new Date(lastSite.startedAt).toLocaleString()}`} />
          <Grid>
            <Card title="New" tech={`${lastSite.diff.added.length} items`} span={3}><ul className="space-y-1 text-sm">{list(lastSite.diff.added)}</ul></Card>
            <Card title="Still open" tech={`${lastSite.diff.stillOpen.length} items`} span={3}><ul className="space-y-1 text-sm">{list(lastSite.diff.stillOpen)}</ul></Card>
            <Card title="Resolved by the data" tech={`${lastSite.diff.resolved.length} items`} span={3}><ul className="space-y-1 text-sm">{list(lastSite.diff.resolved)}</ul></Card>
            <Card title="Not repeated" tech={`${lastSite.diff.gone.length} items`} sub="Still in the data, but not sent or skipped this time" span={3}><ul className="space-y-1 text-sm">{list(lastSite.diff.gone)}</ul></Card>
          </Grid>
        </>
      )}
      <Band title="Quick wins" sub="Ranked by estimated gain × confidence ÷ effort." />
      <WinList wins={items} canEdit={canEdit} />
    </>
  );
}
