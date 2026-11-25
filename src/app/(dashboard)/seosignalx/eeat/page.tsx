import { BarRow, BigScore, Card, CheckRow, CheckSection, NoAudit, Stat, SxHeader } from "@/components/seosignalx/ui";
import { audit, scores, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

type Item = { label?: string; value?: string; href?: string; meta?: string };
type Check = { id?: string; name: string; desc?: string; description?: string; status?: string; badge?: string; tutorial?: string | false; expandedData?: { type?: string; title?: string; items?: Item[]; probes?: Item[] } };
type Eeat = { rating?: string; sections?: { id: string; title: string; passed?: number; failed?: number; unknown?: number; total?: number; checks?: Check[] }[] };

const decode = (s?: string) => (s ?? "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

export default async function EeatPage() {
  const v = await sxPage();
  if (!v) return null;
  const a = audit<Eeat>(v.bundle, "eeat");
  const header = <SxHeader title="EEAT Audit" description="Experience, expertise, authority and trust signals on the website." project={v.bundle?.project?.name} analyzedAt={a?.updatedAt} />;
  if (!a) return <>{header}<NoAudit label="E-E-A-T" reason={v.bundle?.project ? null : "This client has no SEOSignalX project."} /></>;
  const sections = a.result.sections ?? [];
  const passed = sections.reduce((s, x) => s + (x.passed ?? 0), 0);
  const failed = sections.reduce((s, x) => s + (x.failed ?? 0), 0);
  const unknown = sections.reduce((s, x) => s + (x.unknown ?? 0), 0);
  const total = sections.reduce((s, x) => s + (x.total ?? 0), 0);

  return (
    <>
      {header}
      {a.truncated && (
        <p className="mb-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm">
          SEOSignalX&apos;s MCP sends at most 80 KB per answer, so this audit arrived partly: {sections.length} sections are shown. The score below covers these sections only.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <BigScore value={scores(v.bundle).per.eeat?.score ?? null} caption={`E-E-A-T score${a.result.rating ? ` · ${a.result.rating}` : ""}`} detail={`${passed} of ${total} checks passed`} />
        <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-4">
          <Stat label="Passed" value={passed} sub={`of ${total}`} />
          <Stat label="Failed" value={failed} sub="need attention" />
          <Stat label="Unknown" value={unknown} sub="not verified" />
          <Stat label="Automated" value={total} sub="total checks" />
        </div>
      </div>

      <Card className="mt-6" title="By section">
        <ul className="grid gap-3 p-4 md:grid-cols-2">
          {sections.map((s) => <BarRow key={s.id} label={s.title} value={(s.total ?? 0) - (s.passed ?? 0)} max={s.total ?? 0} right={`${s.passed ?? 0}/${s.total ?? 0} passed`} />)}
        </ul>
      </Card>

      <h2 className="mb-3 mt-6 text-sm font-semibold">Automated checks ({total})</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {sections.map((s) => (
          <CheckSection key={s.id} title={s.title} passed={s.passed ?? 0} total={s.total ?? 0}>
            {(s.checks ?? []).map((c) => {
              const items = c.expandedData?.items ?? c.expandedData?.probes ?? [];
              return (
                <CheckRow key={`${c.id || c.name}`} status={c.status} name={c.name} desc={c.badge ?? c.desc ?? c.description}
                  href={typeof c.tutorial === "string" ? c.tutorial : null}
                  extra={items.length ? (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-muted">{c.expandedData?.title ?? "Details"} ({items.length})</summary>
                      <ul className="mt-1 space-y-0.5">
                        {items.slice(0, 25).map((it, i) => (
                          <li key={i} className="break-all"><span className="text-secondary">{decode(it.label)}</span>{it.value && <> · {it.href ? <a href={it.href} target="_blank" rel="noreferrer" className="text-accent underline">{decode(it.value)}</a> : decode(it.value)}</>}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null} />
              );
            })}
            {(s.checks?.length ?? 0) < (s.total ?? 0) && <li className="px-4 py-2 text-xs text-muted">{(s.total ?? 0) - (s.checks?.length ?? 0)} more check(s) weren&apos;t included in SEOSignalX&apos;s answer.</li>}
          </CheckSection>
        ))}
      </div>
    </>
  );
}
