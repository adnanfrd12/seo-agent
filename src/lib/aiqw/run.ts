import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicFor } from "@/lib/ai/claude";
import type { Profile } from "@/lib/dataforseo/local";
import { DfsError } from "@/lib/dataforseo/client";
import { ga4WinsFor } from "@/lib/ga4x/load";
import { clientNap } from "@/lib/reviews/listings";
import { pageTable } from "@/lib/gscx/analysis";
import type { G as GscG } from "@/lib/gscx/g";
import { gscWinsFor } from "@/lib/gscx/load";
import { pathOf } from "@/lib/gscx/model";
import { baselineFor, buildCandidates, pickForScope, weightedGain } from "./candidates";
import { batchCustomId, chunkCandidates, CONCURRENCY, pool, repairItem, runChunk, submitBatch, systemBlocks, type ChunkResult } from "./claude";
import { loadPlatformData, platformCandidates } from "./platforms";
import { dfsMonthSpend, dfsTarget, loadGaps, loadKw, loadSerp, refreshKw, refreshSerp } from "./dfs";
import { systemPrompt } from "./prompt";
import type { QuickWinItem, QuickWinsOutput } from "./schema";
import { readSettings, type AiQwSettings } from "./settings";
import { claudeMonthSpend, loadItems, loadRun, saveCandidates, saveItems, savePending, saveRun } from "./store";
import { SOURCE_LABEL, type Candidate, type Depth, type RunState, type Scope, type Source, type StoredWin } from "./types";
import { scoreOf, validateItem } from "./validate";

/** Rough cost of one chunk on each model, used for the budget check before a run. */
export const EST_PER_CHUNK = { "claude-opus-5-5": 0.6, "claude-sonnet-5-5": 0.3 } as const;
/** A live run must finish inside the 300-second function limit: no new chunk starts this long after the run began. */
const CHUNK_DEADLINE_MS = 170_000;
const DAY = 86_400_000;

export const STEP_LABELS = [
  ["fresh", "Checking data freshness"],
  ["gsc", "Syncing Search Console"],
  ["ga4", "Syncing Google Analytics 4"],
  ["platforms", "Reading Business Profile, Bing, Clarity, social and SEOSignalX"],
  ["dataforseo", "Fetching DataForSEO"],
  ["crawl", "Reading the site crawl"],
  ["candidates", "Finding candidates"],
  ["claude", "Claude writing quick wins"],
  ["check", "Checking Claude's answers"],
  ["save", "Saving and ranking"],
] as const;

type StepState = RunState["steps"][number]["state"];
/** Updates one step (with its elapsed time) and saves the run, so the page can show live progress. */
function stepper(admin: SupabaseClient, run: RunState) {
  const t0 = new Map<string, number>();
  return async (key: string, state: StepState, detail?: string) => {
    const s = run.steps.find((x) => x.key === key);
    if (!s) return;
    if (state === "running") t0.set(key, Date.now());
    else if (t0.has(key)) s.ms = Date.now() - t0.get(key)!;
    s.state = state;
    if (detail !== undefined) s.detail = detail;
    await saveRun(admin, run);
  };
}
const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};
const stale = (iso: string | null | undefined) => (iso && Date.now() - Date.parse(iso) > DAY ? " (stale)" : "");
const n = (v: number) => v.toLocaleString("en-US");

export async function clientSettings(admin: SupabaseClient, clientId: string): Promise<{ settings: AiQwSettings; name: string; all: Record<string, unknown> }> {
  const [{ data }, nap] = await Promise.all([admin.from("clients").select("name, settings").eq("id", clientId).maybeSingle(), clientNap(admin, clientId).catch(() => null)]);
  const all = (data?.settings ?? {}) as Record<string, unknown>;
  const settings = readSettings(all.ai_qw);
  // business facts not filled in on the settings page come from the Business Profile (name, phone, city)
  const b = settings.business;
  settings.business = { ...b, name: b.name || nap?.name || "", phone: b.phone || nap?.phone || "", towns: b.towns || [nap?.city, nap?.state].filter(Boolean).join(", ") };
  return { settings, name: nap?.name || data?.name || "", all };
}

