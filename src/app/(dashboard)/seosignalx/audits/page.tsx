import Link from "next/link";
import { Card, Empty, Pill, ScoreRing, SxHeader } from "@/components/seosignalx/ui";
import { AUDITS } from "@/lib/seosignalx/mcp";
import { scores, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

/** Every audit SEOSignalX has saved for the client's project, including ones without their own sub-tab. */
export default async function AllAuditsPage() {
  const v = await sxPage();
  if (!v) return null;
  const header = <SxHeader title="All audits" description="Every audit SEOSignalX has saved for this website." project={v.bundle?.project?.name} />;
  if (!v.bundle?.project) return <>{header}<Empty title="No SEOSignalX project for this client" body="SEOSignalX has no project for this client's website." /></>;
  const s = scores(v.bundle);
  const rows = [
    ...AUDITS.filter((a) => v.bundle!.audits[a.key]).map((a) => ({ key: a.key, label: a.label, href: a.href, score: s.per[a.key]?.score ?? null, summary: s.per[a.key]?.summary ?? "", updatedAt: v.bundle!.audits[a.key]!.updatedAt, truncated: Boolean(v.bundle!.audits[a.key]!.truncated), own: true })),
    ...s.extra.map((x) => ({ ...x, own: false })),
  ];

  return (
    <>
      {header}
      {rows.length ? (
        <Card title={`${rows.length} saved audit${rows.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-hairline">
            {rows.map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-muted">
                  <ScoreRing value={r.score} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.label}</p>
                    <p className="text-xs text-muted">{r.summary}{r.summary ? " · " : ""}{new Date(r.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                  {r.truncated && <Pill tone="orange">Partial</Pill>}
                  {!r.own && <Pill tone="blue">New</Pill>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : <Empty title="No saved audits yet" body="Audits run in SEOSignalX for this website appear here." />}
    </>
  );
}
