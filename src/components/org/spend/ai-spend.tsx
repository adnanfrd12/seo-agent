"use client";

import { Panel } from "@/components/charts/ai-charts";
import type { AiClientRow, AiSpendReport, SpendItem } from "@/lib/org/spend";
import { SpendChart } from "./chart";
import { count, csvName, downloadCsv, monthLabel, rangeLong, raw, share, usd, usdUnit } from "./format";
import { SpendKpis } from "./kpis";
import { SpendShell } from "./shell";
import { SpendTable, type Column } from "./table";
import { BudgetTag, Change, CsvButton, Meter, Notice, RankedBars, Row } from "./ui";

/**
 * Organization settings → AI spend: Claude spend of every client of the organization (archived ones included),
 * by day or month, feature, model and client, with each client's monthly Claude budget. Owners and admins only
 * (the data route checks the role on the server).
 */
export function AiSpend({ orgId }: { orgId: string }) {
  return <SpendShell<AiSpendReport> orgId={orgId} kind="ai">{(r) => <AiView r={r} />}</SpendShell>;
}

const OTHER = "var(--cat-other)";

function itemRows(items: SpendItem[], note: Record<string, string> = {}) {
  return items.map((i) => ({
    key: i.key, label: i.label, value: i.cost, color: i.color ?? OTHER,
    right: <span className="inline-flex items-baseline gap-2">{usd(i.cost)}<Change cur={i.cost} prev={i.prevCost} /></span>,
    sub: (i.count ? `${count(i.count)} run${i.count === 1 ? "" : "s"} · ${share(i.share)} · ${usdUnit(i.cost / i.count)} each · ${count(i.clients)} client${i.clients === 1 ? "" : "s"}` : `Nothing this period · ${usd(i.prevCost)} before`) + (note[i.key] ? ` · ${note[i.key]}` : ""),
  }));
}
const itemsCsv = (name: string, first: string, items: SpendItem[]) => () => downloadCsv(name, [first, "Spend (USD)", "Runs", "Share", "Average per run (USD)", "Clients", "Previous period (USD)", "Previous runs", "Last run (UTC)"],
  items.map((i) => [i.label, raw(i.cost), i.count, raw(i.share), i.count ? raw(i.cost / i.count) : "", i.clients, raw(i.prevCost), i.prevCount, i.last ?? ""]));

const STATUS_ORDER = { over: 0, near: 1, ok: 2, off: 3 } as const;
const STATUS_TEXT = { over: "Over budget", near: "Near the limit", ok: "Within budget", off: "Claude off" } as const;

