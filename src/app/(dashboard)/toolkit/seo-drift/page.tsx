import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { BarList } from "@/components/charts/bar-list";
import { ResearchTable } from "@/components/research/research-table";
import { BackToToolkit, Card, day, pathLabel, Prio } from "@/components/toolkit/bits";
import { ScanRun } from "@/components/toolkit/scan-run";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { daysAgo, diffSnap, loadScan, TK, type DriftData } from "@/lib/toolkit/site-scan";

export const maxDuration = 300;

/** SEO drift monitor. Method adapted from the claude-seo seo-drift skill (MIT, github.com/AgricIDaniel/claude-seo). */
export default async function DriftPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, cache } = page;
  const header = <><BackToToolkit /><TabHeader source={null} title="SEO Drift Monitor" description="A baseline of the SEO-critical elements on the website's key pages, re-checked every week. Every change is logged with its date, and regressions (noindex, lost canonical, removed schema, missing H1) are flagged first." guide={[
    { term: "Baseline", text: "The first scan of each page. Every later scan is compared with the previous one (to date each change) and with the baseline (to show total drift)." },
    { term: "Severity", text: "Critical: page stops answering 200, noindex added or canonical removed. High: schema removed, title/H1 removed, canonical changed, word count down 30%+. Medium: title or H1 rewritten, internal links down 30%+. Low: description or minor changes." },
    { term: "Pages", text: "Home, the top pages by organic traffic, WordPress service pages and the pages used by the technical checks: up to 25." },
    { term: "Method", text: "Adapted from the open-source claude-seo seo-drift skill (MIT licence). Free: reads the client's own website." },
  ]} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website yet" body="Set the client's website so it can be scanned." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  const supabase = await createClient();
  const stored = await loadScan<DriftData>(supabase, client.id, TK.drift);
  const top = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <p className="text-xs text-muted"><span className="font-medium text-foreground">{cache.target.domain}</span> · baseline {day(stored?.data.baselineAt)} · last check {day(stored?.data.checkedAt)} · re-checked weekly</p>
      <ScanRun canEdit={canEdit} allowReset={Boolean(stored)} />
    </div>
  );
  if (!stored) return <>{header}{top}<EmptyState title="No baseline yet" body="Run the first scan to record the baseline. The weekly automation then compares every scan with it." /></>;

  const d = stored.data;
  const pages = Object.values(d.latest);
  const vsBase = pages.flatMap((s) => (d.baseline[s.url] ? diffSnap(d.baseline[s.url], s).map((c) => ({ ...c, url: s.url })) : []));
  const alerts = d.changes.filter((c) => (c.severity === "Critical" || c.severity === "High") && Date.parse(c.detected) > daysAgo(30));
  const byField = new Map<string, number>();
  for (const c of d.changes) byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
  const byCheck = new Map<string, number>();
  for (const c of d.changes) byCheck.set(c.detected.slice(0, 10), (byCheck.get(c.detected.slice(0, 10)) ?? 0) + 1);
  const ok = pages.filter((p) => p.status === 200).length;

  return (
    <>
      {header}{top}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pages monitored" value={String(pages.length)} sub={`${ok} answer 200`} tone={ok === pages.length ? "good" : "bad"} />
        <StatCard label="Open alerts (30 days)" value={String(alerts.length)} sub="Critical + High changes" tone={alerts.length ? "bad" : "good"} />
        <StatCard label="Changes logged" value={String(d.changes.length)} sub={`over ${d.checks.length} check${d.checks.length === 1 ? "" : "s"}`} />
        <StatCard label="Drift vs baseline" value={String(vsBase.length)} sub={`fields differ from ${day(d.baselineAt)}`} tone={vsBase.some((c) => c.severity === "Critical") ? "bad" : vsBase.length ? "warn" : "good"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Alerts" sub="Critical and High regressions detected in the last 30 days">
          {alerts.length === 0 ? <p className="text-sm text-positive">No regressions: titles, H1s, canonicals, robots and schema are stable on every monitored page.</p> : (
            <ul className="divide-y divide-hairline">{alerts.slice(0, 12).map((a, i) => (
              <li key={i} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:gap-3">
                <span className="w-20 shrink-0"><Prio p={a.severity} /></span>
                <div className="min-w-0"><p className="font-medium">{a.field} on <span className="break-all">{pathLabel(a.url)}</span> <span className="font-normal text-muted">· {day(a.detected)}</span></p><p className="break-words text-secondary">{a.before} → {a.after}</p></div>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Check history" sub="Every scan of the key pages and the changes it found">
          <ul className="space-y-1.5 text-sm">{d.checks.slice(0, 8).map((c) => (
            <li key={c} className="grid grid-cols-[6rem_minmax(0,1fr)_5rem] items-center gap-3">
              <span>{day(c)}</span>
              <span className="relative h-2.5 rounded-full bg-surface-muted"><span className="absolute inset-y-0 left-0 rounded-full bg-warn/70" style={{ width: `${Math.min(100, (byCheck.get(c.slice(0, 10)) ?? 0) * 10)}%` }} /></span>
              <span className="text-right text-xs text-muted">{byCheck.get(c.slice(0, 10)) ?? 0} changes</span>
            </li>
          ))}</ul>
          {d.checks.length < 2 && <p className="mt-3 text-xs text-muted">Baseline recorded {day(d.baselineAt)} for {pages.length} pages. Changes appear here with their date as soon as a weekly check finds one.</p>}
        </Card>
      </div>
      {byField.size > 0 && <div className="mt-4"><BarList title="Changes by element" valueLabel="changes" items={[...byField].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} /></div>}

      <div className="mt-6">
        <ResearchTable title="Change log (dated)" csvName={`seo-drift-${cache.target.domain}`} searchKeys={["page", "field", "before", "after"]}
          rows={d.changes.map((c) => ({ detected: c.detected.slice(0, 10), severity: c.severity, page: c.url, field: c.field, before: c.before, after: c.after }))}
          columns={[{ key: "detected", label: "Detected", type: "date" }, { key: "severity", label: "Severity", type: "badge" }, { key: "page", label: "Page", type: "url" }, { key: "field", label: "Element" }, { key: "before", label: "Before" }, { key: "after", label: "After" }]}
          facets={[{ key: "severity", label: "Severity" }, { key: "field", label: "Element" }]} empty="No changes since the baseline yet." />
      </div>

      <div className="mt-6">
        <ResearchTable title="Current state of every monitored page" csvName={`seo-drift-pages-${cache.target.domain}`} searchKeys={["page", "title", "h1"]}
          rows={pages.map((s) => ({
            page: s.url, status: s.status, title: s.title ?? "(missing)", title_len: s.title?.length ?? 0, desc_len: s.desc?.length ?? 0, h1: s.h1 ?? "(missing)",
            canonical: s.canonical ? (s.canonical.replace(/\/$/, "") === s.finalUrl.replace(/\/$/, "") ? "self" : "other") : "missing",
            robots: s.robots ?? "index (default)", schema: s.schema.join(", ") || "none", words: s.words, links: s.internalLinks, drift: vsBase.filter((c) => c.url === s.url).length,
          }))}
          columns={[{ key: "page", label: "Page", type: "url" }, { key: "status", label: "Status", type: "int" }, { key: "title", label: "Title" }, { key: "title_len", label: "Title chars", type: "int" }, { key: "desc_len", label: "Desc chars", type: "int" }, { key: "h1", label: "H1" }, { key: "canonical", label: "Canonical", type: "badge" }, { key: "robots", label: "Robots" }, { key: "schema", label: "Schema types" }, { key: "words", label: "Words", type: "int" }, { key: "links", label: "Internal links", type: "int" }, { key: "drift", label: "Changed vs baseline", type: "int" }]}
          facets={[{ key: "canonical", label: "Canonical" }]} />
      </div>
    </>
  );
}
