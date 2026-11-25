import { Card, CheckRow, NoAudit, ScoreRing, Stat, SxHeader } from "@/components/seosignalx/ui";
import { cn } from "@/lib/utils";
import { audit, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

type Device = { label?: string; score?: number | null; available?: boolean; categories?: Record<string, number | null> };
type Speed = {
  _reportAnalyzedAt?: string; url?: string; mobile?: Device; desktop?: Device;
  cwv?: { metric: string; value: string; full: string; good: boolean | null }[];
  sections?: { id: string; title: string; passed: number; total: number; evaluated?: number; unavailable?: number; checks: { name: string; desc?: string; status?: string; affected?: number }[] }[];
  opportunities?: { title?: string; description?: string; savings?: string; displayValue?: string }[];
  resourceSummary?: { totalResources?: number; cdnResources?: number; cdnExamples?: string[] };
  testMeta?: { device?: string; durationMs?: number; testedAt?: string };
};
const CATS: [string, string][] = [["performance", "Performance"], ["accessibility", "Accessibility"], ["bestPractices", "Best Practices"], ["seo", "SEO"]];
const LIMIT: Record<string, string> = { LCP: "≤ 2.5 s", FCP: "≤ 1.8 s", CLS: "≤ 0.1", TBT: "≤ 200 ms", SI: "≤ 3.4 s", TTFB: "≤ 800 ms" };

function DeviceCard({ d, title }: { d?: Device; title: string }) {
  return (
    <Card title={title} right={<ScoreRing value={d?.available ? d.score ?? null : null} size={48} />}>
      <ul className="grid grid-cols-2 gap-2 p-4">
        {CATS.map(([k, label]) => {
          const val = d?.categories?.[k];
          return <li key={k} className="rounded-lg bg-surface-muted px-3 py-2"><p className="text-xs text-muted">{label}</p><p className="text-sm font-semibold tabular-nums">{val == null ? "Not tested" : Math.round(val <= 1 ? val * 100 : val)}</p></li>;
        })}
      </ul>
    </Card>
  );
}

export default async function SpeedPage() {
  const v = await sxPage();
  if (!v) return null;
  const a = audit<Speed>(v.bundle, "speed");
  const header = <SxHeader title="Speed Test Tool" description="Website performance from Google PageSpeed Insights." project={v.bundle?.project?.name} analyzedAt={a?.result.testMeta?.testedAt ?? a?.result._reportAnalyzedAt ?? a?.updatedAt} />;
  if (!a) return <>{header}<NoAudit label="Speed" reason={v.bundle?.project ? null : "This client has no SEOSignalX project."} /></>;
  const r = a.result;

  return (
    <>
      {header}
      <div className="grid gap-4 md:grid-cols-2">
        <DeviceCard d={r.mobile} title="Mobile Score" />
        <DeviceCard d={r.desktop} title="Desktop Score" />
      </div>

      <Card className="mt-6" title="Core Web Vitals">
        <ul className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
          {(r.cwv ?? []).map((m) => (
            <li key={m.metric} className={cn("rounded-lg border p-3", m.good === true ? "border-emerald-500/40 bg-emerald-500/5" : m.good === false ? "border-rose-500/40 bg-rose-500/5" : "border-border bg-surface-muted")}>
              <p className="text-xs font-semibold">{m.metric}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{m.value}</p>
              <p className="text-[11px] text-muted">{m.value === "--" ? "Not tested" : LIMIT[m.metric] ?? ""}</p>
              <p className="text-[11px] text-muted">{m.full}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {(r.sections ?? []).map((s) => (
          <Card key={s.id} title={s.title}
            right={<span className="text-xs text-muted tabular-nums">{s.passed}/{s.evaluated ?? s.total}{s.unavailable ? ` · ${s.unavailable} not tested` : ""}</span>}>
            <ul className="divide-y divide-hairline">
              {s.checks.map((c) => <CheckRow key={c.name} status={c.status} name={c.name} desc={c.desc} badge={c.affected ? `${c.affected} affected` : undefined} />)}
            </ul>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Opportunities for improvement" className="lg:col-span-2">
          {r.opportunities?.length ? (
            <ul className="divide-y divide-hairline">
              {r.opportunities.map((o, i) => <li key={i} className="px-4 py-3 text-sm"><p className="font-medium">{o.title ?? "Opportunity"}</p>{o.description && <p className="text-xs text-muted">{o.description}</p>}{(o.savings ?? o.displayValue) && <p className="text-xs">{o.savings ?? o.displayValue}</p>}</li>)}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-muted">No opportunities reported in the last SEOSignalX test.</p>}
        </Card>
        <div className="grid gap-3">
          <Stat label="Resources" value={r.resourceSummary?.totalResources ?? "—"} sub={`${r.resourceSummary?.cdnResources ?? 0} served from a CDN`} />
          <Stat label="Test duration" value={r.testMeta?.durationMs ? `${Math.round(r.testMeta.durationMs / 1000)} s` : "—"} sub={`Device: ${r.testMeta?.device || "Not reported"}`} />
        </div>
      </div>
    </>
  );
}
