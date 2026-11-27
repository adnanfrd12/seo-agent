"use client";

import { Panel } from "@/components/charts/ai-charts";
import type { EndpointRow, ToolsClientRow, ToolsSpendReport } from "@/lib/org/spend";
import { SpendChart } from "./chart";
import { count, csvName, dayLabel, downloadCsv, rangeLong, raw, share, timeLabel, usd, usdUnit } from "./format";
import { SpendKpis } from "./kpis";
import { SpendShell } from "./shell";
import { SpendTable, type Column } from "./table";
import { Change, CsvButton, Meter, Notice, RankedBars, Row, ShareBar, ToolTag } from "./ui";

/**
 * Organization settings → All tools spend: every paid call of every client of the organization (DataForSEO and
 * treg.to, from dfs_spend) plus the Claude total, by day or month, tool, group, automatic or manual, endpoint and
 * client; the DataForSEO daily limit; and the tools that cost nothing per request. Owners and admins only (the data
 * route checks the role on the server).
 */
export function ToolsSpend({ orgId }: { orgId: string }) {
  return <SpendShell<ToolsSpendReport> orgId={orgId} kind="tools">{(r) => <ToolsView r={r} />}</SpendShell>;
}

const OTHER = "var(--cat-other)";
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

function ToolsView({ r }: { r: ToolsSpendReport }) {
  const p = r.period, range = rangeLong(p.range).toLowerCase(), span = `${p.start}_${p.end}`;
  const calls = r.kpis.calls, d = r.dfs;
  const dfs = r.providers.find((x) => x.key === "dataforseo");
  const missing = r.providers.filter((x) => x.status === "not_set_up");
  const top = r.clients.filter((c) => c.total > 0);
  const free = r.tools.filter((t) => t.billing === "free"), billed = r.tools.filter((t) => t.billing === "subscription");

  const ratio = (cur: number, prev: number) => (prev ? (cur - prev) / prev : cur ? Infinity : 0);
  const endpointCols: Column<EndpointRow>[] = [
    { key: "label", label: "What", value: (e) => e.label, render: (e) => <span className="block min-w-[11rem]">{e.label}<span className="block font-mono text-[11px] text-faint">{e.endpoint}</span></span> },
    { key: "endpoint", label: "Endpoint", value: (e) => e.endpoint, csvOnly: true },
    { key: "group", label: "Group", value: (e) => e.groupLabel, render: (e) => <span className="block min-w-[7.5rem]">{e.groupLabel}{e.provider !== "dataforseo" && <span className="block text-[11px] text-muted">{e.providerLabel}</span>}</span> },
    { key: "tool", label: "Tool", value: (e) => e.providerLabel, csvOnly: true },
    { key: "calls", label: "Calls", num: true, value: (e) => e.calls, render: (e) => count(e.calls) },
    { key: "cost", label: "Spend", num: true, value: (e) => e.cost, csv: (e) => raw(e.cost), render: (e) => usd(e.cost) },
    { key: "avg", label: "Per call", num: true, value: (e) => e.avg, csv: (e) => raw(e.avg), render: (e) => (e.calls ? usdUnit(e.avg) : "—") },
    { key: "auto", label: "Automatic", num: true, value: (e) => e.autoCalls, render: (e) => count(e.autoCalls), hint: "Calls made by scheduled refreshes" },
    { key: "autoCost", label: "Automatic (USD)", value: (e) => raw(e.autoCost), csvOnly: true },
    { key: "manual", label: "Manual", num: true, value: (e) => e.manualCalls, render: (e) => count(e.manualCalls), hint: "Calls started by someone pressing a button" },
    { key: "manualCost", label: "Manual (USD)", value: (e) => raw(e.manualCost), csvOnly: true },
    { key: "prev", label: "vs previous", num: true, value: (e) => ratio(e.cost, e.prevCost), csv: (e) => (e.prevCost ? raw(ratio(e.cost, e.prevCost)) : ""), render: (e) => <Change cur={e.cost} prev={e.prevCost} /> },
    { key: "prevCost", label: "Previous period (USD)", value: (e) => raw(e.prevCost), csvOnly: true },
    { key: "clients", label: "Clients", num: true, value: (e) => e.clients },
    { key: "last", label: "Last call", value: (e) => e.last, csv: (e) => e.last ?? "", render: (e) => <span className="whitespace-nowrap" title={timeLabel(e.last)}>{e.last ? dayLabel(e.last.slice(0, 10)) : "—"}</span> },
  ];
  const sum = (f: (c: ToolsClientRow) => number) => r.clients.reduce((a, c) => a + f(c), 0);
  const money = (key: keyof ToolsClientRow & string, label: string, hint?: string): Column<ToolsClientRow> =>
    ({ key, label, num: true, hint, value: (c) => c[key] as number, csv: (c) => raw(c[key] as number), render: (c) => usd(c[key] as number) });
  const clientCols: Column<ToolsClientRow>[] = [
    { key: "name", label: "Client", value: (c) => c.name, csv: (c) => (c.archived ? `${c.name} (archived)` : c.name),
      render: (c) => <span className="inline-flex min-w-[10rem] flex-wrap items-center gap-1.5">{c.name}{c.archived && <span className="rounded-full bg-surface-muted px-1.5 py-px text-[10.5px] font-medium text-muted">Archived</span>}</span> },
    money("dataforseo", "DataForSEO"),
    // treg.to only when the organization used it in this period
    ...(sum((c) => c.treg) > 0 ? [money("treg", "treg.to")] : []),
    money("claude", "Claude"),
    { ...money("total", "Total"), render: (c) => <b className="font-medium">{usd(c.total)}</b> },
    { key: "share", label: "Share", num: true, value: (c) => c.share, csv: (c) => raw(c.share), render: (c) => share(c.share) },
    { key: "prev", label: "vs previous", num: true, value: (c) => ratio(c.total, c.prevTotal), csv: (c) => (c.prevTotal ? raw(ratio(c.total, c.prevTotal)) : ""), render: (c) => <Change cur={c.total} prev={c.prevTotal} /> },
    { key: "prevTotal", label: "Previous period (USD)", value: (c) => raw(c.prevTotal), csvOnly: true },
    { key: "calls", label: "Paid calls", num: true, value: (c) => c.calls, render: (c) => count(c.calls) },
    { key: "runs", label: "Claude runs", num: true, value: (c) => c.runs, render: (c) => count(c.runs) },
    money("auto", "Automatic", "DataForSEO and treg.to spend of scheduled refreshes"),
    money("manual", "Manual", "DataForSEO and treg.to spend started by a button"),
  ];
  const groupsCsv = () => downloadCsv(csvName("tools-spend-by-group", span), ["Group", "Tool", "Spend (USD)", "Calls", "Share", "Endpoints", "Clients", "Previous period (USD)", "Previous calls", "Last call (UTC)"],
    r.groups.map((g) => [g.label, g.provider === "treg" ? "treg.to" : "DataForSEO", raw(g.cost), g.count, raw(g.share), g.endpoints, g.clients, raw(g.prevCost), g.prevCount, g.last ?? ""]));

  return (
    <div className="space-y-4">
      {r.counts.clients === 0 && <Notice>This organization has no clients yet. Spend appears here as soon as a client uses a paid tool.</Notice>}
      {missing.length > 0 && (
        <Notice>{missing.map((x) => x.label).join(" and ")} {missing.length === 1 ? "isn't" : "aren't"} set up for this organization, so {missing.length === 1 ? "it makes" : "they make"} no paid calls. An owner adds the credentials in Settings → Integrations.</Notice>
      )}
      <SpendKpis kpis={r.kpis} period={r.period} what="DataForSEO and treg.to calls (every paid request is logged) plus Claude" countLabel="Paid calls"
        countSub={`${count(calls.dataforseo)} DataForSEO · ${count(calls.treg)} treg.to · ${count(calls.claude)} Claude`} />

      <SpendChart title="Spend on paid tools over time" sub={`${p.bucket === "day" ? "Per day" : "Per month"}: DataForSEO, treg.to and Claude, all ${count(r.counts.clients)} clients`}
        buckets={r.buckets} bucket={p.bucket} splits={r.splits} empty={`No paid calls in the ${range}.`} csvName={csvName("tools-spend", p.bucket === "day" ? "per-day" : "per-month", span)} />

      <Row>
        <Panel title="By tool" sub={`Paid per request, ${range}`}>
          <ShareBar empty={`No paid calls in the ${range}.`} parts={r.providers.map((x) => ({
            key: x.key, label: x.label, value: x.cost, color: x.color ?? OTHER,
            detail: <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">{plural(x.count, x.key === "claude" ? "run" : "call")}{x.count > 0 && <> · {usd(x.cost / x.count)} each</>} <Change cur={x.cost} prev={x.prevCost} /> {x.status !== "set_up" && <ToolTag status={x.status} />}</span>,
          }))} />
        </Panel>
        <Panel title="Automatic or manual" sub="DataForSEO and treg.to calls; Claude runs aren't split">
          <ShareBar empty={`No DataForSEO or treg.to calls in the ${range}.`} parts={[
            { key: "auto", label: "Automatic", value: r.source.auto.cost, color: "var(--series)", detail: <span className="inline-flex flex-wrap gap-x-2">Scheduled refreshes · {plural(r.source.auto.calls, "call")} <Change cur={r.source.auto.cost} prev={r.source.auto.prevCost} /></span> },
            { key: "manual", label: "Manual", value: r.source.manual.cost, color: "color-mix(in oklab, var(--series) 40%, var(--surface))", detail: <span className="inline-flex flex-wrap gap-x-2">Someone pressed a button · {plural(r.source.manual.calls, "call")} <Change cur={r.source.manual.cost} prev={r.source.manual.prevCost} /></span> },
          ]} />
          <p className="mt-4 text-xs text-muted">Scheduled refreshes may use up to {share(d.dailyLimit ? d.autoLimit / d.dailyLimit : 0)} of the DataForSEO daily limit, so buttons keep working. Automatic refresh is {d.autoRefresh ? "on" : "off"} for this organization.</p>
        </Panel>
      </Row>

      <Row>
        <Panel title="By group" sub={`What the paid calls were for, ${range}`} right={r.groups.length > 0 ? <CsvButton onClick={groupsCsv} /> : undefined}>
          <RankedBars empty={`No paid calls in the ${range}.`} items={r.groups.map((g) => ({
            key: g.key, label: g.label, value: g.cost, color: g.color ?? OTHER,
            right: <span className="inline-flex items-baseline gap-2">{usd(g.cost)}<Change cur={g.cost} prev={g.prevCost} /></span>,
            sub: g.count ? `${plural(g.count, "call")} · ${share(g.share)} of all tools · ${plural(g.endpoints, "endpoint")}${g.provider === "treg" ? " · treg.to" : ""}` : `Nothing this period · ${usd(g.prevCost)} before`,
          }))} />
        </Panel>
        <Panel title="DataForSEO daily limit" sub={d.scope === "organization" ? "This organization's limit, per UTC day (Settings → Integrations)" : "Platform-wide setting until per-organization limits are switched on"}>
          <div className="space-y-4 text-[13px]">
            <div>
              <p className="flex items-baseline justify-between gap-3"><span className="font-medium">Today <span className="font-normal text-muted">({dayLabel(d.today)}, UTC)</span></span><span className="tabular-nums text-secondary">{usd(d.spentToday)} <span className="text-muted">of {usd(d.dailyLimit)}</span></span></p>
              <Meter value={d.spentToday} max={d.dailyLimit} className="mt-1.5" label={`Today: ${usd(d.spentToday)} of the ${usd(d.dailyLimit)} daily limit`} />
            </div>
            <div>
              <p className="flex items-baseline justify-between gap-3"><span>Scheduled refreshes today</span><span className="tabular-nums text-secondary">{usd(d.autoToday)} <span className="text-muted">of {usd(d.autoLimit)}</span></span></p>
              <Meter value={d.autoToday} max={d.autoLimit} className="mt-1.5" label={`Scheduled refreshes today: ${usd(d.autoToday)} of ${usd(d.autoLimit)}`} />
            </div>
            <div>
              <p className="text-muted">One client can use up to <b className="font-medium text-secondary">{usd(d.perClientLimit)}</b> a day.{d.topToday.length ? " Today:" : " No client has spent anything today."}</p>
              {d.topToday.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {d.topToday.map((c) => (
                    <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] items-center gap-2 text-xs">
                      <span className="truncate" title={c.name}>{c.name}</span>
                      <Meter value={c.cost} max={d.perClientLimit} label={`${c.name}: ${usd(c.cost)} of ${usd(d.perClientLimit)}`} />
                      <span className="text-right tabular-nums text-secondary">{usd(c.cost)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-hairline pt-3">
              <dt className="text-muted">Busiest day</dt>
              <dd className="text-right tabular-nums">{d.peak ? <>{usd(d.peak.cost)} <span className="text-muted">on {dayLabel(d.peak.day, true)}</span></> : "—"}</dd>
              <dt className="text-muted">Days at 90%+ of the limit</dt>
              <dd className="text-right tabular-nums">{count(d.daysNear)} <span className="text-muted">in the {range}</span></dd>
              <dt className="text-muted">Account balance</dt>
              <dd className="text-right tabular-nums">{d.balance == null ? <span className="text-muted">{dfs?.status === "set_up" ? "unavailable" : "not set up"}</span> : <>{usd(d.balance)}{d.runwayDays != null && <span className="text-muted"> · about {count(d.runwayDays)} days at {usd(d.avgDaily30)}/day</span>}</>}</dd>
            </dl>
            {d.scope === "global" && <Notice tone="warn">This limit is still the platform-wide setting. It becomes this organization&apos;s own limit once the per-organization DataForSEO update is applied; spend is already counted for this organization only.</Notice>}
          </div>
        </Panel>
      </Row>

      <Row>
        <Panel title="Top clients" sub={`${count(r.counts.withSpend)} of ${count(r.counts.clients)} clients had paid calls or Claude runs, ${range}`}>
          <RankedBars limit={10} empty={`No client spent anything in the ${range}.`} items={top.map((c) => ({
            key: c.id, label: c.archived ? `${c.name} (archived)` : c.name, value: c.total,
            right: <span className="inline-flex items-baseline gap-2">{usd(c.total)}<span className="w-10 text-right text-xs text-muted">{share(c.share)}</span></span>,
            sub: [c.dataforseo ? `DataForSEO ${usd(c.dataforseo)}` : "", c.treg ? `treg.to ${usd(c.treg)}` : "", c.claude ? `Claude ${usd(c.claude)}` : ""].filter(Boolean).join(" · "),
          }))} />
        </Panel>
        <Panel title="Other tools" sub="Used by SEO Insights without a per-request cost here">
          <ul className="divide-y divide-hairline text-[13px]">
            {[...free, ...billed].map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t.name}</span>
                  <span className="block text-xs text-muted">{t.note}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <span className="text-xs text-secondary">{t.billing === "free" ? "No per-request cost" : "Billed by the provider"}</span>
                  <ToolTag status={t.status} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Subscriptions are paid to the provider directly, so their cost isn&apos;t tracked here. Composio, Google, Bing and Clarity have no per-request charge in SEO Insights.</p>
        </Panel>
      </Row>

      <SpendTable title="Endpoints" sub={`Every kind of paid call, ${range}`} rows={r.endpoints} columns={endpointCols} rowKey={(e) => e.endpoint}
        initialSort={{ key: "cost", dir: "desc" }} search={(e) => `${e.label} ${e.endpoint} ${e.groupLabel}`} filter={{ label: "Group", value: (e) => e.groupLabel }}
        csvName={csvName("tools-spend-by-endpoint", span)} empty={`No paid calls in the ${range}.`}
        foot={{ label: "All endpoints", calls: count(r.endpoints.reduce((a, e) => a + e.calls, 0)), cost: usd(r.endpoints.reduce((a, e) => a + e.cost, 0)), auto: count(r.source.auto.calls), manual: count(r.source.manual.calls) }} />

      <SpendTable title="All clients" sub={`Spend per client and tool, ${range}`} rows={r.clients} columns={clientCols} rowKey={(c) => c.id}
        initialSort={{ key: "total", dir: "desc" }} search={(c) => c.name} csvName={csvName("tools-spend-by-client", span)} empty="This organization has no clients yet."
        foot={{ name: "All clients", dataforseo: usd(sum((c) => c.dataforseo)), treg: usd(sum((c) => c.treg)), claude: usd(sum((c) => c.claude)), total: usd(r.kpis.range), share: r.kpis.range ? "100%" : "", calls: count(sum((c) => c.calls)), runs: count(sum((c) => c.runs)), auto: usd(sum((c) => c.auto)), manual: usd(sum((c) => c.manual)) }}
        note={<>Days are {p.timezone}; the daily limit counts UTC days. Calls are logged when DataForSEO or treg.to bills them, so failed or free calls don&apos;t appear.</>} />
    </div>
  );
}
