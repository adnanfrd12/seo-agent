import { BarRow, BigScore, Card, CheckRow, NoAudit, Pill, Stat, SxHeader, type Tone } from "@/components/seosignalx/ui";
import { audit, scores, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

type Check = { id?: string; name: string; desc?: string; priority?: string; status?: string; detail?: string; location?: string; occurrences?: number; finding?: string };
type Crawl = {
  _reportAnalyzedAt?: string; totalChecks?: number; clean?: number; highPriority?: number; medium?: number; low?: number; pageSourceSize?: string; url?: string;
  sections?: { id: string; title: string; checks: Check[] }[];
  fetchDetails?: { status?: number; htmlStatus?: number; loadTime?: number; sizeKb?: number; links?: number; resources?: number; sitemaps?: number; wordCount?: number; canonicalUrl?: string; robotsMeta?: string; contentType?: string };
};
const PRI: Record<string, Tone> = { HIGH: "red", MEDIUM: "orange", LOW: "blue" };
const ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export default async function CrawlPage() {
  const v = await sxPage();
  if (!v) return null;
  const a = audit<Crawl>(v.bundle, "crawlOptimization");
  const header = <SxHeader title="Crawl Optimization Checker" description="Code, feeds and headers that waste crawl budget." project={v.bundle?.project?.name} analyzedAt={a?.result._reportAnalyzedAt ?? a?.updatedAt} />;
  if (!a) return <>{header}<NoAudit label="Crawl Optimization" reason={v.bundle?.project ? null : "This client has no SEOSignalX project."} /></>;
  const r = a.result, f = r.fetchDetails ?? {};
  const score = scores(v.bundle).per.crawlOptimization?.score ?? null;
  const found = (r.totalChecks ?? 0) - (r.clean ?? 0);
  const all = (r.sections ?? []).flatMap((s) => s.checks.map((c) => ({ ...c, area: s.title })))
    .sort((x, y) => Number(x.status !== "found") - Number(y.status !== "found") || (ORDER[x.priority ?? ""] ?? 3) - (ORDER[y.priority ?? ""] ?? 3));
  const sev = [["High", r.highPriority ?? 0, "#e11d48"], ["Medium", r.medium ?? 0, "#f97316"], ["Low", r.low ?? 0, "#3b82f6"], ["Clean", r.clean ?? 0, "#10b981"]] as const;
  const total = sev.reduce((s, x) => s + x[1], 0) || 1;

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-3">
        <BigScore value={score} caption="Crawlability score" detail={`${r.clean ?? 0} of ${r.totalChecks ?? 0} checks clean`} />
        <Card title="Issues by severity" sub={`${found} checks need attention.`}>
          <div className="space-y-3 p-4">
            <div className="flex h-2.5 overflow-hidden rounded-full">{sev.map(([l, n, c]) => <span key={l} style={{ width: `${(n / total) * 100}%`, background: c }} title={`${l}: ${n}`} />)}</div>
            <ul className="grid grid-cols-2 gap-2 text-sm">{sev.map(([l, n, c]) => <li key={l} className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2"><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: c }} />{l}</span><b className="tabular-nums">{n}</b></li>)}</ul>
          </div>
        </Card>
        <Card title="By area">
          <ul className="space-y-3 p-4">
            {(r.sections ?? []).map((s) => {
              const n = s.checks.filter((c) => c.status === "found").length;
              return <BarRow key={s.id} label={s.title} value={n} max={s.checks.length} right={n ? `${n} found / ${s.checks.length}` : `Clean / ${s.checks.length}`} />;
            })}
          </ul>
        </Card>
      </div>

      <h2 className="mb-3 mt-6 text-sm font-semibold">Crawl overview</h2>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Crawl status" value={`HTTP ${f.status ?? "—"}`} sub={f.status === 200 ? "Success" : ""} />
        <Stat label="HTML status" value={`HTTP ${f.htmlStatus ?? "—"}`} sub={f.htmlStatus === 200 ? "Success" : ""} />
        <Stat label="Load time" value={f.loadTime != null ? `${f.loadTime} ms` : "—"} sub={f.loadTime != null ? (f.loadTime > 3000 ? "Slow" : "Good") : ""} />
        <Stat label="HTML size" value={f.sizeKb != null ? `${f.sizeKb} KB` : "—"} sub={f.sizeKb != null ? (f.sizeKb > 500 ? "Heavy" : "Good") : ""} />
        <Stat label="Links" value={f.links ?? "—"} />
        <Stat label="Resources" value={f.resources ?? "—"} />
        <Stat label="Sitemaps" value={f.sitemaps ?? "—"} sub="Detected" />
        <Stat label="Word count" value={f.wordCount ?? "—"} sub={f.wordCount != null ? (f.wordCount >= 300 ? "Good" : "Thin") : ""} />
      </section>

      <div className="mt-6 space-y-4">
        <Card title="Checks" sub={`${all.length} checks · issues first`}>
          <ul className="divide-y divide-hairline">
            {all.map((c, i) => (
              // some SEOSignalX checks have an empty id: the position keeps keys unique
              <CheckRow key={`${c.area}-${c.id || c.name}-${i}`} status={c.status} name={c.name} desc={c.desc}
                badge={c.priority && <Pill tone={PRI[c.priority] ?? "gray"}>{c.priority}</Pill>}
                extra={
                  <div className="mt-1 space-y-1">
                    {c.finding && <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface-muted px-2 py-1 font-mono text-[11px] text-secondary">{c.finding}</pre>}
                    <p className="text-[11px] text-muted">{c.area}{c.location ? ` · ${c.location}` : ""}{c.occurrences ? ` · ${c.occurrences} occurrence(s)` : ""}{c.detail ? ` · ${c.detail}` : ""}</p>
                  </div>
                } />
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
