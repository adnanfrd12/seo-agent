import { after } from "next/server";
import { CheckCircle2, CircleAlert, CircleX, Info } from "lucide-react";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Highlights } from "@/components/dashboard/highlights";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine } from "@/components/research/chrome";
import { AuditProgress, AuditRun, LighthouseRun } from "@/components/research/audit-controls";
import { ResearchTable } from "@/components/research/research-table";
import { fmtInt } from "@/lib/analytics/format";
import { loadAudit, pollAudit, type AuditIssue, type Severity } from "@/lib/dataforseo/audit";
import { loadLighthouse, type LhRow, type LhRun } from "@/lib/dataforseo/lighthouse";
import { ScoreRing } from "@/components/charts/score-ring";
import { Tabs } from "@/components/research/tabs";
import { researchPage } from "@/lib/dataforseo/view";
import type { Highlight } from "@/lib/overview/highlights";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const SEV: Record<Severity, { label: string; icon: typeof CircleX; cls: string }> = {
  error: { label: "Errors", icon: CircleX, cls: "text-negative" },
  warning: { label: "Warnings", icon: CircleAlert, cls: "text-[#D4970A]" },
  notice: { label: "Notices", icon: Info, cls: "text-muted" },
};

function IssueGroup({ severity, issues }: { severity: Severity; issues: AuditIssue[] }) {
  if (!issues.length) return null;
  const s = SEV[severity];
  return (
    <div>
      <h3 className={cn("mb-2 flex items-center gap-1.5 text-sm font-semibold", s.cls)}><s.icon className="size-4" aria-hidden /> {s.label} <span className="font-normal text-muted">{issues.length} type{issues.length > 1 ? "s" : ""}</span></h3>
      <ul className="space-y-2">
        {issues.map((i) => (
          <li key={i.key}>
            <details className="group rounded-xl border border-border bg-surface">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{i.label}</span>
                <span className="tabular-nums text-muted">{fmtInt(i.count)} page{i.count > 1 ? "s" : ""}</span>
              </summary>
              <div className="space-y-2 border-t border-border px-4 py-3 text-sm">
                <p><span className="font-medium">Why it matters: </span>{i.why}</p>
                <p><span className="font-medium">How to fix: </span>{i.fix}</p>
                <ul className="space-y-0.5 text-xs">
                  {i.urls.map((u) => <li key={u} className="break-all"><a href={u} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{u}</a></li>)}
                </ul>
                {i.count > i.urls.length && <p className="text-xs text-muted">Showing {i.urls.length} of {fmtInt(i.count)}. The full list is in the pages table below (filter by errors).</p>}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SiteCheck({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok === null ? <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#D4970A]" aria-hidden />}
      <span><span className="font-medium">{label}</span> <span className="text-muted">{ok === null ? "not reported" : detail}</span></span>
    </li>
  );
}

export const maxDuration = 300; // Lighthouse runs from this page can take a couple of minutes

const secs = (ms: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/ (home)" : x.pathname; } catch { return u; } };
// Core Web Vitals thresholds (good / needs improvement) shown in Lighthouse's colours
const vital = (v: number | null, good: number, poor: number) => (v == null ? "text-muted" : v <= good ? "text-[#0a8f4c]" : v <= poor ? "text-[#c77700]" : "text-[#e0362b]");

function LhCard({ r }: { r: LhRow }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/60 p-4">
      <p className="mb-3 truncate text-sm font-semibold" title={r.url}>{pathOf(r.url)}</p>
      {r.error ? <p className="text-sm text-negative">Test failed: {r.error}</p> : (
        <>
          <div className="flex flex-wrap justify-between gap-2">
            <ScoreRing score={r.performance} label="Performance" />
            <ScoreRing score={r.accessibility} label="Accessibility" />
            <ScoreRing score={r.best_practices} label="Best practices" />
            <ScoreRing score={r.seo} label="SEO" />
          </div>
          <p className="mt-3 text-sm tabular-nums">
            <span className={vital(r.lcp_ms, 2500, 4000)}>LCP {secs(r.lcp_ms)}</span>
            <span className="text-muted"> · </span><span className={vital(r.cls, 0.1, 0.25)}>CLS {r.cls == null ? "—" : r.cls.toFixed(2)}</span>
            <span className="text-muted"> · </span><span className={vital(r.tbt_ms, 200, 600)}>TBT {secs(r.tbt_ms)}</span>
            <span className="text-muted"> · </span><span className={vital(r.ttfb_ms, 800, 1800)}>TTFB {secs(r.ttfb_ms)}</span>
          </p>
        </>
      )}
    </div>
  );
}

function LighthouseSection({ runs, canEdit }: { runs: LhRun[]; canEdit: boolean }) {
  const last = runs[0];
  const grid = (device: "mobile" | "desktop") => (
    <div className="grid gap-4 md:grid-cols-2">{last.rows.filter((r) => r.device === device).map((r) => <LhCard key={r.url} r={r} />)}</div>
  );
  const series = (key: "performance" | "seo") => [...runs].reverse().map((x) => ({ date: x.checkedAt.slice(0, 10), value: x.rows.find((r) => r.device === "mobile" && !r.error)?.[key] ?? null })).filter((p) => p.value != null);
  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-5" aria-label="Lighthouse">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Lighthouse scores</h2>
          {last && <p className="text-xs text-muted">Tested {last.checkedAt.slice(0, 10)} · refreshed weekly</p>}
        </div>
        <LighthouseRun canEdit={canEdit} />
      </div>
      {!last ? <p className="text-sm text-muted">No Lighthouse test yet.</p> : (
        <div className="space-y-4">
          <Tabs label="Device" items={[{ key: "mobile", label: "Mobile", content: grid("mobile") }, { key: "desktop", label: "Desktop", content: grid("desktop") }]} />
          {runs.length >= 2 && <MetricTrend title="Mobile scores over time" source="Lighthouse" options={[{ key: "perf", label: "Performance", data: series("performance") }, { key: "seo", label: "SEO", data: series("seo") }]} />}
        </div>
      )}
    </section>
  );
}

export default async function SiteAuditPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Site Audit" description="A crawl of the website that finds technical problems hurting search visibility: broken pages, missing titles and descriptions, duplicates, redirects and thin content." guide={[
    { term: "Errors", text: "Problems that can stop pages from being found or shown properly (broken pages, missing titles). Fix these first." },
    { term: "Warnings", text: "Problems that weaken results (duplicate titles, redirects, missing descriptions). Worth fixing after the errors." },
    { term: "Notices", text: "Smaller improvements, such as thin content or missing image descriptions." },
    { term: "On-page score", text: "A 0-100 score from the crawler for how well the pages follow on-page best practice. Compare it between audits rather than judging one number." },
  ]} />;
  if (!configured) return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website to audit yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected, or ask an owner or admin to set it." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const supabase = await createClient();
  const { result, task } = await loadAudit(supabase, client.id);
  const lighthouse = await loadLighthouse(supabase, client.id);
  const crawling = task?.data.status === "crawling";
  // a viewer arriving mid-crawl (or after it finished) collects the result right away instead of waiting for the daily job
  if (crawling && canEdit) after(async () => { try { await pollAudit(createAdminClient(), client.id); } catch { /* shown on the next visit */ } });
  const r = result?.data;
  const failed = task?.data.status === "failed" ? task.data.error : null;

  const errors = r ? r.issues.filter((i) => i.severity === "error").reduce((a, i) => a + i.count, 0) : 0;
  const warnings = r ? r.issues.filter((i) => i.severity === "warning").reduce((a, i) => a + i.count, 0) : 0;
  const prev = r?.previous ?? null;

  const picks: Highlight[] = [];
  if (r) {
    if (prev && errors < prev.errors) picks.push({ tone: "good", title: `${prev.errors - errors} fewer errors than the audit on ${prev.date}`, detail: `${fmtInt(prev.errors)} → ${fmtInt(errors)} error instances.` });
    if (prev && errors > prev.errors) picks.push({ tone: "bad", title: `${errors - prev.errors} new errors since ${prev.date}`, detail: `${fmtInt(prev.errors)} → ${fmtInt(errors)} error instances.`, action: "Open the Errors section below to see which pages." });
    const worst = r.issues.find((i) => i.severity === "error") ?? r.issues.find((i) => i.severity === "warning");
    if (worst) picks.push({ tone: worst.severity === "error" ? "bad" : "info", title: `Biggest problem: ${worst.label.toLowerCase()} (${fmtInt(worst.count)} pages)`, detail: worst.why, action: worst.fix });
    if (r.site.sitemap === false) picks.push({ tone: "info", title: "No XML sitemap was found", detail: "A sitemap helps Google discover all pages.", action: "Publish a sitemap and submit it in Search Console." });
    if (errors === 0) picks.push({ tone: "good", title: "No errors found in the crawled pages", detail: `${fmtInt(r.cleanPages)} of ${fmtInt(r.pages)} pages have no errors or warnings.` });
  }

  return (
    <>
      {header}
      <div className="mb-5 space-y-3">
        <SpendLine budget={budget} />
        <p className="text-xs text-muted"><span className="font-medium text-foreground">{cache.target.domain}</span> · crawled weekly</p>
      </div>

      {crawling && <div className="mb-5"><AuditProgress crawled={task!.data.crawled ?? 0} max={task!.data.maxPages} /></div>}
      {failed && !crawling && <p role="alert" className="mb-5 rounded-xl border border-negative/40 bg-negative/10 p-3 text-sm text-negative">The last audit didn&apos;t complete: {failed}</p>}
      <div className="mb-6"><AuditRun canEdit={canEdit} busy={crawling} hasResult={Boolean(r)} /></div>

      {!r ? (
        !crawling && <><EmptyState title={`No audit for ${cache.target.domain} yet`} body="Nothing is crawled automatically when you open this page. Run the first audit above; the result is stored and refreshed weekly in the background." /><LighthouseSection runs={lighthouse} canEdit={canEdit} /></>
      ) : (
        <>
          <Highlights items={picks.slice(0, 4)} stableNote="Nothing notable in this audit." />

          <section aria-label="Audit summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="On-page score" source="DFS" format={fmtInt} value={r.score} previous={prev?.score ?? null} hint="0-100, from the crawler. Compare between audits." />
            <KpiCard label="Pages crawled" source="DFS" format={fmtInt} value={r.pages} previous={null} />
            <KpiCard label="Errors" source="DFS" format={fmtInt} value={errors} previous={prev?.errors ?? null} higherIsBetter={false} hint="Error instances across the crawled pages." />
            <KpiCard label="Warnings" source="DFS" format={fmtInt} value={warnings} previous={prev?.warnings ?? null} higherIsBetter={false} />
            <KpiCard label="Healthy pages" source="DFS" format={(n) => (n === null ? "—" : `${fmtInt(n)} of ${fmtInt(r.pages)}`)} value={r.cleanPages} previous={null} hint="Pages with no errors or warnings." />
          </section>
          <p className="mt-2 text-xs text-muted">Crawled {r.finishedAt.slice(0, 10)}{prev ? ` · compared with ${prev.date}` : ""}</p>
          <LighthouseSection runs={lighthouse} canEdit={canEdit} />

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-5">
              <h2 className="text-base font-semibold">Issues found</h2>
              {r.issues.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">No issues were found in the crawled pages.</p> : (
                <>
                  <IssueGroup severity="error" issues={r.issues.filter((i) => i.severity === "error")} />
                  <IssueGroup severity="warning" issues={r.issues.filter((i) => i.severity === "warning")} />
                  <IssueGroup severity="notice" issues={r.issues.filter((i) => i.severity === "notice")} />
                </>
              )}
            </div>
            <aside className="space-y-4">
              <section className="rounded-xl border border-border bg-surface p-4" aria-label="Site-wide checks">
                <h2 className="mb-2 text-sm font-semibold">Site-wide checks</h2>
                <ul className="space-y-2">
                  <SiteCheck label="XML sitemap" ok={r.site.sitemap} detail={r.site.sitemap ? "found" : "not found"} />
                  <SiteCheck label="robots.txt" ok={r.site.robots} detail={r.site.robots ? "found" : "not found"} />
                  <SiteCheck label="HTTPS (SSL)" ok={r.site.ssl} detail={r.site.ssl ? "valid" : "problem detected"} />
                  <SiteCheck label="HTTP/2" ok={r.site.http2} detail={r.site.http2 ? "supported" : "not supported"} />
                  <SiteCheck label="www / non-www redirect" ok={r.site.wwwRedirect} detail={r.site.wwwRedirect ? "set up" : "missing"} />
                </ul>
                {(r.site.cms || r.site.server) && <p className="mt-3 text-xs text-muted">{r.site.cms ? `Platform: ${r.site.cms}. ` : ""}{r.site.server ? `Server: ${r.site.server}.` : ""}</p>}
              </section>
              <section className="rounded-xl border border-border bg-surface p-4 text-sm" aria-label="Link and duplicate totals">
                <h2 className="mb-2 text-sm font-semibold">Links and duplicates</h2>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  {([["Internal links", r.metrics.internalLinks], ["External links", r.metrics.externalLinks], ["Broken links", r.metrics.brokenLinks], ["Duplicate titles", r.metrics.duplicateTitle], ["Duplicate descriptions", r.metrics.duplicateDescription], ["Duplicate content pages", r.metrics.duplicateContent], ["Non-indexable pages", r.metrics.nonIndexable]] as const).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-right tabular-nums">{v === null ? "—" : fmtInt(v)}</dd></div>
                  ))}
                </dl>
              </section>
            </aside>
          </div>

          {r.history.length >= 2 && (
            <div className="mt-6">
              <MetricTrend title="Audit results over time" source="DFS" options={[
                { key: "score", label: "On-page score", data: r.history.filter((h) => h.score !== null).map((h) => ({ date: h.date, value: h.score })) },
                { key: "errors", label: "Errors", data: r.history.map((h) => ({ date: h.date, value: h.errors })) },
                { key: "warnings", label: "Warnings", data: r.history.map((h) => ({ date: h.date, value: h.warnings })) },
              ]} />
            </div>
          )}

          <div className="mt-8">
            <ResearchTable title="Crawled pages (most problems first)" rows={r.rows as unknown as Record<string, unknown>[]} searchKeys={["url", "title"]} initialSort={{ key: "errors", dir: "desc" }}
              csvName={`site-audit-${r.domain}`} columns={[
                { key: "url", label: "Page", type: "url" }, { key: "status", label: "Status", type: "int" }, { key: "title", label: "Title" }, { key: "errors", label: "Errors", type: "int" },
                { key: "warnings", label: "Warnings", type: "int" }, { key: "words", label: "Words", type: "int" }, { key: "depth", label: "Click depth", type: "int", hint: "Clicks from the homepage" },
                { key: "ms", label: "Load (ms)", type: "int" }, { key: "score", label: "Score", type: "int" },
              ]}
              presets={[{ label: "With errors", where: [{ key: "errors", op: "gte", value: 1 }] }, { label: "With warnings", where: [{ key: "warnings", op: "gte", value: 1 }] }, { label: "Not 200 OK", where: [{ key: "status", op: "gte", value: 300 }] }, { label: "Thin (< 200 words)", where: [{ key: "words", op: "lte", value: 199 }] }]}
              ranges={[{ key: "status", label: "Status" }, { key: "words", label: "Words" }, { key: "depth", label: "Click depth" }, { key: "ms", label: "Load (ms)" }, { key: "score", label: "Score" }]}
              note={r.pages > r.rows.length ? `Showing the ${r.rows.length} pages with the most problems of ${fmtInt(r.pages)} crawled.` : undefined} />
          </div>
        </>
      )}
    </>
  );
}
