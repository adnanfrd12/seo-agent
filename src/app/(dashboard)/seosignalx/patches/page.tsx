import { Card, Empty, Pill, Stat, SxHeader } from "@/components/seosignalx/ui";
import { sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

const when = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function PatchesPage() {
  const v = await sxPage();
  if (!v) return null;
  const header = <SxHeader title="Patches" description="Reversible SEO fixes prepared in SEOSignalX." project={v.bundle?.project?.name} />;
  if (!v.bundle?.project) return <>{header}<Empty title="No SEOSignalX project for this client" body="SEOSignalX has no project for this client's website." /></>;
  const list = v.bundle.patches;
  const by = (s: string) => list.filter((p) => String(p.status ?? "").toLowerCase() === s).length;

  return (
    <>
      {header}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="All patches" value={list.length} />
        <Stat label="Published" value={by("published")} />
        <Stat label="Draft" value={by("draft")} />
        <Stat label="Unpublished" value={by("unpublished")} />
      </section>
      {list.length ? (
        <Card title="Patches">
          <ul className="divide-y divide-hairline">
            {list.map((p, i) => (
              <li key={String(p.id ?? i)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{String(p.title ?? p.name ?? p.type ?? "Patch")}</p>
                  <p className="text-xs text-muted">{p.type ? `${String(p.type)} · ` : ""}updated {when(p.updatedAt ?? p.createdAt)}</p>
                </div>
                <Pill tone={p.status === "published" ? "green" : p.status === "draft" ? "blue" : "gray"}>{String(p.status ?? "—")}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Empty title="No patches yet" body="Fixes prepared in SEOSignalX for this website appear here." />
      )}
    </>
  );
}
