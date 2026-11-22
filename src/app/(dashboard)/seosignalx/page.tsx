import Link from "next/link";
import { Activity, Bot, FileCode2, Gauge, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { Card, Empty, Pill, ScoreCard, ScoreRing, SxHeader } from "@/components/seosignalx/ui";
import { SxSync } from "@/components/seosignalx/sync";
import { AUDITS } from "@/lib/seosignalx/mcp";
import { scores, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120; // the first visit reads SEOSignalX's MCP server

const ICON = { eeat: <ShieldCheck className="size-4" />, semantic: <Sparkles className="size-4" />, speed: <Gauge className="size-4" />, robots: <Bot className="size-4" />, crawlOptimization: <Activity className="size-4" /> };

export default async function SeoSignalXDashboard() {
  const v = await sxPage();
  if (!v) return null;
  if (!v.configured) return <Empty title="SEOSignalX isn't connected" body="Add SEOSIGNALX_MCP_TOKEN to the environment, then redeploy." />;
  const b = v.bundle;
  const p = b?.project ?? null;
  if (!p) {
    return (
      <>
        <SxHeader title="Welcome to SEOSignalX" description="SEOSignalX audits for this client, read from SEOSignalX's MCP server." />
        <Empty title="No SEOSignalX project for this client" body={b?.error ?? `SEOSignalX has no project for this client's website.${b?.projects.length ? ` Projects in SEOSignalX: ${b.projects.map((x) => x.domain).join(", ")}.` : ""}`} />
      </>
    );
  }
  const s = scores(b);
  const lastAudit = Object.values(b!.audits).map((a) => a?.updatedAt ?? "").sort().at(-1) ?? null;

  return (
    <>
      <SxHeader title="Welcome to SEOSignalX" description={`Monitoring ${p.domain} - Track your SEO performance`} project={p.name} analyzedAt={lastAudit}
        right={<SxSync fetchedAt={b!.fetchedAt} />} />
      {b!.error && <p role="alert" className="mb-4 rounded-lg bg-accent-soft p-3 text-sm text-negative">Last sync: {b!.error}</p>}

      <section aria-label="Audit scores" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AUDITS.map((a) => {
          const sc = s.per[a.key];
          return <ScoreCard key={a.key} href={sc ? a.href : undefined} icon={ICON[a.key]} title={a.label} summary={sc?.summary ?? "Not run in SEOSignalX yet"} score={sc?.score ?? null} status={sc ? "done" : "not run"} />;
        })}
        {s.extra.map((x) => <ScoreCard key={x.key} href={x.href} icon={<ShieldCheck className="size-4" />} title={x.label} summary={x.summary} score={x.score} status="done" />)}
        <ScoreCard icon={<Activity className="size-4" />} title="Overall" summary={`Average of ${s.done} completed checks`} score={s.overall} status={s.done ? "done" : "not run"} />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Project" sub="From SEOSignalX">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <dt className="text-muted">Name</dt><dd className="font-medium">{p.name}</dd>
            <dt className="text-muted">Website</dt><dd><a href={p.fullUrl} target="_blank" rel="noreferrer" className="text-accent underline">{p.domain}</a></dd>
            <dt className="text-muted">Created</dt><dd>{new Date(p.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</dd>
            <dt className="text-muted">Updated</dt><dd>{new Date(p.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</dd>
            <dt className="text-muted">Last crawl</dt><dd>{p.lastCrawlAt ? new Date(p.lastCrawlAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd>
          </dl>
        </Card>

        <Card title="Saved audits" sub="Each audit as last run in SEOSignalX">
          <ul className="divide-y divide-hairline">
            {AUDITS.map((a) => {
              const au = b!.audits[a.key];
              return (
                <li key={a.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <ScoreRing value={s.per[a.key]?.score ?? null} size={36} />
                  <div className="min-w-0 flex-1">
                    {au ? <Link href={a.href} className="font-medium hover:underline">{a.label}</Link> : <span className="font-medium text-muted">{a.label}</span>}
                    <p className="text-xs text-muted">{au ? new Date(au.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Not run yet"}</p>
                  </div>
                  {au?.truncated && <Pill tone="orange">Partial</Pill>}
                </li>
              );
            })}
            {s.extra.map((x) => (
              <li key={x.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <ScoreRing value={x.score} size={36} />
                <div className="min-w-0 flex-1">
                  <Link href={x.href} className="font-medium hover:underline">{x.label}</Link>
                  <p className="text-xs text-muted">{new Date(x.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                {x.truncated && <Pill tone="orange">Partial</Pill>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Wrench className="size-4 text-muted" />SEO fixes (patches)</span>} sub="Draft, published and unpublished patches"
          right={<Link href="/seosignalx/patches" className="text-xs text-accent underline">View all</Link>}>
          {b!.patches.length ? (
            <ul className="divide-y divide-hairline">
              {b!.patches.slice(0, 6).map((x, i) => (
                <li key={String(x.id ?? i)} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="truncate">{String(x.title ?? x.name ?? x.type ?? "Patch")}</span>
                  <Pill tone={x.status === "published" ? "green" : x.status === "draft" ? "blue" : "gray"}>{String(x.status ?? "—")}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-4 py-8 text-center">
              <FileCode2 className="size-6 text-faint" aria-hidden />
              <p className="mt-2 text-sm font-medium">No patches yet</p>
              <p className="text-xs text-muted">Patches created in SEOSignalX appear here.</p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
