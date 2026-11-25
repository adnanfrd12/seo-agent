import Link from "next/link";
import { StackedColumns } from "@/components/charts/ops-charts";
import { claudeUsage } from "@/lib/ai/usage";
import { clientSettings } from "@/lib/aiqw/run";
import { MODELS } from "@/lib/aiqw/settings";
import { claudeMonthSpend } from "@/lib/aiqw/store";
import { createAdminClient } from "@/lib/supabase/admin";

const usd = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
const modelName = (id: string) => (id in MODELS ? MODELS[id as keyof typeof MODELS].label.replace(/ \(.*\)$/, "") : id.replace(/^claude-(\w)/, (_, c: string) => `Claude ${c.toUpperCase()}`).replace(/-(\d)-(\d)$/, " $1.$2"));

/** Claude (Anthropic API): the model in use, the monthly budget, and spend in total, this month, today and by feature. */
export async function ClaudeCard({ canEdit, clientId, timezone }: { canEdit: boolean; clientId: string; timezone: string }) {
  const configured = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const admin = canEdit && configured ? createAdminClient() : null;
  const [settingsRow, usage, budgetUsed] = admin
    ? await Promise.all([clientSettings(admin, clientId), claudeUsage(admin, clientId, timezone), claudeMonthSpend(admin, clientId)])
    : [null, null, 0];
  const settings = settingsRow?.settings;
  const budget = settings?.monthlyBudget ?? 0;
  const pct = budget ? Math.min(100, (budgetUsed / budget) * 100) : 0;

  return (
    <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="claude-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="claude-title" className="text-base font-semibold">Claude (Anthropic)</h2>
          <p className="text-sm text-muted">Writes Nova&apos;s answers, the SEO roadmap, AI quick wins, insights, the 30-day strategy, the SEO Coach and the SEO Toolkit, and reads PDF reports and blog posts. Paid per use.</p>
        </div>
        <span className={configured ? "text-sm font-medium text-positive" : "text-sm text-negative"}>{configured ? "Connected" : "Not configured"}</span>
      </div>
      {!configured ? (
        <p className="mt-3 text-sm text-muted">Add ANTHROPIC_API_KEY (from the Anthropic Console) to the environment and redeploy.</p>
      ) : !canEdit || !usage || !settings ? (
        <p className="mt-3 text-sm text-muted">Model and spend details are visible to owners and admins.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Spent today", usd(usage.today), "this client"],
              ["This month", usd(usage.month), new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: timezone })],
              ["Total spent", usd(usage.total), usage.since ? `since ${new Date(usage.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${usage.calls} runs` : "nothing yet"],
              ["Model", modelName(settings.model), `effort ${settings.effort}`],
            ].map(([label, value, sub]) => (
              <div key={label} className="rounded-lg border border-hairline bg-surface-sunken px-4 py-3">
                <p className="text-xs font-medium text-muted">{label}</p>
                <p className="mt-1 text-[22px] font-semibold leading-tight tabular-nums">{value}</p>
                <p className="mt-0.5 truncate text-[11px] text-faint">{sub}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-4 text-sm">
              <div>
                <p className="flex items-baseline justify-between gap-3"><span className="font-medium">Monthly budget</span><span className="tabular-nums text-secondary">{usd(budgetUsed)} of {usd(budget)} used</span></p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className={pct >= 90 ? "h-full rounded-full bg-negative" : "h-full rounded-full bg-accent"} style={{ width: `${pct}%` }} /></div>
                <p className="mt-1 text-xs text-muted">When it&apos;s used up, Nova, AI runs, the toolkit&apos;s AI tools and blog post reading pause until next month. Change the model, effort and budget in <Link href="/ai-quick-wins/settings" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">AI and data settings</Link>.</p>
              </div>
              <div>
                <p className="font-medium">By feature</p>
                <ul className="mt-1.5 space-y-1">{usage.byFeature.length ? usage.byFeature.map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-3 border-b border-hairline pb-1 last:border-0"><span className="text-secondary">{k}</span><span className="tabular-nums">{usd(v)}</span></li>
                )) : <li className="text-muted">Nothing spent yet.</li>}</ul>
              </div>
              {usage.byModel.length > 0 && (
                <div>
                  <p className="font-medium">By model</p>
                  <ul className="mt-1.5 space-y-1">{usage.byModel.map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-3 border-b border-hairline pb-1 last:border-0"><span className="text-secondary">{k === "Model from AI settings" ? `${modelName(settings.model)} (Nova)` : modelName(k)}</span><span className="tabular-nums">{usd(v)}</span></li>
                  ))}</ul>
                </div>
              )}
            </div>
            <StackedColumns title="Spend per day" sub="Last 7 days, this client" format="usd" valueLabel="USD" empty="Nothing spent in the last 7 days."
              keys={[{ key: "cost", label: "Claude", color: "var(--series)" }]}
              columns={usage.perDay.map((d) => ({ label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), values: { cost: d.cost } }))} />
          </div>
          <p className="mt-3 text-xs text-muted">Every Claude feature records its own cost when it runs: Nova, the roadmap, AI quick wins, insights, strategy, SEO Coach, PDF report reading, blog post reading and the SEO Toolkit. Blog and toolkit costs are recorded from Nov 25, 2026. All of it counts toward the monthly budget.</p>
        </>
      )}
    </section>
  );
}