function AiView({ r }: { r: AiSpendReport }) {
  const p = r.period, range = rangeLong(p.range).toLowerCase();
  const span = `${p.start}_${p.end}`;
  const month = monthLabel(r.budget.month, true);
  const watch = r.clients.filter((c) => !c.archived && c.status !== "off" && c.monthSpent > 0).sort((a, b) => (b.used ?? 0) - (a.used ?? 0));
  const top = r.clients.filter((c) => c.cost > 0);
  const cols: Column<AiClientRow>[] = [
    { key: "name", label: "Client", value: (c) => c.name, csv: (c) => (c.archived ? `${c.name} (archived)` : c.name),
      render: (c) => <span className="inline-flex min-w-[10rem] flex-wrap items-center gap-1.5">{c.name}{c.archived && <span className="rounded-full bg-surface-muted px-1.5 py-px text-[10.5px] font-medium text-muted">Archived</span>}</span> },
    { key: "runs", label: "Runs", num: true, value: (c) => c.runs, render: (c) => count(c.runs) },
    { key: "cost", label: "Spend", num: true, value: (c) => c.cost, csv: (c) => raw(c.cost), render: (c) => usd(c.cost) },
    { key: "share", label: "Share", num: true, value: (c) => c.share, csv: (c) => raw(c.share), render: (c) => share(c.share) },
    { key: "prev", label: "vs previous", num: true, value: (c) => (c.prevCost ? (c.cost - c.prevCost) / c.prevCost : c.cost ? Infinity : 0), csv: (c) => (c.prevCost ? raw((c.cost - c.prevCost) / c.prevCost) : ""), render: (c) => <Change cur={c.cost} prev={c.prevCost} /> },
    { key: "prevCost", label: "Previous period (USD)", value: (c) => raw(c.prevCost), csvOnly: true },
    { key: "top", label: "Top feature", value: (c) => c.topFeature, render: (c) => (c.topFeature ? <span className="whitespace-nowrap">{c.topFeature}</span> : <span className="text-faint">—</span>) },
    { key: "month", label: `${monthLabel(r.budget.month)} (UTC)`, num: true, value: (c) => c.monthSpent, csv: (c) => raw(c.monthSpent), render: (c) => usd(c.monthSpent) },
    { key: "budget", label: "Budget", num: true, value: (c) => c.budget, render: (c) => usd(c.budget) },
    { key: "used", label: "Used", num: true, value: (c) => c.used, csv: (c) => (c.used == null ? "" : raw(c.used)),
      render: (c) => (c.used == null ? <span className="text-faint">—</span> : <span className="inline-flex items-center gap-2"><Meter value={c.monthSpent} max={c.budget} className="w-14" />{share(c.used)}</span>) },
    { key: "status", label: "Budget status", value: (c) => STATUS_ORDER[c.status], csv: (c) => STATUS_TEXT[c.status], render: (c) => <BudgetTag status={c.status} /> },
  ];

  return (
    <div className="space-y-4">
      {r.counts.clients === 0 && <Notice>This organization has no clients yet. Claude spend appears here as soon as a client uses an AI feature.</Notice>}
      <SpendKpis kpis={r.kpis} period={r.period} what="Claude records of every client (Nova, roadmap, AI quick wins, insights, strategy, PDF import, SEO Coach and the AI usage log)" countLabel="AI runs" />

      <SpendChart title="Claude spend over time" sub={`${p.bucket === "day" ? "Per day" : "Per month"}, all ${count(r.counts.clients)} clients`} buckets={r.buckets} bucket={p.bucket} splits={r.splits}
        empty={`No Claude spend in the ${range}.`} csvName={csvName("claude-spend", p.bucket === "day" ? "per-day" : "per-month", span)} />

      <Row>
        <Panel title="By feature" sub={`Every feature with a Claude cost, ${range}`} right={r.features.length > 0 ? <CsvButton onClick={itemsCsv(csvName("claude-spend-by-feature", span), "Feature", r.features)} /> : undefined}>
          <RankedBars items={itemRows(r.features)} limit={8} empty={`No Claude spend in the ${range}.`} />
        </Panel>
        <Panel title="By model" sub={`Claude model of each run, ${range}`} right={r.models.length > 0 ? <CsvButton onClick={itemsCsv(csvName("claude-spend-by-model", span), "Model", r.models)} /> : undefined}>
          <RankedBars items={itemRows(r.models, { "": "Nova answers, which use each client's AI settings model" })} empty={`No Claude spend in the ${range}.`} />
        </Panel>
      </Row>

      <Row>
        <Panel title="Top clients" sub={`${count(r.counts.withSpend)} of ${count(r.counts.clients)} clients used Claude, ${range}`}>
          <RankedBars limit={10} empty={`No client used Claude in the ${range}.`}
            items={top.map((c) => ({ key: c.id, label: c.archived ? `${c.name} (archived)` : c.name, value: c.cost, right: <span className="inline-flex items-baseline gap-2">{usd(c.cost)}<span className="w-10 text-right text-xs text-muted">{share(c.share)}</span></span>, sub: `${count(c.runs)} run${c.runs === 1 ? "" : "s"}${c.topFeature ? ` · mostly ${c.topFeature}` : ""}` }))} />
        </Panel>
        <Panel title="Monthly Claude budgets" sub={`${month}, UTC · ${usd(r.budget.totalSpent)} of ${usd(r.budget.totalBudget)} across clients`}>
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            {([["Over budget", r.budget.over, "text-negative"], ["Near the limit", r.budget.near, "text-warn"], ["Claude off", r.budget.off, "text-muted"]] as const).map(([label, n, cls]) => (
              <div key={label} className="rounded-lg border border-hairline bg-surface-sunken px-2 py-2">
                <p className={`text-xl font-semibold ${n ? cls : "text-foreground"}`}>{count(n)}</p>
                <p className="text-[11px] text-muted">{label}</p>
              </div>
            ))}
          </div>
          {watch.length === 0 ? <p className="py-4 text-center text-sm text-muted">No client has used any of its Claude budget in {month} yet.</p> : (
            <ul className="space-y-2.5">
              {watch.slice(0, 8).map((c) => (
                <li key={c.id} className="text-[13px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate" title={c.name}>{c.name}</span>
                    <span className="shrink-0 tabular-nums text-secondary">{usd(c.monthSpent)} <span className="text-muted">of {usd(c.budget)}</span></span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Meter value={c.monthSpent} max={c.budget} className="flex-1" label={`${c.name}: ${usd(c.monthSpent)} of ${usd(c.budget)}`} />
                    <span className="w-10 text-right text-xs tabular-nums text-muted">{share(c.used)}</span>
                    {c.status !== "ok" && <BudgetTag status={c.status} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted">At 100% a client&apos;s Nova, AI runs, toolkit AI and blog reading pause until the 1st (UTC). Budgets are set per client in AI Quick Wins → Settings (default $20).</p>
        </Panel>
      </Row>

      <SpendTable title="All clients" sub={`Claude spend ${range} and this month's budget use`} rows={r.clients} columns={cols} rowKey={(c) => c.id}
        initialSort={{ key: "cost", dir: "desc" }} search={(c) => c.name} filter={{ label: "Budget status", value: (c) => STATUS_TEXT[c.status] }}
        csvName={csvName("claude-spend-by-client", span)} empty="This organization has no clients yet."
        foot={{ name: "All clients", runs: count(r.kpis.count), cost: usd(r.kpis.range), share: r.kpis.range ? "100%" : "", month: usd(r.budget.totalSpent), budget: usd(r.budget.totalBudget) }}
        note={<>Spend columns cover the {range} in {p.timezone}; the month and budget columns are {month} in UTC, counted the way the budget limit counts them (so they can differ slightly from the daily records).</>} />
    </div>
  );
}
