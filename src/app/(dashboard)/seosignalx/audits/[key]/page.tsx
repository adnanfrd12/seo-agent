import { redirect } from "next/navigation";
import { BigScore, Card, CheckRow, CheckSection, NoAudit, SxHeader } from "@/components/seosignalx/ui";
import { AUDITS, auditLabel } from "@/lib/seosignalx/mcp";
import { audit, genericScore, sxPage } from "@/lib/seosignalx/view";

export const maxDuration = 120;

type Json = Record<string, unknown>;
type Check = { id?: string; name?: string; title?: string; label?: string; desc?: string; description?: string; status?: string; badge?: string; detail?: string; finding?: string; tutorial?: string | false };
type Section = { id?: string; title?: string; name?: string; passed?: number; total?: number; checks?: Check[] };

const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const prim = (v: unknown) => v == null || ["string", "number", "boolean"].includes(typeof v);
const human = (k: string) => k.replace(/^_+/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));
const when = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null);

function Fields({ title, obj }: { title: string; obj: Json }) {
  const rows = Object.entries(obj).filter(([, v]) => prim(v));
  if (!rows.length) return null;
  return (
    <Card title={title}>
      <dl className="grid gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        {rows.map(([k, v]) => {
          const s = show(v);
          return (
            <div key={k} className="contents">
              <dt className="text-muted">{human(k)}</dt>
              <dd className="min-w-0 break-words">{when(v) ?? (s.length > 300 ? <details><summary className="cursor-pointer text-muted">{s.slice(0, 120)}…</summary><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-muted p-2 font-mono text-xs">{s}</pre></details> : /^https?:\/\//.test(s) ? <a href={s} target="_blank" rel="noreferrer" className="break-all text-accent underline">{s}</a> : s)}</dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function Table({ title, rows }: { title: string; rows: Json[] }) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => prim(r[k]))))].slice(0, 8);
  if (!cols.length) return null;
  return (
    <Card title={title} sub={`${rows.length} rows${rows.length > 100 ? " · first 100 shown" : ""}`}>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-hairline bg-surface"><tr>{cols.map((c) => <th key={c} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">{human(c)}</th>)}</tr></thead>
          <tbody className="divide-y divide-hairline">
            {rows.slice(0, 100).map((r, i) => <tr key={i}>{cols.map((c) => { const s = show(r[c]); return <td key={c} className="max-w-xs break-words px-3 py-2 align-top">{/^https?:\/\//.test(s) ? <a href={s} target="_blank" rel="noreferrer" className="break-all text-accent underline">{s}</a> : s.length > 200 ? `${s.slice(0, 200)}…` : s}</td>; })}</tr>)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const checkName = (c: Check) => c.name ?? c.title ?? c.label ?? "Check";

/** Any saved SEOSignalX audit without its own page (Security, Duplicate, or one SEOSignalX adds later). */
export default async function OtherAuditPage({ params }: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await params).key);
  const own = AUDITS.find((a) => a.key === key);
  if (own) redirect(own.href);
  const v = await sxPage();
  if (!v) return null;
  const label = auditLabel(key);
  const a = audit<Json>(v.bundle, key);
  const header = <SxHeader title={label} description={`${label} results from SEOSignalX.`} project={v.bundle?.project?.name} analyzedAt={(typeof a?.result._reportAnalyzedAt === "string" ? a.result._reportAnalyzedAt : null) ?? a?.updatedAt} />;
  if (!a) return <>{header}<NoAudit label={label} reason={v.bundle?.project ? null : "This client has no SEOSignalX project."} /></>;
  const r = a.result;
  const g = genericScore(r);
  const sections = Array.isArray(r.sections) ? (r.sections as Section[]).filter((s) => Array.isArray(s.checks)) : [];
  const checks = Array.isArray(r.checks) ? (r.checks as Check[]) : [];
  const lists = Object.entries(r).filter(([k, val]) => k !== "sections" && k !== "checks" && Array.isArray(val) && val.length && isObj(val[0])) as [string, Json[]][];
  const plainLists = Object.entries(r).filter(([, val]) => Array.isArray(val) && val.length && prim(val[0])) as [string, unknown[]][];
  const objects = Object.entries(r).filter(([, val]) => isObj(val)) as [string, Json][];

  return (
    <>
      {header}
      {a.truncated && <p className="mb-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm">SEOSignalX&apos;s MCP sends at most 80 KB per answer, so this audit arrived partly.</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        {g.score != null && <BigScore value={g.score} caption={label} detail={g.summary} />}
        <div className={g.score != null ? "lg:col-span-2" : "lg:col-span-3"}><Fields title="Summary" obj={Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")))} /></div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {sections.map((s, i) => {
          const list = s.checks ?? [];
          const passed = s.passed ?? list.filter((c) => ["pass", "clean", "ok"].includes(String(c.status))).length;
          return (
            <CheckSection key={`${s.id || ""}-${i}`} title={s.title ?? s.name ?? `Section ${i + 1}`} passed={passed} total={s.total ?? list.length}>
              {list.map((c, j) => <CheckRow key={`${c.id || checkName(c)}-${j}`} status={c.status} name={checkName(c)} desc={c.desc ?? c.description ?? c.detail} badge={c.badge} href={typeof c.tutorial === "string" ? c.tutorial : null} />)}
            </CheckSection>
          );
        })}
        {checks.length > 0 && (
          <CheckSection title="Checks" passed={checks.filter((c) => ["pass", "clean", "ok"].includes(String(c.status))).length} total={checks.length}>
            {checks.map((c, j) => <CheckRow key={`${c.id || checkName(c)}-${j}`} status={c.status} name={checkName(c)} desc={c.desc ?? c.description ?? c.detail} badge={c.badge} />)}
          </CheckSection>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {objects.map(([k, o]) => <Fields key={k} title={human(k)} obj={o} />)}
        {lists.map(([k, rows]) => <Table key={k} title={human(k)} rows={rows} />)}
        {plainLists.map(([k, items]) => (
          <Card key={k} title={human(k)} sub={`${items.length} items`}>
            <ul className="max-h-72 divide-y divide-hairline overflow-y-auto text-sm">{items.slice(0, 200).map((x, i) => <li key={i} className="break-all px-4 py-1.5">{show(x)}</li>)}</ul>
          </Card>
        ))}
      </div>
    </>
  );
}
