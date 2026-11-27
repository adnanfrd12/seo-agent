import Link from "next/link";
import { getSession } from "@/lib/analytics/client-context";
import { AUTO_SHARE, clientSpendOrZero, DEFAULT_DAILY_BUDGET, getSettings, orgSpendOrZero, PER_CLIENT_SHARE, spendHistory } from "@/lib/dataforseo/budget";
import { dfsBalance, dfsConfigured } from "@/lib/dataforseo/client";
import { clientOrgId } from "@/lib/org/config";
import { can } from "@/lib/org/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { StackedColumns } from "@/components/charts/ops-charts";
import { DataForSeoSettings } from "./dataforseo-settings";

/**
 * DataForSEO status for the client's organization (each organization uses its own DataForSEO account): credentials,
 * balance, today's spend against the organization's cap, and the last 7 days. Organization-wide figures and the limit
 * are for organization owners and admins; a client's own owners/admins see that client's spend.
 */
export async function DataForSeoCard({ canEdit, clientId }: { canEdit: boolean; clientId: string }) {
  const [{ organization }, orgId, configured] = await Promise.all([getSession(), clientOrgId(clientId), dfsConfigured(clientId)]);
  const orgAdmin = can.manageSettings(organization?.id === orgId ? organization.role : null);
  const admin = canEdit && configured ? createAdminClient() : null;
  const [balance, today, mine, history, targets, settings] = admin
    ? await Promise.all([
        orgAdmin ? dfsBalance(clientId) : null,
        orgAdmin ? orgSpendOrZero(admin, { orgId }) : 0,
        clientSpendOrZero(admin, clientId),
        orgAdmin ? spendHistory(admin, { orgId }, 7) : [],
        orgAdmin ? admin.from("research_targets").select("client_id, clients!inner(organization_id)", { count: "exact", head: true }).eq("auto_refresh", true).eq("clients.organization_id", orgId) : null,
        getSettings(admin, { orgId }),
      ])
    : [null, 0, 0, [], null, { dailyBudget: DEFAULT_DAILY_BUDGET, autoRefresh: true }];
  const cap = settings.dailyBudget;
  const pct = Math.min(100, (today / cap) * 100);

  return (
    <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="dfs-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="dfs-title" className="text-base font-semibold">DataForSEO</h2>
          <p className="text-sm text-muted">Backlinks, organic keywords and keyword research. Paid per request.</p>
        </div>
        <span className={configured ? "text-sm font-medium text-positive" : "text-sm text-negative"}>{configured ? "Connected" : "Not set up"}</span>
      </div>
      {!configured ? (
        <p className="mt-3 text-sm text-muted">An owner of this organization adds the DataForSEO API login and password (from DataForSEO → API Access) in Settings → Integrations.</p>
      ) : !canEdit ? (
        <p className="mt-3 text-sm text-muted">Spend details are visible to owners and admins.</p>
      ) : !orgAdmin ? (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">This client today</dt><dd>${mine.toFixed(2)} of ${(cap * PER_CLIENT_SHARE).toFixed(2)} per-client cap</dd>
          <dt className="text-muted">Daily limit</dt><dd>${cap.toFixed(2)} for the whole organization{settings.autoRefresh ? "" : " · automatic refresh off"}</dd>
        </dl>
      ) : (
        <>
          <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
          <div className="min-w-0">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Account balance</dt><dd>{balance != null ? `$${balance.toFixed(2)}` : "—"}</dd>
            <dt className="text-muted">Spent today</dt>
            <dd>${today.toFixed(2)} of ${cap.toFixed(2)} daily cap
              <span className="ml-2 inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted align-middle"><span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
            </dd>
            <dt className="text-muted">This client today</dt><dd>${mine.toFixed(2)} of ${(cap * PER_CLIENT_SHARE).toFixed(2)} per-client cap</dd>
            <dt className="text-muted">Automatic refresh</dt><dd>{settings.autoRefresh ? `${targets?.count ?? 0} clients, weekly, using at most $${(cap * AUTO_SHARE).toFixed(2)}/day of the limit` : "Off"}</dd>
          </dl>
          <DataForSeoSettings orgId={orgId} dailyBudget={cap} autoRefresh={settings.autoRefresh} defaultBudget={DEFAULT_DAILY_BUDGET} />
          </div>
          <StackedColumns title="Spend per day" sub={`Last 7 days, all clients of this organization · daily cap $${cap.toFixed(2)}`} format="usd" valueLabel="USD" empty="Nothing spent in the last 7 days."
            keys={[{ key: "auto", label: "Automatic", color: "var(--series)" }, { key: "manual", label: "Manual", color: "color-mix(in oklab, var(--series) 40%, var(--surface))" }]}
            columns={[...history].reverse().map((d) => ({ label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), values: { auto: d.auto, manual: d.manual } }))} />
          </div>
          {history.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-accent">Last 7 days</summary>
              <table className="mt-2 w-full max-w-md text-xs">
                <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">Automatic</th><th className="py-1 text-right font-medium">Manual</th><th className="py-1 text-right font-medium">Total</th></tr></thead>
                <tbody>{history.map((d) => (
                  <tr key={d.day} className="border-t border-border"><td className="py-1">{d.day}</td><td className="py-1 text-right tabular-nums">${d.auto.toFixed(2)}</td><td className="py-1 text-right tabular-nums">${d.manual.toFixed(2)}</td><td className="py-1 text-right tabular-nums">${d.total.toFixed(2)}</td></tr>
                ))}</tbody>
              </table>
            </details>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-muted">
        Open <Link href="/backlinks" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Backlinks</Link>, <Link href="/organic-keywords" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Organic Keywords</Link> or{" "}
        <Link href="/keyword-research" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Keyword Research</Link>. Opening pages never spends credit.
      </p>
    </section>
  );
}
