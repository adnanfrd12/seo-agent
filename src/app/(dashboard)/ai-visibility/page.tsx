import { CheckCircle2, CircleDashed, Eye, Link2 } from "lucide-react";
import { MetricTrend } from "@/components/charts/metric-trend";
import { Highlights } from "@/components/dashboard/highlights";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { AiControls, RemoveButton } from "@/components/research/tracking-controls";
import { getSession } from "@/lib/analytics/client-context";
import { AI_EVERY_DAYS, loadAi, PROMPT_EST, suggestPrompts, VIS_MODEL, type AiRow } from "@/lib/ai/visibility";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadCache, resolveTarget } from "@/lib/dataforseo/research";
import type { Highlight } from "@/lib/overview/highlights";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

function Status({ r }: { r: AiRow }) {
  const l = r.latest;
  if (!l) return <span className="inline-flex items-center gap-1 text-xs text-muted"><CircleDashed className="size-3.5" aria-hidden /> Not checked yet</span>;
  if (l.mentioned && l.cited) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><CheckCircle2 className="size-3.5" aria-hidden /> Named and cited</span>;
  if (l.mentioned) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><CheckCircle2 className="size-3.5" aria-hidden /> Named in the answer</span>;
  if (l.cited) return <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><Link2 className="size-3.5" aria-hidden /> Cited as a source</span>;
  if (l.seen) return <span className="inline-flex items-center gap-1 text-xs font-medium text-[#D4970A]"><Eye className="size-3.5" aria-hidden /> Found by search, not used</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-negative"><CircleDashed className="size-3.5" aria-hidden /> Not visible</span>;
}

