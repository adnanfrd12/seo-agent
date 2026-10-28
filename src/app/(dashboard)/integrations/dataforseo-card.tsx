import Link from "next/link";
import { AUTO_SHARE, dailyBudget, PER_CLIENT_DAILY, spendHistory, spendOrZero } from "@/lib/dataforseo/budget";
import { dfsBalance, dfsConfigured } from "@/lib/dataforseo/client";
import { createAdminClient } from "@/lib/supabase/admin";

/** DataForSEO status: credentials, balance, today's spend against the cap, and the last 7 days. */
export async function DataForSeoCard({ canEdit, clientId }: { canEdit: boolean; clientId: string }) {
  const configured = dfsConfigured();
  const admin = canEdit && configured ? createAdminClient() : null;
  const [balance, today, mine, history, targets] = admin
    ? await Promise.all([
        dfsBalance(), spendOrZero(admin), spendOrZero(admin, clientId), spendHistory(admin, 7),
        admin.from("research_targets").select("client_id", { count: "exact", head: true }).eq("auto_refresh", true),
      ])
    : [null, 0, 0, [], null];
  const cap = dailyBudget();
  const pct = Math.min(100, (today / cap) * 100);

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-5" aria-labelledby="dfs-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="dfs-title" className="text-base font-semibold">DataForSEO</h2>
          <p className="text-sm text-muted">Backlinks, organic keywords and keyword research. Paid per request, so every call is stored and capped.</p>
        </div>
        <span className={configured ? "text-sm font-medium text-positive" : "text-sm text-negative"}>{configured ? "Connected" : "Not configured"}</span>
      </div>
      {!configured ? (
        <p className="mt-3 text-sm text-muted">Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (from DataForSEO → API Access) to the environment and redeploy.</p>
      ) : !canEdit ? (
        <p className="mt-3 text-sm text-muted">Spend details are visible to owners and admins.</p>
      ) : (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Account balance</dt><dd>{balance != null ? `$${balance.toFixed(2)}` : "—"}</dd>
            <dt className="text-muted">Spent today</dt>
            <dd>${today.toFixed(2)} of ${cap.toFixed(2)} daily cap
              <span className="ml-2 inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted align-middle"><span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
            </dd>
            <dt className="text-muted">This client today</dt><dd>${mine.toFixed(2)} of ${Math.min(PER_CLIENT_DAILY, cap).toFixed(2)} per-client cap</dd>
            <dt className="text-muted">Automatic refresh</dt><dd>{targets?.count ?? 0} clients, weekly, using at most ${(cap * AUTO_SHARE).toFixed(2)}/day of the cap</dd>
          </dl>
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
        Open <Link href="/backlinks" className="text-accent hover:underline">Backlinks</Link>, <Link href="/organic-keywords" className="text-accent hover:underline">Organic Keywords</Link> or{" "}
        <Link href="/keyword-research" className="text-accent hover:underline">Keyword Research</Link>. Opening pages never spends credit. Raise or lower the cap with DATAFORSEO_DAILY_BUDGET_USD.
      </p>
    </section>
  );
}
