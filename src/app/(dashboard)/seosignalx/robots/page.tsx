import { BigScore, Card, CheckRow, NoAudit, Stat, SxHeader } from "@/components/seosignalx/ui";
import { audit, scores, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

type Robots = { _reportAnalyzedAt?: string; url?: string; robotsContent?: string; totalChecks?: number; passed?: number; notFound?: number; sitemaps?: string[]; checks?: { name: string; desc?: string; status?: string; badge?: string }[] };

export default async function RobotsPage() {
  const v = await sxPage();
  if (!v) return null;
  const a = audit<Robots>(v.bundle, "robots");
  const header = <SxHeader title="Robots.txt Analyzer" description="What search engines may crawl, and which rules are missing." project={v.bundle?.project?.name} analyzedAt={a?.result._reportAnalyzedAt ?? a?.updatedAt} />;
  if (!a) return <>{header}<NoAudit label="Robots.txt" reason={v.bundle?.project ? null : "This client has no SEOSignalX project."} /></>;
  const r = a.result;
  const checks = r.checks ?? [];
  const passed = checks.filter((c) => c.status === "pass");
  const missing = checks.filter((c) => c.status !== "pass");
  const lines = (r.robotsContent ?? "").split(/\r?\n/);
  const count = (re: RegExp) => lines.filter((l) => re.test(l.trim())).length;
  const agents = [...new Set(lines.map((l) => /^user-agent:\s*(.+)$/i.exec(l.trim())?.[1]).filter(Boolean))] as string[];
  const protectedPaths = lines.map((l) => /^disallow:\s*(\S+)/i.exec(l.trim())?.[1]).filter(Boolean) as string[];

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-3">
        <BigScore value={scores(v.bundle).per.robots?.score ?? null} caption="Robots.txt health" detail={`${r.passed ?? passed.length} of ${r.totalChecks ?? checks.length} checks passed`} />
        <Card title="Key checks" className="lg:col-span-2">
          <ul className="grid divide-y divide-hairline sm:grid-cols-2 sm:divide-y-0">
            {passed.map((c) => <CheckRow key={c.name} status={c.status} name={c.name} desc={c.desc} badge={c.badge} />)}
          </ul>
        </Card>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Potential issues" value={missing.length} sub="Rules not found" />
        <Stat label="Protected resources" value={protectedPaths.length} sub={protectedPaths.join(", ") || "—"} />
        <Stat label="User-agents" value={agents.length} sub={agents.join(", ") || "—"} />
        <Stat label="Sitemap links" value={r.sitemaps?.length ?? count(/^sitemap:/i)} />
        <Stat label="Disallow / Allow" value={`${count(/^disallow:/i)} / ${count(/^allow:/i)}`} sub="rules" />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Issues & recommendations" sub={`${passed.length} passed · ${missing.length} not found`}>
          <ul className="divide-y divide-hairline">
            {[...missing, ...passed].map((c) => <CheckRow key={c.name} status={c.status} name={c.name} desc={c.desc} badge={c.badge} />)}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="robots.txt" sub={r.url}>
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs">{r.robotsContent || "Empty"}</pre>
          </Card>
          {r.sitemaps?.length ? (
            <Card title="Sitemaps declared">
              <ul className="divide-y divide-hairline text-sm">{r.sitemaps.map((s) => <li key={s} className="px-4 py-2"><a href={s} target="_blank" rel="noreferrer" className="break-all text-accent underline">{s}</a></li>)}</ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