export default async function AiVisibilityPage() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const header = <TabHeader source={null} title="AI Visibility" description="Whether an AI assistant names or cites the business when people ask the questions your customers ask." guide={[
    { term: "Named", text: "The business or website name appears in the AI's answer." },
    { term: "Cited", text: "The website is one of the sources the answer links to, so readers can click through to it." },
    { term: "Found by search, not used", text: "The AI's web search found the website but the answer didn't use it. The content may not answer the question clearly enough." },
    { term: "What this measures", text: `Answers from Claude (${VIS_MODEL}) with live web search, run with your own Anthropic key. Other assistants such as ChatGPT or Gemini may answer differently, so use the score as a trend and a way to see who the AI recommends instead.` },
  ]} />;
  if (!process.env.ANTHROPIC_API_KEY) return <>{header}<EmptyState title="AI isn't configured" body="Add ANTHROPIC_API_KEY to the environment (and Vercel), then redeploy." /></>;

  const supabase = await createClient();
  const [ai, target] = await Promise.all([loadAi(supabase, client.id), resolveTarget(createAdminClient(), client.id)]);
  if (!ai.ok) return <>{header}<EmptyState title="AI visibility needs one database update" body="Apply the latest database migration (20261030000020_rank_tracking_ai_visibility.sql) in the Supabase SQL editor, then reload this page." /></>;
  if (!target) return <>{header}<EmptyState title="No website to check yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const { data: settings } = await supabase.from("clients").select("settings").eq("id", client.id).maybeSingle();
  const search = (settings?.settings as { ai_search?: boolean } | null)?.ai_search !== false;
  const cache = await loadCache(supabase, client.id);
  const have = new Set(ai.rows.map((r) => r.prompt.toLowerCase()));
  const kws = ((cache.get<Row[]>("ranked_keywords")?.data ?? []) as Row[]).filter((k) => typeof k.keyword === "string").sort((a, b) => Number(b.volume ?? 0) - Number(a.volume ?? 0)).map((k) => k.keyword as string);
  const suggestions = suggestPrompts(kws, [...have]).slice(0, 6);

  const cutoff = shiftDays(todayIn("UTC"), -(AI_EVERY_DAYS - 1));
  const due = ai.rows.filter((r) => !r.latest || r.latest.checked_on <= cutoff).length;
  const checked = ai.rows.filter((r) => r.latest);
  const named = checked.filter((r) => r.latest!.mentioned).length;
  const cited = checked.filter((r) => r.latest!.cited).length;
  const seenOnly = checked.filter((r) => r.latest!.seen && !r.latest!.mentioned && !r.latest!.cited);
  const invisible = checked.filter((r) => !r.latest!.seen && !r.latest!.mentioned && !r.latest!.cited);
  const unit = search ? PROMPT_EST : 0.008;
  const est = `$${((due || ai.rows.length) * unit).toFixed(2)}`;

  const picks: Highlight[] = [];
  if (ai.score !== null && ai.previousScore !== null && ai.score !== ai.previousScore) picks.push({ tone: ai.score > ai.previousScore ? "good" : "bad", title: `AI visibility ${ai.score > ai.previousScore ? "rose" : "fell"} from ${ai.previousScore}% to ${ai.score}%`, detail: "Share of tracked questions where the business is named or cited." });
  if (seenOnly.length) picks.push({ tone: "info", title: `Found but not used for ${seenOnly.length} question${seenOnly.length > 1 ? "s" : ""}`, detail: `e.g. “${seenOnly[0].prompt}”. The AI's search saw the website but the answer used other sources.`, action: "Add a page that answers that question directly, with clear headings and facts." });
  if (invisible.length) picks.push({ tone: "bad", title: `Not visible for ${invisible.length} question${invisible.length > 1 ? "s" : ""}`, detail: `e.g. “${invisible[0].prompt}”.`, action: "Check which sites the AI cites instead (below) and what they offer that this site doesn't." });
  if (ai.topSources.length) picks.push({ tone: "info", title: `${ai.topSources[0].domain} is cited most often instead`, detail: `Cited in ${ai.topSources[0].count} of ${checked.length} answers.` });

  return (
    <>
      {header}
      <p className="mb-4 text-xs text-muted">Website: <span className="font-medium text-foreground">{target.domain}</span> · {ai.rows.length} question{ai.rows.length === 1 ? "" : "s"} tracked{ai.lastChecked ? ` · last checked ${ai.lastChecked}` : ""}. Answers come from Claude Sonnet 5.5 on your Anthropic key; checks run weekly for active clients.</p>
      <div className="mb-6"><AiControls canEdit={canEdit} count={ai.rows.length} due={due} search={search} suggestions={suggestions} estimate={est} /></div>

      {ai.rows.length === 0 ? <EmptyState title="No questions tracked yet" body="Add the questions your customers would ask an AI assistant, or pick a suggestion above. Each check shows whether the business is named or cited in the answer." /> : checked.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">Questions added. Press &quot;Check now&quot; to run them.</p>
      ) : (
        <>
          <Highlights items={picks.slice(0, 4)} stableNote="No big change since the previous check." />
          <section aria-label="AI visibility summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="AI visibility" source="Claude" format={(n) => (n == null ? "—" : `${n}%`)} value={ai.score} previous={ai.previousScore} hint="Share of tracked questions where the business is named or cited." />
            <KpiCard label="Named in answers" source="Claude" format={(n) => (n == null ? "—" : `${n} of ${checked.length}`)} value={named} previous={null} />
            <KpiCard label="Cited as a source" source="Claude" format={(n) => (n == null ? "—" : `${n} of ${checked.length}`)} value={cited} previous={null} />
            <KpiCard label="Not visible" source="Claude" format={(n) => (n == null ? "—" : `${n} of ${checked.length}`)} value={invisible.length} previous={null} higherIsBetter={false} />
          </section>

          {ai.trend.length >= 2 && <div className="mt-6"><MetricTrend title="AI visibility over time" source="Claude" options={[{ key: "score", label: "Visible questions (%)", data: ai.trend.map((t) => ({ date: t.date, value: t.score })) }]} /></div>}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
            <section aria-label="Questions" className="space-y-2">
              <h2 className="text-base font-semibold">Questions</h2>
              <ul className="space-y-2">
                {ai.rows.map((r) => (
                  <li key={r.id}>
                    <details className="rounded-xl border border-border bg-surface">
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <span className="min-w-0 flex-1 font-medium">{r.prompt}</span>
                        <Status r={r} />
                      </summary>
                      <div className="space-y-2 border-t border-border px-4 py-3 text-sm">
                        {r.latest ? (
                          <>
                            <p className="whitespace-pre-line text-muted">{r.latest.answer ?? "No answer text."}</p>
                            {r.latest.sources.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Sources the answer cites</p><ul className="mt-1 space-y-0.5 text-xs">{r.latest.sources.map((s) => <li key={s.domain} className="break-all"><a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{s.title ?? s.domain}</a> <span className="text-muted">· {s.domain}</span></li>)}</ul></div>}
                            <p className="text-xs text-muted">Checked {r.latest.checked_on} · {r.latest.used_search ? "with live web search" : "from Claude's own knowledge"} · ${r.latest.cost.toFixed(3)}</p>
                          </>
                        ) : <p className="text-muted">Not checked yet.</p>}
                        {canEdit && <div className="flex justify-end"><RemoveButton kind="ai" id={r.id} label={r.prompt} /></div>}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
            <aside className="space-y-4">
              <section className="rounded-xl border border-border bg-surface p-4" aria-label="Most cited websites">
                <h2 className="text-sm font-semibold">Cited instead of you</h2>
                <p className="mb-2 text-xs text-muted">Websites the AI links to most often in these answers.</p>
                {ai.topSources.length === 0 ? <p className="text-sm text-muted">No other sources recorded.</p> : (
                  <ul className="space-y-1 text-sm">{ai.topSources.map((s) => <li key={s.domain} className="flex justify-between gap-2"><span className="break-all">{s.domain}</span><span className="shrink-0 tabular-nums text-muted">{fmtInt(s.count)}</span></li>)}</ul>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
