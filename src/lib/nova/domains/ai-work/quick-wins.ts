import "server-only";
import { z } from "zod";
import { setWinOwner, setWinStatus, startQuickWins } from "@/app/(dashboard)/ai-quick-wins/actions";
import { aiUnavailable } from "@/lib/ai/claude";
import { pickForScope, ruleLabel, weightedGain } from "@/lib/aiqw/candidates";
import { CHUNK, chunkCandidates } from "@/lib/aiqw/claude";
import { dfsMonthSpend } from "@/lib/aiqw/dfs";
import { sourceStatus } from "@/lib/aiqw/platforms";
import { EST_PER_CHUNK } from "@/lib/aiqw/run";
import { SCREENS, screenLabel } from "@/lib/aiqw/screens";
import { MODELS } from "@/lib/aiqw/settings";
import { activeRun, claudeMonthSpend, listRuns, loadCandidates, loadItems, loadRun, readItems } from "@/lib/aiqw/store";
import { SOURCE_LABEL, SOURCES, STATUS_LABEL, type Candidate, type RunState, type Scope, type Source, type StoredWin } from "@/lib/aiqw/types";
import { rankEstimate } from "@/lib/dataforseo/rank";
import { bullets, json, plural, read, ToolError, write, type NovaTool } from "../../kit";
import { ago, bulkMessage, clip, duration, eachInOrder, fitJson, median, round, storedSettings, usd } from "./util";

/**
 * AI Quick Wins: the ranked to-do list (stored as one list per client), its runs, and starting a run.
 * Changes go through the page's own server actions (actions.ts), so role checks and refreshes match the buttons.
 */

const WIN_STATUSES = ["todo", "doing", "done", "dismissed"] as const;
const SCREEN_KEYS = SCREENS.map((s) => s.key) as [string, ...string[]];
const SOURCE_KEYS = SOURCES as [Source, ...Source[]];
/** Deep runs: search volumes for the top 300 Search Console queries (DataForSEO Labs, ~$0.01 a request + $0.0001 a keyword, see lib/dataforseo/rank.ts) and live top-10 results for the top 20 opportunities (lib/aiqw/run.ts). */
const DEEP_KEYWORDS = 300, DEEP_SERPS = 20, LABS_REQUEST = 0.01, LABS_KEYWORD = 0.0001;

const isOpen = (w: StoredWin) => w.status === "todo" || w.status === "doing";
const gainOf = (w: Pick<StoredWin, "computed_gain" | "gain_unit">) => `+${w.computed_gain} ${w.gain_unit}`;
const byRank = (a: StoredWin, b: StoredWin) => (a.rank || 1e9) - (b.rank || 1e9) || b.score - a.score;
const statusLabel = (s: string) => STATUS_LABEL[s as StoredWin["status"]] ?? s;

/** A page URL compared without protocol, host and trailing slash ("http://www.x.com/a/" = "/a"). */
function pageKey(u: string): string {
  const s = u.trim().toLowerCase();
  try { const x = new URL(s); return `${x.pathname.replace(/\/+$/, "") || "/"}${x.search}`; } catch { /* a path or a label like "(new page)" */ }
  return s.startsWith("/") ? s.replace(/\/+$/, "") || "/" : s;
}

/** Screen key from a key, path or (part of a) label. */
function screenOf(arg: string): string {
  const a = arg.trim().toLowerCase();
  const s = SCREENS.find((x) => x.key === a || x.path === a || x.label.toLowerCase() === a) ?? SCREENS.find((x) => x.label.toLowerCase().includes(a));
  if (!s) throw new ToolError(`Unknown screen "${arg}". Screens: ${SCREENS.map((x) => x.key).join(", ")}.`);
  return s.key;
}

const scopeText = (s: Scope) => (s.kind === "site" ? "whole site" : s.kind === "screen" ? `screen "${screenLabel(s.screen)}"` : s.kind === "page" ? `page ${s.url}` : "one quick win");

const compact = (w: StoredWin) => ({
  key: w.key, rank: w.rank || null, title: w.title, type: w.type, status: w.status, owner: w.owner, page: w.page_url,
  effort: w.effort, confidence: w.confidence, gain: gainOf(w), ...(w.seen_run ? {} : { in_latest_data: false }),
});