export function newRun(clientId: string, o: { scope: Scope; depth: Depth; sources: Source[]; trigger: RunState["trigger"]; startedBy: string | null }): RunState {
  return {
    id: `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}${Math.random().toString(36).slice(2, 6)}`, clientId, ...o,
    startedAt: new Date().toISOString(), finishedAt: null, status: "running", error: null,
    steps: STEP_LABELS.map(([key, label]) => ({ key, label, state: "pending" })),
    counts: { candidates: 0, perRule: {}, chunks: 0, chunksDone: 0, kept: 0, skipped: 0, rejected: 0, repaired: 0, merged: 0 },
    usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, dfsCost: 0, model: "", log: [] },
    diff: null, rejections: [],
  };
}

interface Gathered {
  settings: AiQwSettings; name: string; domain: string | null;
  gsc: Awaited<ReturnType<typeof gscWinsFor>>; ga4: Awaited<ReturnType<typeof ga4WinsFor>>;
  candidates: Candidate[]; perRule: Record<string, number>; inventory: Set<string>; picked: Candidate[];
}

/** Steps 1–7: freshness, each source, DataForSEO (live only in Deep and nightly runs), crawl, candidates. Mutates and saves `run`. */
async function gather(admin: SupabaseClient, run: RunState): Promise<Gathered> {
  const step = stepper(admin, run);
  const { settings, name } = await clientSettings(admin, run.clientId);
  const on = (s: Source) => run.sources.includes(s);

  await step("fresh", "running");
  const [{ data: metas }, { data: conns }] = await Promise.all([
    admin.from("dfs_cache").select("endpoint, params_hash, fetched_at").eq("client_id", run.clientId).in("endpoint", ["gscx", "ga4x", "aiqw_kw"]).order("fetched_at", { ascending: false }).limit(200),
    admin.from("integration_connections").select("provider, last_synced_at").eq("client_id", run.clientId),
  ]);
  const metaAt = (ep: string) => (metas ?? []).find((m) => m.endpoint === ep && (ep === "aiqw_kw" || String(m.params_hash).endsWith(":meta")))?.fetched_at as string | undefined;
  const connAt = (p: string) => (conns ?? []).find((c) => c.provider === p)?.last_synced_at as string | undefined;
  const fresh = [
    ["Search Console", metaAt("gscx")], ["GA4", metaAt("ga4x")], ["Business Profile", connAt("gbp") ?? connAt("lbm")], ["Bing", connAt("bing")], ["Clarity", connAt("clarity")], ["DataForSEO", metaAt("aiqw_kw")],
  ].filter(([, at]) => at).map(([l, at]) => `${l} synced ${ago(at)}${stale(at)}`);
  await step("fresh", "done", fresh.length ? fresh.join(" · ") : "No synced data yet");

  // Search Console and GA4 re-sync inside gscWinsFor / ga4WinsFor when their copy is older than a day
  const target = await dfsTarget(admin, run.clientId, settings);
  const needGsc = on("gsc") || on("dataforseo") || on("crawl") || on("bing") || on("gbp");
  await step("gsc", needGsc ? "running" : "skipped", needGsc ? undefined : "Not selected");
  const gsc = needGsc ? await gscWinsFor(admin, run.clientId).catch(() => null) : null;
  if (needGsc) await step("gsc", gsc ? "done" : "failed", gsc
    ? `${Date.now() - Date.parse(gsc.meta.fetchedAt) < 5 * 60_000 ? "Synced now" : `Up to date (synced ${ago(gsc.meta.fetchedAt)})`} · data to ${gsc.meta.end} · ${n(gsc.g.queries().size)} queries and ${n(gsc.g.pages().size)} pages in 28 days`
    : "Search Console isn't connected or couldn't be read");

  // Deep and nightly runs: DataForSEO keyword data and live results start now, while the other sources are read
  const notes: string[] = [];
  let dfsCost = 0;
  const liveDfs = on("dataforseo") && target && (run.depth === "deep" || run.trigger === "nightly");
  const dfsJob = liveDfs ? (async () => {
    const spent = await dfsMonthSpend(admin, run.clientId, true);
    if (spent >= settings.dfsMonthlyBudget) { notes.push(`live calls skipped: $${spent.toFixed(2)} of the $${settings.dfsMonthlyBudget} monthly limit used`); return; }
    try {
      const jobs: Promise<void>[] = [];
      if (settings.dfs.volume && gsc) {
        const top = [...gsc.g.queries()].sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 300).map(([q]) => q);
        jobs.push(refreshKw(admin, run.clientId, settings, top).then((r) => { dfsCost += r.cost; notes.push(`${n(r.fetched)} keyword volumes refreshed`); }));
      }
      if (settings.dfs.serp && run.depth === "deep" && gsc) {
        // live Google results for the top 20 opportunities (page one or striking distance, by impressions)
        const sc = run.scope;
        const opp = [...gsc.g.queries()].filter(([q, m]) => m.pos != null && m.pos <= 20 && !gsc.g.isBrand(q)).sort((a, b) => b[1].impressions - a[1].impressions)
          .filter(([q]) => sc.kind !== "page" || gsc.g.qp().some((x) => x.query === q && pathOf(String(x.page)) === sc.url)).slice(0, 20).map(([q]) => q);
        jobs.push(refreshSerp(admin, run.clientId, settings, opp, 20).then((r) => { dfsCost += r.cost; notes.push(`live Google results for ${r.fetched} keywords (${target!.serpLocLabel})`); }));
      }
      await Promise.all(jobs);
    } catch (e) { notes.push(e instanceof DfsError ? e.message : "DataForSEO unavailable"); }
  })() : Promise.resolve();

  const needGa4 = on("ga4") || on("clarity");
  await step("ga4", needGa4 ? "running" : "skipped", needGa4 ? undefined : "Not selected");
  const ga4 = needGa4 ? await ga4WinsFor(admin, run.clientId).catch(() => null) : null;
  if (needGa4) {
    const t = ga4?.g.total();
    await step("ga4", ga4 ? "done" : "failed", ga4 && t
      ? `${Date.now() - Date.parse(ga4.meta.fetchedAt) < 5 * 60_000 ? "Synced now" : `Up to date (synced ${ago(ga4.meta.fetchedAt)})`} · leads by page, channel, city and device · ${n(t.sessions)} sessions and ${n(t.leads)} leads in 30 days`
      : "GA4 isn't connected or couldn't be read");
  }

  const others: Source[] = ["gbp", "bing", "clarity", "youtube", "facebook", "instagram", "threads", "x", "tiktok", "pinterest", "linkedin", "seosignalx"];
  const anyOther = others.some(on);
  await step("platforms", anyOther ? "running" : "skipped", anyOther ? undefined : "Not selected");
  const pdata = await loadPlatformData(admin, run.clientId, run.sources);
  if (anyOther) {
    const parts: string[] = [];
    if (pdata.gbp) parts.push(`Business Profile: ${pdata.gbp.daily.length} days, ${pdata.gbp.keywords.length} searches, ${pdata.gbp.reviews.length} reviews`);
    if (pdata.bing) parts.push(`Bing: ${n(pdata.bing.queries.length)} query rows`);
    if (pdata.clarity) parts.push(`Clarity: ${new Set(pdata.clarity.map((r) => r.value)).size} pages`);
    const soc = Object.entries(pdata.social).filter(([, r]) => r?.status === "ok").map(([k]) => k);
    if (soc.length) parts.push(`Social: ${soc.map((k) => SOURCE_LABEL[k as Source] ?? k).join(", ")}`);
    if (pdata.seosignalx?.length) parts.push(`SEOSignalX: ${pdata.seosignalx.length} audits`);
    await step("platforms", "done", parts.length ? parts.join(" · ") : "No data in the selected sources");
  }

  await step("dataforseo", on("dataforseo") ? "running" : "skipped", on("dataforseo") ? undefined : "Not selected");
  await dfsJob;
  run.usage.dfsCost += dfsCost;
  const [kw, serp, gaps, local] = await Promise.all([
    loadKw(admin, run.clientId), loadSerp(admin, run.clientId), loadGaps(admin, run.clientId),
    admin.from("dfs_cache").select("params_hash, data").eq("client_id", run.clientId).eq("endpoint", "gbp_profile").limit(20).then(({ data }) => ({
      self: (data?.find((r) => r.params_hash === "self")?.data as Profile | undefined) ?? null,
      rivals: (data ?? []).filter((r) => r.params_hash !== "self" && r.data).map((r) => r.data as Profile),
    })),
  ]);
  if (on("dataforseo")) {
    if (!target) notes.push("no research target set for this client");
    else if (run.depth !== "deep" && run.trigger !== "nightly") notes.unshift("stored data (live calls only in Deep and nightly runs)");
    notes.push(`${n(kw.size)} keyword volumes`, `competitor gaps: ${n(gaps.kw.length)} keywords, ${n(gaps.links.length)} linking domains`);
    if (serp.size) notes.push(`${serp.size} live results`);
    await step("dataforseo", "done", `${notes.join(" · ")}${dfsCost ? ` · cost $${dfsCost.toFixed(3)}` : ""}`);
  }

  await step("crawl", on("crawl") ? "running" : "skipped", on("crawl") ? undefined : "Not selected");
  if (on("crawl")) {
    const inv = gsc?.inv ?? [];
    const crawled = inv.filter((r) => r.crawl);
    const last = crawled.reduce((a, r) => (r.crawl!.at > a ? r.crawl!.at : a), "");
    await step("crawl", inv.length ? "done" : "failed", inv.length ? `${n(inv.length)} pages from the sitemaps and Search Console · ${n(crawled.length)} crawled${last ? ` · last crawl ${ago(last)}` : ""}` : "No crawl yet (needs Search Console)");
  }

  await step("candidates", "running");
  const extra = platformCandidates(pdata, { gsc: gsc?.g ?? null, inv: gsc?.inv ?? [], leadRate: ga4 ? ga4.g.total().lr : null });
  const built = buildCandidates({ settings, sources: run.sources, gsc: gsc ? { g: gsc.g, wins: gsc.wins, inv: gsc.inv } : null, ga4: ga4 ? { g: ga4.g, wins: ga4.wins } : null, kw, serp, gaps, local, extra });
  const picked = pickForScope(built.all, run.scope);
  run.counts.candidates = picked.length;
  run.counts.perRule = Object.fromEntries(Object.entries(picked.reduce<Record<string, number>>((a, c) => ((a[c.rule] = (a[c.rule] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]));
  await saveCandidates(admin, run.clientId, { at: new Date().toISOString(), perRule: built.perRule, candidates: built.all, sent: picked.map((c) => c.candidate_id) });
  await step("candidates", "done", `${picked.length} candidates from ${Object.keys(run.counts.perRule).length} rules (code only, no AI)${built.all.length > picked.length ? ` · ${built.all.length} found in total` : ""}`);
  return { settings, name, domain: target?.domain ?? null, gsc, ga4, candidates: built.all, perRule: built.perRule, inventory: built.inventory, picked };
}

/** Steps 5–6 for chunk outputs (live or batch): validate (repair once), rank, merge with stored items, diff. */
async function finish(admin: SupabaseClient, run: RunState, d: Gathered, chunks: Candidate[][], results: ChunkResult[], ai: Anthropic) {
  const step = stepper(admin, run);
  await step("check", "running");
  const system = systemBlocks(systemPrompt(d.settings, d.name, d.domain));
  const kept: { item: QuickWinItem; c: Candidate }[] = [];
  const repairs: { item: QuickWinItem; c: Candidate; errs: string[]; byId: Map<string, Candidate>; also?: Candidate[] }[] = [];
  const mergedAway = new Set<string>();
  for (let i = 0; i < chunks.length; i++) {
    const out: QuickWinsOutput | null = results[i]?.output ?? null;
    if (!out) continue;
    const byId = new Map(chunks[i].map((c) => [c.candidate_id, c]));
    const mergedInto = new Map<string, Candidate[]>();
    const absorb = (into: string, x: Candidate | undefined) => { if (x) mergedInto.set(into, [...(mergedInto.get(into) ?? []), x]); };
    for (const m of out.merged) for (const id of m.merged_candidate_ids) if (id !== m.into_candidate_id) { mergedAway.add(id); absorb(m.into_candidate_id, byId.get(id)); }
    // a candidate skipped as "merged" without a merged entry: give its numbers to the kept item that targets its queries
    for (const it of out.items) if (!it.keep && /merge/i.test(it.skip_reason ?? "")) {
      const x = byId.get(it.candidate_id);
      const into = x && out.items.find((o) => o.keep && o.queries_to_use.some((q) => x.queries.some((cq) => cq.query === q)));
      if (into) absorb(into.candidate_id, x);
    }
    const seen = new Set<string>();
    for (const item of out.items) {
      if (seen.has(item.candidate_id)) continue;
      seen.add(item.candidate_id);
      const errs = validateItem(item, byId, d.inventory, d.settings.bannedWords, mergedInto.get(item.candidate_id));
      if (errs && !byId.has(item.candidate_id)) { run.counts.rejected++; run.rejections.push({ key: item.candidate_id, reason: errs.join("; ") }); continue; }
      if (!item.keep) { run.counts.skipped++; continue; }
      const c = byId.get(item.candidate_id)!;
      if (!errs) { kept.push({ item, c }); continue; }
      repairs.push({ item, c, errs, byId, also: mergedInto.get(item.candidate_id) });
    }
  }
  // repair once by re-asking Claude for that item with the error (4 at a time), else drop it and log why
  await pool(repairs, 4, async (r) => {
    const fix = await repairItem(ai, d.settings, system, r.c, r.item, r.errs);
    if (fix.log) { run.usage.log.push(fix.log); addUsage(run, fix.log); }
    const again = fix.item ? validateItem({ ...fix.item, candidate_id: r.item.candidate_id, keep: true }, r.byId, d.inventory, d.settings.bannedWords, r.also) : ["no answer"];
    if (fix.item && !again) { run.counts.repaired++; kept.push({ item: { ...fix.item, candidate_id: r.item.candidate_id, keep: true }, c: r.c }); }
    else { run.counts.rejected++; run.rejections.push({ key: r.item.candidate_id, reason: (again ?? r.errs).join("; ") }); }
  });
  run.counts.merged = mergedAway.size;
  const final = kept.filter((k) => !mergedAway.has(k.c.candidate_id));
  run.counts.kept = final.length;
  await step("check", "done", `${final.length} kept · ${run.counts.skipped + run.counts.merged} merged or skipped · ${run.counts.repaired} repaired · ${run.counts.rejected} rejected (page or number not in the data)`);

  await step("save", "running");
  const now = new Date().toISOString();
  const prev = await loadItems(admin, run.clientId);
  const prevBy = new Map(prev.map((p) => [p.key, p]));
  const fresh = new Map<string, StoredWin>();
  for (const { item, c } of final) {
    const old = prevBy.get(c.candidate_id);
    fresh.set(c.candidate_id, {
      key: c.candidate_id, run_id: run.id, rule: c.rule, title: item.title, type: item.type, page_url: c.page_url, where: item.where, why: item.why, steps: item.steps,
      suggested_change: item.suggested_change, queries_to_use: item.queries_to_use, effort: item.effort, confidence: item.confidence, measure: item.measure, plain_summary: item.plain_summary,
      sources: [...new Set([...c.sources, "claude" as const])], scope_screens: c.scope_screens,
      evidence: [...c.facts.filter((f) => f.name !== "Finding").map((f) => ({ name: f.name, value: String(f.value), source: f.source })),
        ...c.queries.slice(0, 6).map((q) => ({ name: `"${q.query}"`, value: [q.impressions != null ? `${q.impressions} impr.` : null, q.position != null ? `pos ${q.position}` : null, q.search_volume != null ? `${q.search_volume} searches/mo` : null, q.difficulty != null ? `KD ${q.difficulty}` : null].filter(Boolean).join(" · "), source: (q.search_volume != null ? "dataforseo" : "gsc") as StoredWin["evidence"][number]["source"] }))],
      computed_gain: c.computed_gain, gain_unit: c.gain_unit, score: scoreOf(weightedGain(c), item.confidence, item.effort), rank: 0,
      status: old?.status ?? "todo", owner: old?.owner ?? null, created_at: old?.created_at ?? now, updated_at: now, done_at: old?.done_at ?? null,
      baseline: old?.baseline ?? baselineFor(c, d.gsc?.g ?? null), result: old?.result ?? null, seen_run: run.id,
    });
  }
  // diff against the previous list, within this run's scope
  const sc = run.scope;
  const inScope = (p: StoredWin) => sc.kind === "site" || (sc.kind === "screen" ? p.scope_screens.includes(sc.screen) : sc.kind === "page" ? p.page_url === sc.url : p.key === sc.key);
  const allIds = new Set(d.candidates.map((c) => c.candidate_id));
  const diff = { added: [] as string[], stillOpen: [] as string[], resolved: [] as string[], gone: [] as string[] };
  for (const k of fresh.keys()) (prevBy.has(k) && prevBy.get(k)!.seen_run ? diff.stillOpen : diff.added).push(k);
  const merged: StoredWin[] = [...fresh.values()];
  for (const p of prev) {
    if (fresh.has(p.key)) continue;
    if (!inScope(p)) { merged.push(p); continue; }
    const open = p.status === "todo" || p.status === "doing";
    if (open && p.seen_run) (allIds.has(p.key) ? diff.gone : diff.resolved).push(p.key);
    // done/dismissed items stay for the before/after check; open ones no longer found stay 60 days, flagged
    if (!open || Date.now() - Date.parse(p.updated_at) < 60 * DAY) merged.push({ ...p, seen_run: allIds.has(p.key) && open ? p.seen_run : null });
  }
  measureResults(merged, d.gsc?.g ?? null);
  const ranked = merged.filter((w) => w.seen_run && (w.status === "todo" || w.status === "doing")).sort((a, b) => b.score - a.score);
  ranked.forEach((w, i) => (w.rank = i + 1));
  for (const w of merged) if (!ranked.includes(w)) w.rank = 0;
  await saveItems(admin, run.clientId, merged);
  run.diff = diff;
  await step("save", "done", `Statuses carried over: ${fresh.size - diff.added.length} · ${diff.added.length} new · ${diff.resolved.length} resolved by the data · ${ranked.length} open, ranked by gain × confidence ÷ effort`);
}

/** Before/after: 28 days after "done", the page's Search Console numbers now. */
function measureResults(items: StoredWin[], g: GscG | null) {
  if (!g) return;
  const rows = pageTable(g);
  for (const w of items) {
    if (w.status !== "done" || !w.done_at || w.result || Date.now() - Date.parse(w.done_at) < 28 * DAY || w.gain_unit !== "clicks/mo" || !w.page_url.startsWith("/")) continue;
    const r = rows.find((p) => pathOf(p.page) === w.page_url);
    if (r) w.result = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: Math.round(r.pos * 10) / 10, at: new Date().toISOString() };
  }
}

function addUsage(run: RunState, l: RunState["usage"]["log"][number]) {
  run.usage.calls++; run.usage.input += l.input; run.usage.output += l.output; run.usage.cacheRead += l.cacheRead; run.usage.cacheWrite += l.cacheWrite;
  run.usage.cost = Math.round((run.usage.cost + l.cost) * 10000) / 10000;
}

/** A whole on-demand run (chunks in parallel, concurrency 4). Never throws: failures end in run.status = "failed". */
export async function executeRun(admin: SupabaseClient, run: RunState): Promise<RunState> {
  try {
    // the client's organization's own Anthropic key, checked before anything is read or spent
    const ai = await anthropicFor(run.clientId);
    const d = await gather(admin, run);
    run.usage.model = d.settings.model;
    const claudeStep = run.steps.find((s) => s.key === "claude")!;
    if (!d.picked.length) {
      claudeStep.state = "skipped"; claudeStep.detail = "No candidates for this scope";
      await finish(admin, run, d, [], [], ai);
    } else {
      const chunks = chunkCandidates(d.picked);
      run.counts.chunks = chunks.length;
      const spent = await claudeMonthSpend(admin, run.clientId);
      const est = chunks.length * EST_PER_CHUNK[d.settings.model];
      if (spent + est > d.settings.monthlyBudget) throw new Error(`Monthly Claude budget: $${spent.toFixed(2)} of $${d.settings.monthlyBudget.toFixed(2)} used and this run needs about $${est.toFixed(2)}. Raise the budget in AI quick wins → Settings.`);
      const tClaude = Date.now();
      const sent = `${chunks.length} chunk${chunks.length > 1 ? "s" : ""} sent in parallel · ${d.settings.model} · effort ${d.settings.effort} · cached instructions`;
      claudeStep.state = "running"; claudeStep.detail = `${sent} · 0 of ${chunks.length} answered`;
      await saveRun(admin, run);
      const system = systemBlocks(systemPrompt(d.settings, d.name, d.domain));
      const onDone = async (r: ChunkResult) => {
        for (const l of r.logs) { run.usage.log.push(l); addUsage(run, l); }
        run.counts.chunksDone++; claudeStep.detail = `${sent} · ${run.counts.chunksDone} of ${chunks.length} answered${r.error ? ` (one failed: ${r.error})` : ""}`;
        await saveRun(admin, run);
      };
      // the first chunk writes the prompt cache; the others start a few seconds later so they read it
      const firstP = runChunk(ai, d.settings, system, chunks[0], 0).then(async (r) => { await onDone(r); return r; });
      if (chunks.length > 1) await new Promise((ok) => setTimeout(ok, 8000));
      const late: ChunkResult = { output: null, logs: [], error: "Not run: the run reached its time limit. Run this screen or page on its own." };
      const runT0 = Date.parse(run.startedAt);
      const rest = await pool(chunks.slice(1), CONCURRENCY - 1, (c, i) => (Date.now() - runT0 > CHUNK_DEADLINE_MS ? Promise.resolve(late) : runChunk(ai, d.settings, system, c, i + 1)), onDone);
      const results = [await firstP, ...rest];
      const failed = results.filter((r) => !r.output).length;
      claudeStep.state = failed === results.length ? "failed" : "done";
      claudeStep.ms = Date.now() - tClaude;
      claudeStep.detail = `${results.length - failed} of ${chunks.length} chunks answered · ${d.settings.model} · effort ${d.settings.effort} · ${n(run.usage.input + run.usage.cacheRead + run.usage.cacheWrite)} input / ${n(run.usage.output)} output tokens · ${n(run.usage.cacheRead)} read from cache · $${run.usage.cost.toFixed(3)}`;
      await saveRun(admin, run);
      if (failed === results.length) throw new Error(results[0].error ?? "Claude didn't answer.");
      await finish(admin, run, d, chunks, results, ai);
    }
    run.status = "done";
  } catch (e) {
    run.status = "failed";
    run.error = (e instanceof Error ? e.message : "The run failed.").slice(0, 400);
    for (const s of run.steps) if (s.state === "running") s.state = "failed";
  }
  run.finishedAt = new Date().toISOString();
  await saveRun(admin, run);
  return run;
}

/** Nightly: gathers and submits a Message Batch (half price); collectNightly finishes it later. */
export async function submitNightly(admin: SupabaseClient, clientId: string): Promise<RunState> {
  const run = newRun(clientId, { scope: { kind: "site" }, depth: "standard", sources: ["gsc", "ga4", "dataforseo", "crawl"], trigger: "nightly", startedBy: null });
  try {
    // the client's organization's own Anthropic key, checked before anything is read or spent
    const ai = await anthropicFor(clientId);
    const d = await gather(admin, run);
    run.usage.model = d.settings.model;
    const chunks = chunkCandidates(d.picked);
    run.counts.chunks = chunks.length;
    const spent = await claudeMonthSpend(admin, clientId);
    if (spent + (chunks.length * EST_PER_CHUNK[d.settings.model]) / 2 > d.settings.monthlyBudget) throw new Error(`Monthly Claude budget reached ($${spent.toFixed(2)} of $${d.settings.monthlyBudget.toFixed(2)}).`);
    if (!chunks.length) { run.status = "done"; run.finishedAt = new Date().toISOString(); await saveRun(admin, run); return run; }
    run.batchId = await submitBatch(ai, d.settings, systemPrompt(d.settings, d.name, d.domain), run.id, chunks);
    const s = run.steps.find((x) => x.key === "claude")!; s.state = "running"; s.detail = `Message Batch ${run.batchId} submitted (${chunks.length} requests)`;
    run.status = "waiting_batch";
    await savePending(admin, clientId, { batchId: run.batchId, runId: run.id, chunks: chunks.map((c) => c.map((x) => x.candidate_id)), submittedAt: new Date().toISOString() });
  } catch (e) { run.status = "failed"; run.error = (e instanceof Error ? e.message : "failed").slice(0, 400); run.finishedAt = new Date().toISOString(); }
  await saveRun(admin, run);
  return run;
}

/** Finishes a nightly batch once it has ended: same validation and storage as a live run (repairs on `ai`, the organization's client). */
export async function finishBatch(admin: SupabaseClient, clientId: string, runId: string, chunkIds: string[][], results: Map<string, ChunkResult>, ai: Anthropic): Promise<RunState | null> {
  const run = await loadRun(admin, clientId, runId);
  if (!run) return null;
  try {
    const { settings, name } = await clientSettings(admin, clientId);
    const [gsc, target] = await Promise.all([gscWinsFor(admin, clientId).catch(() => null), dfsTarget(admin, clientId, settings)]);
    const last = await import("./store").then((m) => m.loadCandidates(admin, clientId));
    const byId = new Map((last?.candidates ?? []).map((c) => [c.candidate_id, c]));
    const chunks = chunkIds.map((ids) => ids.map((id) => byId.get(id)).filter((c): c is Candidate => Boolean(c)));
    const ordered = chunkIds.map((_, i) => results.get(batchCustomId(runId, i)) ?? { output: null, logs: [], error: "missing" });
    for (const r of ordered) for (const l of r.logs) { run.usage.log.push(l); addUsage(run, l); }
    const s = run.steps.find((x) => x.key === "claude")!; s.state = "done"; s.detail = `${ordered.filter((r) => r.output).length} of ${chunks.length} batch requests answered · $${run.usage.cost.toFixed(3)} (batch price)`;
    const inventory = new Set<string>((last?.candidates ?? []).map((c) => c.page_url));
    for (const r of gsc?.inv ?? []) inventory.add(pathOf(r.url));
    await finish(admin, run, { settings, name, domain: target?.domain ?? null, gsc, ga4: null, candidates: last?.candidates ?? [], perRule: last?.perRule ?? {}, inventory, picked: chunks.flat() }, chunks, ordered, ai);
    run.status = "done";
  } catch (e) { run.status = "failed"; run.error = (e instanceof Error ? e.message : "failed").slice(0, 400); }
  run.finishedAt = new Date().toISOString();
  await saveRun(admin, run);
  return run;
}
