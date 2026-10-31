import { after } from "next/server";
import { CheckCircle2, CircleAlert, CircleX, Info } from "lucide-react";
import { Columns, Donut, StackedBars } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Fill, SplitBar } from "@/components/charts/ops-charts";
import { Highlights } from "@/components/dashboard/highlights";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine } from "@/components/research/chrome";
import { AuditProgress, AuditRun, CruxRefresh, LighthouseRun } from "@/components/research/audit-controls";
import { CruxPanel } from "@/components/charts/tracking-extra";
import { ResearchTable } from "@/components/research/research-table";
import { fmtInt } from "@/lib/analytics/format";
import { loadAudit, loadAuditRender, pollAudit, RENDER_MODES, type AuditIssue, type AuditPage, type Severity } from "@/lib/dataforseo/audit";
import { loadCrux, loadLighthouse, type LhRow, type LhRun } from "@/lib/dataforseo/lighthouse";
import { ScoreRing } from "@/components/charts/score-ring";
import { Tabs } from "@/components/research/tabs";
import { researchPage } from "@/lib/dataforseo/view";
import type { Highlight } from "@/lib/overview/highlights";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const SEV: Record<Severity, { label: string; icon: typeof CircleX; cls: string }> = {
  error: { label: "Errors", icon: CircleX, cls: "text-negative" },
  warning: { label: "Warnings", icon: CircleAlert, cls: "text-warn" },
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
            <details className="group rounded-[10px] border border-border bg-surface">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{i.label}</span>
                <span className="tabular-nums text-muted">{fmtInt(i.count)} page{i.count > 1 ? "s" : ""}</span>
              </summary>
              <div className="space-y-2 border-t border-border px-4 py-3 text-sm">
                <p><span className="font-medium">Why it matters: </span>{i.why}</p>
                <p><span className="font-medium">How to fix: </span>{i.fix}</p>
                <ul className="space-y-0.5 text-xs">
                  {i.urls.map((u) => <li key={u} className="break-all"><a href={u} target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">{u}</a></li>)}
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
      {ok === null ? <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />}
      <span><span className="font-medium">{label}</span> <span className="text-muted">{ok === null ? "not reported" : detail}</span></span>
    </li>
  );
}

export const maxDuration = 300; // Lighthouse runs from this page can take a couple of minutes

const secs = (ms: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/ (home)" : x.pathname; } catch { return u; } };
// Core Web Vitals thresholds (good / needs improvement) shown in Lighthouse's colours
const vital = (v: number | null, good: number, poor: number) => (v == null ? "text-muted" : v <= good ? "text-[#0a8f4c]" : v <= poor ? "text-[#c77700]" : "text-[#e0362b]");

const CATS = [["performance", "Performance"], ["accessibility", "Accessibility"], ["best_practices", "Best practices"], ["seo", "SEO"]] as const;

function Vitals({ r }: { r: LhRow }) {
  return (
    <p className="mt-3 text-[13px] tabular-nums">
      <span className={vital(r.lcp_ms, 2500, 4000)}>LCP {secs(r.lcp_ms)}</span>
      <span className="text-muted"> · </span><span className={vital(r.cls, 0.1, 0.25)}>CLS {r.cls == null ? "—" : r.cls.toFixed(2)}</span>
      <span className="text-muted"> · </span><span className={vital(r.tbt_ms, 200, 600)}>TBT {secs(r.tbt_ms)}</span>
      <span className="text-muted"> · </span><span className={vital(r.ttfb_ms, 800, 1800)}>TTFB {secs(r.ttfb_ms)}</span>
    </p>
  );
}

function DeviceScores({ r, device }: { r: LhRow | undefined; device: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium text-muted">{device}</p>
      {!r ? <p className="text-sm text-muted">Not tested.</p> : r.error ? <p className="text-sm text-negative">Test failed: {r.error}</p> : (
        <>
          <div className="flex flex-wrap justify-between gap-2">{CATS.map(([k, l]) => <ScoreRing key={k} score={r[k]} label={l} />)}</div>
          <Vitals r={r} />
        </>
      )}
    </div>
  );
}

/** One row per tested page: mobile and desktop side by side. */
function LhPage({ url, mobile, desktop, at }: { url: string; mobile?: LhRow; desktop?: LhRow; at: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface-sunken p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <a href={url} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-semibold hover:underline" title={url}>{pathOf(url)}</a>
        <span className="text-xs text-faint">tested {at.slice(0, 10)}</span>
      </div>
      <div className="grid gap-5 md:grid-cols-2 md:divide-x md:divide-hairline md:[&>*:last-child]:pl-5">
        <DeviceScores r={mobile} device="Mobile" />
        <DeviceScores r={desktop} device="Desktop" />
      </div>
    </div>
  );
}

/** Lighthouse-coloured bars: each page's timing against the good / poor thresholds. */
function VitalBars({ title, rows, pick, good, poor, unit }: {
  title: string; rows: { url: string; r: LhRow }[]; pick: (r: LhRow) => number | null; good: number; poor: number; unit: "ms" | "cls";
}) {
  const fmt = (v: number) => (unit === "cls" ? v.toFixed(2) : secs(v));
  const vals = rows.map((x) => pick(x.r)).filter((v): v is number => v != null);
  const max = Math.max(poor * 1.2, ...vals);
  return (
    <div className="min-w-0 rounded-[10px] border border-border bg-surface p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mb-3 text-xs text-muted">good under {fmt(good)} · poor over {fmt(poor)}</p>
      <ul className="space-y-2">
        {rows.map(({ url, r }) => {
          const v = pick(r);
          const color = v == null ? "var(--muted)" : v <= good ? "#0cce6b" : v <= poor ? "#ffa400" : "#ff4e42";
          return (
            <li key={url} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-[13px]">
              <span className="truncate" title={url}>{pathOf(url)}</span>
              <span className="relative h-2.5 rounded-full bg-surface-muted">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v == null ? 0 : Math.max(3, (v / max) * 100)}%`, background: color }} />
                <span className="absolute -inset-y-[3px] w-px bg-border-strong" style={{ left: `${(good / max) * 100}%` }} aria-hidden />
              </span>
              <span className="text-right tabular-nums" style={{ color }}>{v == null ? "—" : fmt(v)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LighthouseSection({ runs, canEdit }: { runs: LhRun[]; canEdit: boolean }) {
  const last = runs[0];
  // the newest result for every page and device ever tested, so all pages show without choosing
  const pages = new Map<string, { mobile?: LhRow; desktop?: LhRow; at: string }>();
  for (const run of runs) for (const r of run.rows) {
    const p = pages.get(r.url) ?? { at: run.checkedAt };
    if (!p[r.device]) p[r.device] = r;
    pages.set(r.url, p);
  }
  const isHome = (u: string) => pathOf(u) === "/ (home)";
  const list = [...pages.entries()].sort(([a], [b]) => Number(isHome(b)) - Number(isHome(a)) || a.localeCompare(b));
  const mob = list.map(([url, p]) => ({ url, r: p.mobile })).filter((x): x is { url: string; r: LhRow } => !!x.r && !x.r.error);
  const avg = (k: (typeof CATS)[number][0], dev: "mobile" | "desktop") => {
    const v = list.map(([, p]) => p[dev]?.[k]).filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const series = (key: (typeof CATS)[number][0], dev: "mobile" | "desktop") => [...runs].reverse().map((x) => {
    const v = x.rows.filter((r) => r.device === dev && !r.error).map((r) => r[key]).filter((n): n is number => n != null);
    return { date: x.checkedAt.slice(0, 10), value: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null };
  }).filter((p) => p.value != null);
  return (
    <section className="mt-8 rounded-[10px] border border-border bg-surface p-5" aria-label="Lighthouse">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Lighthouse scores</h2>
          {last && <p className="text-xs text-muted">{list.length} page{list.length === 1 ? "" : "s"} · last test {last.checkedAt.slice(0, 10)} · refreshed weekly</p>}
        </div>
        <LighthouseRun canEdit={canEdit} />
      </div>
      {!last ? <p className="text-sm text-muted">No Lighthouse test yet.</p> : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {(["mobile", "desktop"] as const).map((dev) => (
              <div key={dev} className="rounded-[10px] border border-border bg-surface p-4">
                <p className="mb-3 text-sm font-semibold">{dev === "mobile" ? "Mobile" : "Desktop"} {list.length > 1 ? `average across ${list.length} pages` : "scores"}</p>
                <div className="flex flex-wrap justify-between gap-2">{CATS.map(([k, l]) => <ScoreRing key={k} score={avg(k, dev)} label={l} size={64} />)}</div>
              </div>
            ))}
          </div>
          <div className="space-y-3">{list.map(([url, p]) => <LhPage key={url} url={url} {...p} />)}</div>
          {mob.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <VitalBars title="Largest Contentful Paint" rows={mob} pick={(r) => r.lcp_ms} good={2500} poor={4000} unit="ms" />
              <VitalBars title="Total Blocking Time" rows={mob} pick={(r) => r.tbt_ms} good={200} poor={600} unit="ms" />
              <VitalBars title="Server response (TTFB)" rows={mob} pick={(r) => r.ttfb_ms} good={800} poor={1800} unit="ms" />
              <VitalBars title="Layout shift (CLS)" rows={mob} pick={(r) => r.cls} good={0.1} poor={0.25} unit="cls" />
            </div>
          )}
          {runs.length >= 2 && <MetricTrend title="Average scores over time" source="Lighthouse" options={[
            { key: "perf", label: "Performance (mobile)", data: series("performance", "mobile") }, { key: "perfd", label: "Performance (desktop)", data: series("performance", "desktop") },
            { key: "seo", label: "SEO", data: series("seo", "mobile") }, { key: "a11y", label: "Accessibility", data: series("accessibility", "mobile") }, { key: "bp", label: "Best practices", data: series("best_practices", "mobile") },
          ]} />}
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
  const [lighthouse, crux, renderMode] = await Promise.all([loadLighthouse(supabase, client.id), loadCrux(supabase, client.id), loadAuditRender(createAdminClient(), client.id)]);
  const cruxPanel = <CruxPanel run={crux.good} latest={crux.latest} right={<CruxRefresh canEdit={canEdit} />} />;
  const crawling = task?.data.status === "crawling";
  // a viewer arriving mid-crawl (or after it finished) collects the result right away instead of waiting for the daily job
  if (crawling && canEdit) after(async () => { try { await pollAudit(createAdminClient(), client.id); } catch { /* shown on the next visit */ } });
  const r = result?.data;
  const failed = task?.data.status === "failed" ? task.data.error : null;

  const errors = r ? r.issues.filter((i) => i.severity === "error").reduce((a, i) => a + i.count, 0) : 0;
  const warnings = r ? r.issues.filter((i) => i.severity === "warning").reduce((a, i) => a + i.count, 0) : 0;
  const notices = r ? r.issues.filter((i) => i.severity === "notice").reduce((a, i) => a + i.count, 0) : 0;
  const prev = r?.previous ?? null;

  // distributions over the stored page rows (the most problematic 500 when the crawl was larger)
  const rows = r?.rows ?? [];
  const sample = r && r.pages > rows.length ? `The ${fmtInt(rows.length)} pages with the most problems` : `All ${fmtInt(rows.length)} crawled pages`;
  const bin = (bins: { label: string; test: (p: AuditPage) => boolean; highlight?: boolean }[]) => bins.map((b) => ({ label: b.label, value: rows.filter(b.test).length, highlight: b.highlight }));
  const inRange = (v: number | null, lo: number, hi = Infinity) => v != null && v >= lo && v < hi;
  const statusBins = bin([
    { label: "2xx", test: (p) => inRange(p.status, 200, 300) }, { label: "3xx", test: (p) => inRange(p.status, 300, 400) },
    { label: "4xx", test: (p) => inRange(p.status, 400, 500), highlight: true }, { label: "5xx", test: (p) => inRange(p.status, 500), highlight: true },
    ...(rows.some((p) => p.status == null || p.status < 200) ? [{ label: "Other", test: (p: AuditPage) => p.status == null || p.status < 200 }] : []),
  ]);
  const wordBins = bin([
    { label: "<200", test: (p) => inRange(p.words, 0, 200), highlight: true }, { label: "200+", test: (p) => inRange(p.words, 200, 500) },
    { label: "500+", test: (p) => inRange(p.words, 500, 1000) }, { label: "1k+", test: (p) => inRange(p.words, 1000, 2000) }, { label: "2k+", test: (p) => inRange(p.words, 2000) },
  ]);
  const depthBins = bin([...[0, 1, 2, 3, 4].map((d) => ({ label: String(d), test: (p: AuditPage) => p.depth === d })), { label: "5+", test: (p: AuditPage) => inRange(p.depth, 5), highlight: true }]);
  const loadBins = bin([
    { label: "<0.5s", test: (p) => inRange(p.ms, 0, 500) }, { label: "0.5s+", test: (p) => inRange(p.ms, 500, 1000) }, { label: "1s+", test: (p) => inRange(p.ms, 1000, 2000) },
    { label: "2s+", test: (p) => inRange(p.ms, 2000, 3000), highlight: true }, { label: "3s+", test: (p) => inRange(p.ms, 3000), highlight: true },
  ]);
  const errPages = rows.filter((p) => p.errors > 0).length;
  const warnPages = rows.filter((p) => p.errors === 0 && p.warnings > 0).length;
  const depthProblems = [0, 1, 2, 3, 4, 5].map((d) => {
    const at = rows.filter((p) => (d === 5 ? inRange(p.depth, 5) : p.depth === d));
    return { label: d === 0 ? "Homepage" : d === 5 ? "5+ clicks" : `${d} click${d > 1 ? "s" : ""}`, values: { errors: at.reduce((a, p) => a + p.errors, 0), warnings: at.reduce((a, p) => a + p.warnings, 0) }, note: `${at.length} pages` };
  }).filter((x) => x.values.errors + x.values.warnings > 0);

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
      {failed && !crawling && <p role="alert" className="mb-5 rounded-[10px] border border-negative/40 bg-negative/10 p-3 text-sm text-negative">The last audit didn&apos;t complete: {failed}</p>}
      <div className="mb-6"><AuditRun canEdit={canEdit} busy={crawling} hasResult={Boolean(r)} mode={renderMode} /></div>

      {!r ? (
        !crawling && <><EmptyState title={`No audit for ${cache.target.domain} yet`} body="Nothing is crawled automatically when you open this page. Run the first audit above; the result is stored and refreshed weekly in the background." /><LighthouseSection runs={lighthouse} canEdit={canEdit} />{cruxPanel}</>
      ) : (
        <>
          <Highlights items={picks.slice(0, 4)} stableNote="Nothing notable in this audit." />

          <section aria-label="Audit summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
            <KpiCard label="On-page score" source="DFS" format={fmtInt} value={r.score} previous={prev?.score ?? null} hint="0-100, from the crawler. Compare between audits." />
            <KpiCard label="Pages crawled" source="DFS" format={fmtInt} value={r.pages} previous={null} />
            <KpiCard label="Errors" source="DFS" format={fmtInt} value={errors} previous={prev?.errors ?? null} higherIsBetter={false} hint="Error instances across the crawled pages." />
            <KpiCard label="Warnings" source="DFS" format={fmtInt} value={warnings} previous={prev?.warnings ?? null} higherIsBetter={false} />
            <KpiCard label="Healthy pages" source="DFS" format={(n) => (n === null ? "—" : `${fmtInt(n)} of ${fmtInt(r.pages)}`)} value={r.cleanPages} previous={null} hint="Pages with no errors or warnings." />
          </section>
          <p className="mt-2 text-xs text-muted">Crawled {r.finishedAt.slice(0, 10)} · crawl mode: <span className="font-medium text-foreground">{RENDER_MODES[r.render ?? "html"].label}</span>{r.render && r.render !== "html" ? " (JavaScript was run on each page)" : " (JavaScript not run)"}{prev ? ` · compared with ${prev.date}` : ""}</p>
          <LighthouseSection runs={lighthouse} canEdit={canEdit} />
          {cruxPanel}

          <section aria-label="Audit charts" className="mt-6 space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Fill><Donut title="Issues by severity" sub={`${fmtInt(r.issues.length)} issue types across ${fmtInt(r.pages)} pages`} center={fmtInt(errors + warnings + notices)} centerLabel="instances"
                items={[{ label: "Errors", value: errors, color: "var(--negative)" }, { label: "Warnings", value: warnings, color: "var(--warn)" }, { label: "Notices", value: notices, color: "var(--cat-other)" }]} /></Fill>
              <section className="rounded-[10px] border border-border bg-surface p-4" aria-label="Site-wide checks">
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
              <section className="rounded-[10px] border border-border bg-surface p-4 text-sm" aria-label="Link and duplicate totals">
                <h2 className="mb-2 text-sm font-semibold">Links and duplicates</h2>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  {([["Internal links", r.metrics.internalLinks], ["External links", r.metrics.externalLinks], ["Broken links", r.metrics.brokenLinks], ["Duplicate titles", r.metrics.duplicateTitle], ["Duplicate descriptions", r.metrics.duplicateDescription], ["Duplicate content pages", r.metrics.duplicateContent], ["Non-indexable pages", r.metrics.nonIndexable]] as const).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-right tabular-nums">{v === null ? "—" : fmtInt(v)}</dd></div>
                  ))}
                </dl>
              </section>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Columns title="Pages by status code" sub={sample} valueLabel="Pages" bins={statusBins} />
              <Columns title="Pages by word count" sub="Words on the page · under 200 is thin" valueLabel="Pages" bins={wordBins} />
              <Columns title="Pages by click depth" sub="Clicks from the homepage (0 = home)" valueLabel="Pages" bins={depthBins} />
              <Columns title="Pages by load time" sub="Full page load in the crawl" valueLabel="Pages" bins={loadBins} />
            </div>
            {r.issues.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-3">
                <Fill><BarList title="Pages affected, by issue type" valueLabel="Pages" items={[...r.issues].sort((a, b) => b.count - a.count).slice(0, 10).map((i) => ({ label: i.label, value: i.count, detail: SEV[i.severity].label.slice(0, -1) }))} /></Fill>
                <Fill><SplitBar title="Page health" sub={sample} total={r.pages ? `${Math.round((r.cleanPages / r.pages) * 100)}%` : "—"} totalLabel="healthy" segments={[
                  { label: "No problems", value: r.cleanPages, color: "var(--positive)" }, { label: "Warnings only", value: warnPages, color: "var(--warn)" }, { label: "With errors", value: errPages, color: "var(--negative)" },
                ]} /></Fill>
                <Fill><StackedBars title="Problems by click depth" sub="Error and warning instances at each depth" valueLabel="Instances" rows={depthProblems}
                  keys={[{ key: "errors", label: "Errors", color: "var(--negative)" }, { key: "warnings", label: "Warnings", color: "var(--warn)" }]} empty="No errors or warnings on the listed pages." /></Fill>
              </div>
            )}
          </section>

          <section aria-label="Issues found" className="mt-6 space-y-5">
            <h2 className="text-base font-semibold">Issues found</h2>
            {r.issues.length === 0 ? <p className="rounded-[10px] border border-dashed border-border p-6 text-sm text-muted">No issues were found in the crawled pages.</p> : (
              <>
                <IssueGroup severity="error" issues={r.issues.filter((i) => i.severity === "error")} />
                <IssueGroup severity="warning" issues={r.issues.filter((i) => i.severity === "warning")} />
                <IssueGroup severity="notice" issues={r.issues.filter((i) => i.severity === "notice")} />
              </>
            )}
          </section>

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