const full = (w: StoredWin) => ({
  key: w.key, rank: w.rank || null, title: w.title, type: w.type, rule: ruleLabel(w.rule), status: w.status, owner: w.owner,
  page: w.page_url, where: w.where, for_the_owner: w.plain_summary, why: w.why, steps: w.steps, suggested_change: w.suggested_change,
  queries_to_use: w.queries_to_use, effort: w.effort, confidence: w.confidence, estimated_gain: gainOf(w), score: round(w.score, 1), measure: w.measure,
  sources: w.sources.map((s) => SOURCE_LABEL[s] ?? s), screens: w.scope_screens.map(screenLabel),
  evidence: w.evidence.map((e) => `${e.name}: ${e.value} (${SOURCE_LABEL[e.source] ?? e.source})`),
  created: w.created_at.slice(0, 10), updated: w.updated_at.slice(0, 10), done_on: w.done_at?.slice(0, 10) ?? null,
  before: w.baseline, after_28_days_done: w.result, in_latest_data: Boolean(w.seen_run),
});

function runRow(r: RunState, active: RunState | null) {
  const secs = r.finishedAt ? (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000 : null;
  const status = r.status === "running" && active?.id !== r.id ? "interrupted (no progress for over 6 minutes)" : r.status === "waiting_batch" ? "waiting for the nightly batch" : r.status;
  return {
    id: r.id, started: r.startedAt, by: r.startedBy ?? (r.trigger === "nightly" ? "nightly schedule" : null), scope: scopeText(r.scope), depth: r.depth, sources: r.sources.length, status,
    candidates: r.counts.candidates, kept: r.counts.kept, merged_or_skipped: r.counts.skipped + r.counts.merged, rejected: r.counts.rejected,
    claude_usd: round(r.usage.cost, 3), dataforseo_usd: round(r.usage.dfsCost, 3), ...(secs != null ? { took: duration(secs) } : {}), ...(r.error ? { error: clip(r.error, 300) } : {}),
  };
}
const stepRow = (s: RunState["steps"][number]) => ({ step: s.label, state: s.state, ...(s.detail ? { detail: clip(s.detail, 220) } : {}), ...(s.ms != null ? { seconds: round(s.ms / 1000, 1) } : {}) });

function scopeFrom(a: { scope: "site" | "screen" | "page" | "item"; screen?: string; page?: string; key?: string }): Scope | null {
  if (a.scope === "site") return { kind: "site" };
  if (a.scope === "screen") return a.screen ? { kind: "screen", screen: a.screen } : null;
  if (a.scope === "page") return a.page ? { kind: "page", url: a.page } : null;
  return a.key ? { kind: "item", key: a.key } : null;
}

/**
 * The run matches a page's URL exactly, and the same page can be filed under several spellings ("/" and
 * "http://www.site.com/"): use the spelling most of the latest candidates have (the given one on a tie).
 */
function resolvePage(input: string, cands: Candidate[], items: StoredWin[]): string {
  const k = pageKey(input), counts = new Map<string, number>();
  for (const c of cands) if (c.page_url === input || pageKey(c.page_url) === k) counts.set(c.page_url, (counts.get(c.page_url) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1] || Number(b[0] === input) - Number(a[0] === input))[0];
  if (best) return best[0];
  return items.some((w) => w.page_url === input) ? input : items.find((w) => pageKey(w.page_url) === k)?.page_url ?? input;
}

const runSchema = z.object({
  scope: z.enum(["site", "screen", "page", "item"]).default("site"),
  screen: z.enum(SCREEN_KEYS).optional().describe("for scope screen"),
  page: z.string().trim().min(1).max(500).optional().describe("for scope page: the page URL"),
  key: z.string().min(1).max(500).optional().describe("for scope item: the key of the quick win to regenerate"),
  depth: z.enum(["standard", "deep"]).default("standard").describe("deep also refreshes search volumes and checks live Google results (DataForSEO, paid)"),
  sources: z.array(z.enum(SOURCE_KEYS)).min(1).max(SOURCES.length).optional().describe("default: every source with data"),
});

export const tools: NovaTool[] = [
  read({
    name: "get_quick_wins",
    description: "AI Quick Wins, the ranked to-do list: filter by status, owner, effort, confidence, screen, page, text or minimum gain. Pass keys for full details (why, steps, text to paste, evidence, before/after).",
    schema: z.object({
      status: z.enum(["open", ...WIN_STATUSES, "all"]).default("open").describe("open = todo or doing"),
      owner: z.string().trim().max(80).optional().describe('owner name, or "none" for unassigned'),
      effort: z.enum(["Low", "Medium", "High"]).optional(),
      confidence: z.enum(["High", "Medium", "Low"]).optional(),
      screen: z.string().trim().max(80).optional().describe("dashboard screen key or name, e.g. gsc:queries"),
      page: z.string().trim().max(500).optional().describe("page URL or part of it"),
      search: z.string().trim().max(100).optional(),
      min_gain: z.number().min(0).optional().describe("minimum estimated gain in clicks/month (a lead counts as 10)"),
      keys: z.array(z.string().min(1).max(500)).min(1).max(4).optional(),
      limit: z.number().int().min(1).max(60).default(25),
    }),
    async run(ctx, a) {
      const items = await readItems(ctx.admin, ctx.client.id);
      const keys = a.keys;
      if (keys?.length) {
        const by = new Map(items.map((w) => [w.key, w]));
        const found = keys.map((k) => by.get(k)).filter((w): w is StoredWin => Boolean(w));
        const missing = keys.filter((k) => !by.has(k));
        if (!found.length) throw new ToolError(`No quick win with ${keys.length > 1 ? "those keys" : "that key"} for this client. List them with get_quick_wins first.`);
        return fitJson(found.length, (n) => ({ quick_wins: found.slice(0, n).map(full), ...(missing.length ? { not_found: missing } : {}), ...(n < found.length ? { not_shown: found.slice(n).map((w) => w.key) } : {}) }));
      }
      const screen = a.screen ? screenOf(a.screen) : null;
      const owner = a.owner?.toLowerCase(), q = a.search?.toLowerCase(), page = a.page?.toLowerCase(), pk = a.page ? pageKey(a.page) : null;
      // a page that matches exactly (any spelling of its URL) wins over a part of a URL, so "/" means the home page
      const exactPage = pk != null && items.some((w) => pageKey(w.page_url) === pk);
      const match = (w: StoredWin) =>
        (a.status === "all" || (a.status === "open" ? isOpen(w) : w.status === a.status))
        && (!owner || (owner === "none" ? !w.owner : (w.owner ?? "").toLowerCase() === owner))
        && (!a.effort || w.effort === a.effort) && (!a.confidence || w.confidence === a.confidence)
        && (!screen || w.scope_screens.includes(screen))
        && (!page || (exactPage ? pageKey(w.page_url) === pk : w.page_url.toLowerCase().includes(page)))
        && (!q || `${w.title} ${w.type} ${w.page_url} ${w.where} ${w.why}`.toLowerCase().includes(q))
        && (a.min_gain == null || weightedGain(w) >= a.min_gain);
      const list = items.filter(match).sort(byRank);
      const open = items.filter(isOpen);
      const sum = (u: StoredWin["gain_unit"]) => round(open.filter((w) => w.gain_unit === u).reduce((s, w) => s + w.computed_gain, 0), 1);
      const count = (s: StoredWin["status"]) => items.filter((w) => w.status === s).length;
      const head = {
        totals: { open: open.length, todo: count("todo"), doing: count("doing"), done: count("done"), dismissed: count("dismissed"), open_no_longer_in_data: open.filter((w) => !w.seen_run).length },
        open_estimated_gain: { clicks_per_month: sum("clicks/mo"), leads_per_month: sum("leads/mo") },
        ...(screen ? { screen: screenLabel(screen) } : {}),
        matching: list.length,
      };
      if (!items.length) return json({ ...head, note: "No quick wins yet. start_quick_wins_run generates them." });
      return fitJson(Math.min(a.limit, list.length), (n) => ({ ...head, shown: n, ...(n < list.length ? { more: `${list.length - n} more: narrow the filters or raise the limit` } : {}), quick_wins: list.slice(0, n).map(compact) }));
    },
    summary: (a) => (a.keys?.length ? `Read ${plural(a.keys.length, "quick win")} in full` : `Read ${a.status === "all" ? "all" : a.status} AI quick wins`),
  }),

  read({
    name: "get_quick_win_runs",
    description: "AI Quick Wins runs: the run in progress with its live steps, recent runs (scope, depth, status, counts, cost) and this month's Claude and DataForSEO spend against the budgets. Pass run_id for one run's steps, changes and rejections.",
    schema: z.object({ run_id: z.string().regex(/^[a-z0-9]{10,30}$/).optional(), limit: z.number().int().min(1).max(30).default(10) }),
    async run(ctx, a) {
      const id = ctx.client.id;
      const [runs, s, claude, dfs] = await Promise.all([listRuns(ctx.admin, id, Math.max(a.limit, 5)), storedSettings(ctx.admin, id), claudeMonthSpend(ctx.admin, id), dfsMonthSpend(ctx.admin, id, true)]);
      const active = activeRun(runs);
      const spend = {
        claude_this_month: usd(claude), claude_monthly_budget: usd(s.monthlyBudget), model: s.model, effort: s.effort,
        dataforseo_this_month: usd(dfs), dataforseo_monthly_limit: usd(s.dfsMonthlyBudget), nightly_run: s.nightly ? "on" : "off",
      };
      if (a.run_id) {
        const r = await loadRun(ctx.admin, id, a.run_id);
        if (!r) throw new ToolError(`Run ${a.run_id} doesn't exist for this client. List the runs first.`);
        const title = new Map((await readItems(ctx.admin, id)).map((w) => [w.key, w.title]));
        const name = (k: string) => clip(title.get(k) ?? k, 100);
        const run = {
          ...runRow(r, active), steps: r.steps.map(stepRow),
          candidates_per_rule: Object.entries(r.counts.perRule).map(([k, n]) => `${ruleLabel(k)}: ${n}`),
          usage: { claude_calls: r.usage.calls, model: r.usage.model || null, input_tokens: r.usage.input + r.usage.cacheRead + r.usage.cacheWrite, cache_reads: r.usage.cacheRead, output_tokens: r.usage.output },
          changes: r.diff ? {
            new: r.diff.added.length, new_items: r.diff.added.slice(0, 12).map(name), still_open: r.diff.stillOpen.length,
            resolved_by_the_data: r.diff.resolved.length, resolved_items: r.diff.resolved.slice(0, 12).map(name), not_repeated: r.diff.gone.length,
          } : null,
        };
        return fitJson(r.rejections.length, (n) => ({ run: { ...run, rejections: r.rejections.slice(0, n).map((x) => ({ item: name(x.key), reason: clip(x.reason, 200) })), ...(n < r.rejections.length ? { rejections_not_shown: r.rejections.length - n } : {}) }, spend }));
      }
      return json({
        in_progress: active ? { ...runRow(active, active), steps: active.steps.map(stepRow) } : null,
        spend, recent_runs: runs.slice(0, a.limit).map((r) => runRow(r, active)),
        ...(runs.length ? {} : { note: "No runs yet." }),
      });
    },
    summary: (a) => (a.run_id ? "Read a quick-wins run" : "Read quick-wins runs and spend"),
  }),

  write({
    name: "update_quick_wins",
    description: "Set the status (todo, doing, done, dismissed) and/or the owner of one or more AI quick wins, by key. An empty owner clears it.",
    schema: z.object({
      keys: z.array(z.string().min(1).max(500)).min(1).max(50),
      status: z.enum(WIN_STATUSES).optional(),
      owner: z.string().trim().max(80).optional().describe('a name; "" clears it'),
    }),
    async prepare(ctx, a) {
      if (!a.status && a.owner === undefined) return { error: "Give a status and/or an owner." };
      const items = await readItems(ctx.admin, ctx.client.id);
      const by = new Map(items.map((w) => [w.key, w]));
      const keys = [...new Set(a.keys)];
      const missing = keys.filter((k) => !by.has(k));
      if (missing.length) return { error: `${plural(missing.length, "quick win")} not found for this client: ${missing.slice(0, 5).join(", ")}. Read get_quick_wins for the current keys.` };
      const owner = a.owner === undefined ? undefined : a.owner || null;
      const changes = keys.map((k) => {
        const w = by.get(k)!, parts: string[] = [];
        if (a.status && a.status !== w.status) parts.push(`${statusLabel(w.status)} → ${statusLabel(a.status)}`);
        if (owner !== undefined && owner !== w.owner) parts.push(`owner ${w.owner ?? "(none)"} → ${owner ?? "(none)"}`);
        return { w, parts };
      }).filter((c) => c.parts.length);
      if (!changes.length) return { error: "Nothing to change: those quick wins already have that status and owner." };
      const one = changes.length === 1 ? `"${clip(changes[0].w.title, 70)}"` : plural(changes.length, "quick win");
      const title = a.status && owner === undefined ? `Mark ${one} ${statusLabel(a.status)}`
        : !a.status && owner !== undefined ? (owner ? `Assign ${one} to ${owner}` : `Clear the owner of ${one}`) : `Update ${one}`;
      const notes: string[] = [];
      if (a.status === "done") notes.push("Done items record today's date; their before/after result is measured 28 days later.");
      // setWinStatus clears the done date and any measured result when an item leaves Done
      const leaving = changes.filter((c) => c.w.status === "done" && a.status && a.status !== "done");
      if (leaving.length) notes.push(`${plural(leaving.length, "item")} leave${leaving.length === 1 ? "s" : ""} Done: the done date${leaving.some((c) => c.w.result) ? " and the measured 28-day result" : ""} ${leaving.length === 1 ? "is" : "are"} cleared (can't be undone).`);
      const calls = changes.reduce((s, c) => s + c.parts.length, 0);
      return {
        title,
        detail: [bullets(changes.map((c) => `${clip(c.w.title, 90)}: ${c.parts.join("; ")}`)), ...notes].join("\n"),
        input: { keys: changes.map((c) => c.w.key), status: a.status, owner: a.owner },
        // each change loads and saves the quick-wins list (about 1.5 seconds)
        ...(calls * 1.5 > 10 ? { expectSeconds: Math.ceil(calls * 1.5) } : {}),
      };
    },
    async execute(x, a) {
      const by = new Map((await loadItems(x.admin, x.client.id)).map((w) => [w.key, w]));
      const owner = a.owner === undefined ? undefined : a.owner || null;
      const r = await eachInOrder(a.keys, async (k) => {
        const w = by.get(k);
        if (!w) return `${clip(k, 60)}: no longer exists`;
        if (a.status && a.status !== w.status) { const s = await setWinStatus(k, a.status); if (!s.ok) return `${clip(w.title, 60)}: ${s.error}`; }
        if (owner !== undefined && owner !== w.owner) { const o = await setWinOwner(k, owner ?? ""); if (!o.ok) return `${clip(w.title, 60)}: ${o.error}`; }
        return null;
      });
      const what = (n: number) => `Updated ${plural(n, "quick win")}${a.status ? `: ${statusLabel(a.status)}` : ""}${owner !== undefined ? `${a.status ? "," : ":"} owner ${owner ?? "cleared"}` : ""}`;
      return { ...bulkMessage(r.done, a.keys.length, what, r.failed), paths: ["/ai-quick-wins"] };
    },
  }),

  write({
    name: "start_quick_wins_run",
    description: "Generate AI quick wins with Claude (paid; runs in the background for a few minutes): the whole site, one dashboard screen, one page, or regenerate one quick win (key). Standard uses stored DataForSEO data; deep also fetches fresh DataForSEO data (paid).",
    schema: runSchema,
    async prepare(ctx, a) {
      const aiOff = await aiUnavailable(ctx.client.id);
      if (aiOff) return { error: aiOff };
      const id = ctx.client.id;
      const [runs, status, settings, last, items, spent, dfsSpent] = await Promise.all([
        listRuns(ctx.admin, id, 30), sourceStatus(ctx.admin, id), storedSettings(ctx.admin, id), loadCandidates(ctx.admin, id), readItems(ctx.admin, id),
        claudeMonthSpend(ctx.admin, id), dfsMonthSpend(ctx.admin, id, true),
      ]);
      const running = activeRun(runs);
      if (running) return { error: `A quick-wins run is already in progress (${scopeText(running.scope)}, started ${ago(running.startedAt)}). Wait for it to finish; get_quick_win_runs shows its progress.` };

      // scope (a page is matched exactly by the run, so use the URL spelling the candidates have)
      const cands = last?.candidates ?? [];
      const given = scopeFrom(a);
      if (!given) return { error: `Give the ${a.scope === "screen" ? "screen" : a.scope === "page" ? "page URL" : "quick win key"} for a ${a.scope} run.` };
      const scope: Scope = given.kind === "page" ? { kind: "page", url: resolvePage(given.url, cands, items) } : given;
      let what = `Generate AI quick wins: ${scopeText(scope)} (${a.depth})`;
      if (scope.kind === "item") {
        const w = items.find((x) => x.key === scope.key);
        if (!w) return { error: `Quick win ${scope.key} doesn't exist for this client. Read get_quick_wins for the current keys.` };
        what = `Regenerate the quick win "${clip(w.title, 80)}"${a.depth === "deep" ? " (deep)" : ""}`;
      }

      // sources: those with data for this client
      const available = SOURCES.filter((s) => status[s]?.ok);
      const sources = a.sources ? [...new Set(a.sources)] : available;
      const off = sources.filter((s) => !status[s]?.ok);
      if (off.length) return { error: `Not available for this client: ${off.map((s) => `${SOURCE_LABEL[s]} (${status[s]?.note ?? "no data"})`).join(", ")}. Available: ${available.map((s) => `${s} (${SOURCE_LABEL[s]})`).join(", ") || "none"}.` };
      if (!sources.length) return { error: "No data source has data for this client yet. Connect Search Console or GA4 on the Integrations page first." };

      // Claude: the run's own budget check reserves EST_PER_CHUNK per request of up to CHUNK candidates
      const model = MODELS[settings.model].label.replace(/ \(.*\)$/, "");
      if (spent >= settings.monthlyBudget) return { error: `The monthly Claude budget is used up (${usd(spent)} of ${usd(settings.monthlyBudget)}), so the run would be refused. Raise it with update_ai_settings first.` };
      const picked = last ? pickForScope(cands, scope) : null;
      const chunks = picked ? chunkCandidates(picked).length : null;
      const reserve = chunks != null ? chunks * EST_PER_CHUNK[settings.model] : null;
      if (reserve && spent + reserve > settings.monthlyBudget) {
        return { error: `This run would be refused by the monthly Claude budget: ${usd(spent)} of ${usd(settings.monthlyBudget)} is used and it reserves about ${usd(reserve)} (${plural(chunks!, "request")} × ${usd(EST_PER_CHUNK[settings.model])}). Raise the budget (update_ai_settings) or choose a smaller scope.` };
      }
      const priced = runs.filter((r) => r.trigger === "manual" && r.usage.cost > 0 && r.counts.chunks > 0 && r.usage.model === settings.model).slice(0, 10);
      const perChunk = priced.length ? priced.reduce((s, r) => s + r.usage.cost, 0) / priced.reduce((s, r) => s + r.counts.chunks, 0) : null;
      const claudeLine = chunks == null
        ? `${model} (effort ${settings.effort}): the cost depends on what the data shows; ${usd(EST_PER_CHUNK[settings.model])} per request of up to ${CHUNK} candidates is reserved against the monthly Claude budget (${usd(spent)} of ${usd(settings.monthlyBudget)} used) and the run is refused if that would go over`
        : chunks === 0 ? `Claude: probably nothing to send (no candidates for this ${scope.kind === "item" ? "quick win" : "scope"} in the latest data), so no Claude cost`
        : `${model} (effort ${settings.effort}): ${plural(picked!.length, "candidate")} in ${plural(chunks, "request")}${perChunk ? `, likely about ${usd(chunks * perChunk)} (recent runs here: ${usd(perChunk)} a request)` : ""}. It reserves ${usd(reserve!)} against the monthly Claude budget (${usd(spent)} of ${usd(settings.monthlyBudget)} used) and is refused if that would go over`;

      // DataForSEO: live calls only in deep runs
      let dfsLine: string;
      if (a.depth === "standard") dfsLine = "DataForSEO: no charge (standard runs use the stored DataForSEO data)";
      else if (!sources.includes("dataforseo")) dfsLine = "DataForSEO: not used (not among the sources)";
      else {
        const parts = [
          settings.dfs.volume ? `search volumes for up to ${DEEP_KEYWORDS} queries ≈ ${usd(LABS_REQUEST + DEEP_KEYWORDS * LABS_KEYWORD)}` : null,
          settings.dfs.serp ? `live Google top 10 for up to ${DEEP_SERPS} keywords ≈ ${usd(rankEstimate(DEEP_SERPS, 10))}` : null,
        ].filter(Boolean);
        dfsLine = !parts.length ? "DataForSEO: search volume and live results are switched off in AI settings, so no charge"
          : dfsSpent >= settings.dfsMonthlyBudget ? `DataForSEO: the monthly limit for quick wins is used (${usd(dfsSpent)} of ${usd(settings.dfsMonthlyBudget)}), so live calls are skipped`
          : `DataForSEO (deep): ${parts.join(" + ")}; anything fetched in the last 24 hours is reused. Within the monthly limit for quick wins (${usd(dfsSpent)} of ${usd(settings.dfsMonthlyBudget)} used)`;
      }

      // time: this client's recent runs of the same kind, else the page's own estimate
      const similar = runs.filter((r) => r.trigger === "manual" && r.status === "done" && r.finishedAt && r.scope.kind === scope.kind && r.depth === a.depth).slice(0, 5);
      const typical = median(similar.map((r) => (Date.parse(r.finishedAt!) - Date.parse(r.startedAt)) / 1000));
      const time = typical ? duration(typical) : a.depth === "deep" ? "about 1–3 minutes, plus up to a minute for live Google results" : "about 1–3 minutes";

      const lines = [
        `Scope: ${scope.kind === "item" ? `one quick win (${clip(scope.key, 80)})` : scopeText(scope)}${chunks === 0 && scope.kind !== "site" ? " (no candidates for it in the latest data, so the run may find nothing)" : ""}`,
        `Sources (${sources.length}): ${sources.map((s) => SOURCE_LABEL[s]).join(", ")}`,
        claudeLine, dfsLine,
        `Runs in the background, ${time}. Quick wins found again keep their status and owner; new ones are added; open ones in this scope the data no longer shows are flagged.`,
      ];
      return {
        title: what, detail: bullets(lines),
        input: { scope: a.scope, depth: a.depth, sources, ...(scope.kind === "screen" ? { screen: scope.screen } : scope.kind === "page" ? { page: scope.url } : scope.kind === "item" ? { key: scope.key } : {}) },
      };
    },
    async execute(x, a) {
      if (activeRun(await listRuns(x.admin, x.client.id, 5))) return { ok: false, message: "A quick-wins run is already in progress. Wait for it to finish, then ask again." };
      const scope = scopeFrom(a);
      if (!scope) return { ok: false, message: "The run's scope is incomplete. Ask Nova again." };
      let sources: Source[] = a.sources ?? [];
      if (!sources.length) { const st = await sourceStatus(x.admin, x.client.id); sources = SOURCES.filter((s) => st[s]?.ok); }
      const r = await startQuickWins({ scope, depth: a.depth, sources });
      if (!r.ok) return { ok: false, message: r.error };
      return { ok: true, message: `Started the quick-wins run for the ${scopeText(scope)} (${a.depth}, run ${r.runId}). It continues in the background and the list updates when it finishes; ask me for its progress any time.`, paths: ["/ai-quick-wins", "/ai-quick-wins/runs"] };
    },
  }),
];
