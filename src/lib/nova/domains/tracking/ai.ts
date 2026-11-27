import "server-only";
import { z } from "zod";
import { addAiPrompts, refreshBrandLookupNow, removeAiPrompt, runAiVisibilityNow, setAiEngines, setAiSearch } from "@/app/(dashboard)/ai-visibility/actions";
import { aiUnavailable } from "@/lib/ai/claude";
import { BRAND_EST, BRAND_VIEWS, brandNamesFor, LLM_EST, LLM_LABEL, LLM_PLATFORMS } from "@/lib/ai/llm-mentions";
import { AI_EVERY_DAYS, brandStats, ENGINE_KEYS, ENGINES, enginesFrom, loadAi, MAX_PROMPTS, promptEstimate, type AiCheck, type EngineKey } from "@/lib/ai/visibility";
import { DFS_NOT_CONFIGURED, dfsConfigured } from "@/lib/dataforseo/client";
import { bullets, fromAction, plural, read, ToolError, write, type ExecResult, type NovaTool } from "../../kit";
import { ACTIVE_NOTE, ageDays, andList, capJson, compact, dfsBudget, money, NO_TARGET, quoted, readTarget, uniq } from "./shared";

/** AI visibility: questions asked to AI assistants, which assistants, live web search, and the brand lookup (ai-visibility/actions.ts does the changes). */
const PATHS = ["/ai-visibility"];
const MIGRATION = "AI visibility isn't set up yet: database migration 20261030000020 is missing.";
// runAiChecks() never spends more than this per client in one run (RUN_COST_LIMIT in src/lib/ai/visibility.ts, not exported)
const RUN_COST_LIMIT = 1.5;
// runAiVisibilityNow() asks questions until 200 s have passed; stored answers show about 25 s per question (all assistants at once)
const RUN_SECONDS = 200, QUESTION_SECONDS = 25;
const PER_RUN = Math.ceil(RUN_SECONDS / QUESTION_SECONDS);
const LOOKUPS = [...BRAND_VIEWS.map((v) => `llm_brand_${v}`), "llm_brand_history"];
const TOPICS = LLM_PLATFORMS.map((p) => `llm_topic_${p}`);
const ENGINE_LIST = ENGINE_KEYS as [EngineKey, ...EngineKey[]];

/** The cut-off runAiChecks() uses: a question last asked on or before this date is due again. */
const dueCutoff = () => new Date(Date.now() - (AI_EVERY_DAYS - 0.5) * 86_400_000).toISOString().slice(0, 10);
const names = (list: EngineKey[]) => list.map((e) => ENGINES[e].label).join(", ");
const spoken = (list: EngineKey[]) => andList(list.map((e) => ENGINES[e].label));
/** The clean-up addAiPrompts() applies: one question per line, single spaces. */
const questionsOf = (list: string[]) => {
  const seen = new Set<string>();
  return list.flatMap((s) => s.split(/\n+/)).map((q) => q.trim().replace(/\s+/g, " ")).filter((q) => q && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()));
};

function status(c: AiCheck | undefined): string {
  if (!c) return "not checked";
  if (c.mentioned) return `named${c.position ? ` #${c.position}` : ""}${c.cited ? " + cited" : ""}${c.sentiment != null ? ` (sentiment ${c.sentiment})` : ""}`;
  return c.cited ? "cited" : c.seen ? "seen, not used" : "not visible";
}

type Question = { id: string; prompt: string };
function resolve(rows: Question[], refs: string[] | undefined): Question[] {
  const out: Question[] = [], missing: string[] = [];
  for (const ref of refs ?? []) {
    const hit = rows.find((q) => q.id === ref) ?? rows.find((q) => q.prompt.toLowerCase() === ref.replace(/\s+/g, " ").toLowerCase());
    if (!hit) missing.push(ref); else if (!out.includes(hit)) out.push(hit);
  }
  if (missing.length) throw new ToolError(`Not tracked: ${missing.map(quoted).join(", ")}. Call get_ai_visibility for the questions and their ids.`);
  return out;
}

export const tools: NovaTool[] = [
  read({
    name: "get_ai_visibility",
    description: "Tracked AI visibility questions with ids and each assistant's latest result (named #position, cited, seen, not visible), the assistants and web search setting, cost per question, what is due, visibility score, competitor brands, cited sources and brand lookup date. Give question_id for one question's full answers.",
    schema: z.object({ question_id: z.string().trim().max(300).optional().describe("one question's latest answers in full (id or exact text)") }),
    async run(ctx, a) {
      const [ai, { data: cl }, target, { data: cache }] = await Promise.all([
        loadAi(ctx.admin, ctx.client.id), ctx.admin.from("clients").select("settings").eq("id", ctx.client.id).maybeSingle(), readTarget(ctx.admin, ctx.client.id),
        ctx.admin.from("dfs_cache").select("endpoint, fetched_at, params").eq("client_id", ctx.client.id).in("endpoint", [...LOOKUPS, ...TOPICS]).order("fetched_at", { ascending: false }).limit(40),
      ]);
      if (!ai.ok) throw new ToolError(MIGRATION);
      const engines = enginesFrom(cl?.settings);
      const search = (cl?.settings as { ai_search?: boolean } | null)?.ai_search !== false;
      const site = (target?.domain ?? "").replace(/^www\./, "");

      if (a.question_id) {
        const [row] = resolve(ai.rows.map((r) => ({ id: r.id, prompt: r.prompt })), [a.question_id]).map((q) => ai.rows.find((r) => r.id === q.id)!);
        const checks = ENGINE_KEYS.filter((e) => row.byEngine[e]).map((e) => [e, row.byEngine[e]!] as const);
        const room = Math.min(1500, Math.floor(7000 / Math.max(1, checks.length)));
        const answers = checks.map(([e, c]) => compact({
          assistant: ENGINES[e].label, checked: c.checked_on, model: c.model, result: status(c), described_as: c.brands.find((b) => b.own)?.note,
          brands_named: c.brands.slice(0, 10).map((b) => `#${b.position} ${b.name}${b.own ? " (you)" : ""}${b.sentiment != null ? ` · ${b.sentiment}` : ""}`),
          sources: uniq(c.sources.map((s) => s.domain)).slice(0, 8), answer: c.answer ? (c.answer.length > room ? `${c.answer.slice(0, room)}…` : c.answer) : null,
        }));
        return capJson({ id: row.id, question: row.prompt, history: row.history.slice(-8).map((h) => `${h.date}: ${h.visible ? "visible" : "not visible"}`) }, "answers", answers);
      }

      const cutoff = dueCutoff();
      const lastOf = (r: (typeof ai.rows)[number]) => r.history.at(-1)?.date ?? null;
      const due = ai.rows.filter((r) => { const d = lastOf(r); return !d || d <= cutoff; }).length;
      const perQ = promptEstimate(engines);
      const brands = brandStats(ai, site), me = brands.find((b) => b.own);
      const lookup = cache?.find((r) => r.endpoint === "llm_brand_history"), market = cache?.find((r) => TOPICS.includes(r.endpoint as string));
      const base = compact({
        website: target?.domain, tracked: ai.rows.length, limit: MAX_PROMPTS,
        assistants: engines.map((e) => `${e} (${ENGINES[e].label}, ~${money(ENGINES[e].est)})`), claude_web_search: engines.includes("claude") ? search : null,
        cost_per_question: money(perQ), schedule: `each question weekly, automatic for ${ACTIVE_NOTE}`,
        last_checked: ai.lastChecked, due_now: due,
        check_now_cost: ai.rows.length ? compact({ due: due ? money(Math.min(due * perQ, RUN_COST_LIMIT)) : null, all: money(Math.min(ai.rows.length * perQ, RUN_COST_LIMIT)) }) : null,
        visibility_pct: ai.score, previous_visibility_pct: ai.previousScore,
        you: me ? compact({ named_in_pct: me.detection, avg_position: me.latestPosition, sentiment: me.avgSentiment, citations: me.citations }) : null,
        top_competitor_brands: brands.filter((b) => !b.own).slice(0, 8).map((b) => compact({ name: b.name, domain: b.domain, named_in_pct: b.detection, avg_position: b.latestPosition, sentiment: b.avgSentiment })),
        most_cited_sources: ai.topSources.slice(0, 8).map((s) => `${s.domain} (${s.count})`),
        brand_lookup: lookup ? { updated: String(lookup.fetched_at).slice(0, 10), brands: String((lookup.params as { competitor?: string } | null)?.competitor ?? "").split("|").filter(Boolean) } : "not fetched yet",
        ai_market_view_updated: market ? String(market.fetched_at).slice(0, 10) : null,
      });
      const list = ai.rows.map((r) => compact({ id: r.id, question: r.prompt, last_checked: lastOf(r), results: Object.fromEntries(engines.map((e) => [e, status(r.byEngine[e])])) }));
      return capJson(base, "questions", list);
    },
    summary: (a) => (a.question_id ? "Read an AI visibility question" : "Read AI visibility"),
  }),

  write({
    name: "update_ai_visibility",
    description: `Change AI visibility in one go: add questions customers might ask an assistant, stop tracking questions, choose the assistants asked (${ENGINE_KEYS.join(", ")}) and whether Claude uses live web search. Free; it changes what the weekly checks cost.`,
    schema: z.object({
      add_questions: z.array(z.string().trim().min(8).max(300)).max(MAX_PROMPTS).optional(),
      remove_questions: z.array(z.string().trim().min(1).max(300)).max(MAX_PROMPTS).optional().describe("question ids (or exact text) to stop tracking"),
      engines: z.array(z.enum(ENGINE_LIST)).min(1).optional().describe("the full list of assistants to ask from now on"),
      web_search: z.boolean().optional().describe("Claude answers with live web search (true) or from its own knowledge (false, cheaper)"),
    }),
    async prepare(ctx, a) {
      const [{ data: qs, error }, { data: cl }] = await Promise.all([
        ctx.admin.from("ai_prompts").select("id, prompt").eq("client_id", ctx.client.id).order("created_at"),
        ctx.admin.from("clients").select("settings").eq("id", ctx.client.id).maybeSingle(),
      ]);
      if (error) return { error: MIGRATION };
      const rows = (qs ?? []) as Question[];
      const removing = resolve(rows, a.remove_questions);
      const candidates = questionsOf(a.add_questions ?? []);
      const bad = candidates.filter((q) => q.length < 8 || q.length > 300);
      if (bad.length) return { error: `Questions must be 8-300 characters: ${bad.map(quoted).join(", ")}.` };
      const remaining = rows.filter((q) => !removing.includes(q));
      const have = new Set(remaining.map((q) => q.prompt.toLowerCase()));
      const adding = candidates.filter((q) => !have.has(q.toLowerCase())), already = candidates.filter((q) => have.has(q.toLowerCase()));
      const readded = adding.filter((q) => removing.some((r) => r.prompt.toLowerCase() === q.toLowerCase()));
      if (readded.length) return { error: `${readded.map(quoted).join(", ")} would be removed and added again, which deletes its answers. Leave it out of one of the lists.` };
      const room = MAX_PROMPTS - remaining.length;
      if (adding.length > room) return { error: `Only ${room} more questions fit (the limit is ${MAX_PROMPTS}); this would add ${adding.length}. Remove some first or add fewer.` };

      const settings = cl?.settings as { ai_search?: boolean } | null;
      const curEngines = enginesFrom(settings), curSearch = settings?.ai_search !== false;
      const wanted = a.engines ? ENGINE_KEYS.filter((e) => a.engines!.includes(e)) : null;
      const engines = wanted && wanted.join() !== curEngines.join() ? wanted : undefined;
      const webSearch = a.web_search !== undefined && a.web_search !== curSearch ? a.web_search : undefined;
      const skipped = [
        already.length ? `Already tracked, skipped: ${already.map(quoted).join(", ")}.` : "",
        wanted && !engines ? `The assistants are already ${names(curEngines)}.` : "",
        a.web_search !== undefined && webSearch === undefined ? `Claude's web search is already ${curSearch ? "on" : "off"}.` : "",
      ].filter(Boolean);
      if (!adding.length && !removing.length && !engines && webSearch === undefined) return { error: [...skipped, "Nothing to change."].join(" ") };

      const after = remaining.length + adding.length;
      const useEngines = engines ?? curEngines;
      const lines: string[] = [];
      if (adding.length) {
        lines.push(`Add ${plural(adding.length, "question")}:`, bullets(adding));
        lines.push(`Free to add. They are asked in the next weekly run, or with an AI visibility check now (about ${money(promptEstimate(useEngines))} per question).`);
      }
      if (removing.length) lines.push(`Stop tracking ${plural(removing.length, "question")}:`, bullets(removing.map((q) => q.prompt)), `Their stored answers are deleted too. This can't be undone.`);
      if (engines) {
        lines.push(`Assistants asked: ${names(curEngines)} → ${names(engines)} (about ${money(promptEstimate(curEngines))} → ${money(promptEstimate(engines))} per question, with the answer reading).`);
        const dfs = engines.filter((e) => ENGINES[e].via === "dataforseo");
        lines.push(`${dfs.length ? `${spoken(dfs)} ${dfs.length === 1 ? "answers" : "answer"} through DataForSEO, inside its daily API cap` : "No DataForSEO assistants"}${engines.includes("claude") ? "; Claude uses the Anthropic key" : ""}.`);
      }
      if (webSearch !== undefined) {
        lines.push(webSearch ? "Claude's web search: off → on. Answers are more realistic; about 5 cents per question instead of under 1 cent."
          : "Claude's web search: on → off. Claude answers from its own knowledge: under 1 cent per question instead of about 5 cents, but less like what customers see.");
        if (!useEngines.includes("claude")) lines.push("Claude isn't among the assistants asked, so this only matters once Claude is switched on.");
      }
      if (engines || adding.length || removing.length) lines.push(`Weekly checks for ${plural(after, "question")}: about ${money(after * promptEstimate(useEngines))} a week.`);
      lines.push(...skipped);

      const parts = [adding.length ? `add ${plural(adding.length, "question")}` : "", removing.length ? `remove ${removing.length}` : "", engines ? "change assistants" : "", webSearch !== undefined ? `Claude web search ${webSearch ? "on" : "off"}` : ""].filter(Boolean);
      const title = parts.length > 1 ? `AI visibility: ${parts.join(", ")}`
        : adding.length ? `Track ${plural(adding.length, "new AI visibility question")}`
        : removing.length ? (removing.length === 1 ? `Stop tracking “${removing[0].prompt.slice(0, 80)}”` : `Stop tracking ${removing.length} AI visibility questions`)
        : engines ? `Ask ${spoken(engines)} in AI visibility checks`
        : `Turn Claude's web search ${webSearch ? "on" : "off"} for AI visibility`;
      return {
        title, detail: lines.join("\n"),
        input: { add_questions: adding.length ? adding : undefined, remove_questions: removing.length ? removing.map((q) => q.id) : undefined, engines, web_search: webSearch },
      };
    },
    async execute(x, a): Promise<ExecResult> {
      const done: string[] = [], failed: string[] = [];
      const note = (r: { ok: true; message: string } | { ok: false; error: string }) => (r.ok ? done.push(r.message) : failed.push(r.error));
      if (a.remove_questions?.length) {
        const { data } = await x.admin.from("ai_prompts").select("id, prompt").eq("client_id", x.client.id).in("id", a.remove_questions);
        const gone: string[] = [];
        for (const q of (data ?? []) as Question[]) {
          const r = await removeAiPrompt(q.id);
          if (r.ok) gone.push(quoted(q.prompt)); else failed.push(`${quoted(q.prompt)}: ${r.error}`);
        }
        if (gone.length) done.push(`Stopped tracking ${gone.join(", ")}.`);
      }
      if (a.add_questions?.length) {
        const { data } = await x.admin.from("ai_prompts").select("prompt").eq("client_id", x.client.id);
        const have = new Set((data ?? []).map((q) => String(q.prompt).toLowerCase()));
        const list = a.add_questions.filter((q) => !have.has(q.toLowerCase()));
        if (list.length) note(await addAiPrompts(list.join("\n")));
      }
      if (a.engines) note(await setAiEngines(a.engines));
      if (a.web_search !== undefined) note(await setAiSearch(a.web_search));
      if (!done.length && !failed.length) return { ok: true, message: "Nothing needed changing: it was already done.", paths: PATHS };
      return { ok: !failed.length, message: [...done, ...failed.map((f) => `Not done: ${f}`)].join(" "), paths: PATHS };
    },
  }),

  write({
    name: "run_ai_visibility_check",
    description: "Ask the tracked AI visibility questions to the selected assistants now (paid: DataForSEO plus Claude, the per-question cost get_ai_visibility shows). Only questions not asked in the last week, unless recheck_all.",
    schema: z.object({ recheck_all: z.boolean().default(false).describe("also re-ask questions asked this week") }),
    async prepare(ctx, a) {
      const aiOff = await aiUnavailable(ctx.client.id);
      if (aiOff) return { error: aiOff };
      const target = await readTarget(ctx.admin, ctx.client.id);
      if (!target) return { error: NO_TARGET };
      // the same selection runAiChecks() makes
      const [{ data: qs, error }, { data: last }, { data: cl }, { data: topics }, budget] = await Promise.all([
        ctx.admin.from("ai_prompts").select("id, prompt").eq("client_id", ctx.client.id).order("created_at").limit(MAX_PROMPTS),
        ctx.admin.from("ai_checks").select("prompt_id, checked_on").eq("client_id", ctx.client.id).order("checked_on", { ascending: false }).limit(2000),
        ctx.admin.from("clients").select("settings").eq("id", ctx.client.id).maybeSingle(),
        ctx.admin.from("dfs_cache").select("endpoint, fetched_at").eq("client_id", ctx.client.id).in("endpoint", TOPICS),
        dfsBudget(ctx.admin, ctx.client.id),
      ]);
      if (error) return { error: MIGRATION };
      const total = (qs ?? []).length;
      if (!total) return { error: "No AI visibility questions are tracked yet. Add some first." };
      const lastOn = new Map<string, string>();
      for (const r of last ?? []) if (!lastOn.has(r.prompt_id as string)) lastOn.set(r.prompt_id as string, r.checked_on as string);
      const cutoff = dueCutoff();
      const due = (qs ?? []).filter((q) => { const d = lastOn.get(q.id as string); return !d || d <= cutoff; }).length;
      const n = a.recheck_all ? total : due;
      const settings = cl?.settings as { ai_search?: boolean } | null;
      const engines = enginesFrom(settings), dfsOn = await dfsConfigured(ctx.client.id);
      const asked = dfsOn ? engines : engines.filter((e) => ENGINES[e].via === "anthropic");
      if (!asked.length) return { error: "Only DataForSEO assistants are selected and DataForSEO isn't set up for this organization. Switch Claude on first." };
      const perQ = promptEstimate(asked);
      if (!n) return { error: `All ${plural(total, "question")} were asked in the last week (latest ${[...lastOn.values()].sort().at(-1)}). Nothing is due; set recheck_all to ask them all again (about ${money(Math.min(total * perQ, RUN_COST_LIMIT))}).` };
      const dfsEngines = asked.filter((e) => ENGINES[e].via === "dataforseo");
      const dfsPerQ = dfsEngines.reduce((s, e) => s + ENGINES[e].est, 0);
      // the AI market view refreshes after the questions: both platforms when forced, else those older than a week
      const marketN = !dfsOn ? 0 : a.recheck_all ? LLM_PLATFORMS.length : LLM_PLATFORMS.filter((p) => ageDays(topics?.find((t) => t.endpoint === `llm_topic_${p}`)?.fetched_at as string | undefined) >= 7).length;
      // checkPrompt() skips the DataForSEO assistants for a question once the cap is reached (Claude still answers)
      const claude = asked.includes("claude");
      const dfsNone = dfsEngines.length > 0 && budget.left < dfsPerQ;
      if (dfsNone && !claude) return { error: budget.exhausted };
      const dfsSome = dfsEngines.length > 0 && !dfsNone && budget.left < dfsPerQ * n;
      const marketShort = marketN > 0 && budget.left < dfsPerQ * n + marketN * LLM_EST;
      const est = n * perQ;
      const runN = Math.min(n, PER_RUN);
      return {
        title: a.recheck_all ? `Re-ask all ${n} AI visibility questions now` : `Ask ${plural(n, "due AI visibility question")} now`,
        detail: [
          `Asks ${plural(n, "question")} to ${spoken(asked)}: about ${money(perQ)} per question with the brand and sentiment reading, up to ${money(Math.min(est, RUN_COST_LIMIT))}${est > RUN_COST_LIMIT ? ` (one run stops at ${money(RUN_COST_LIMIT)} for this client)` : ""}.`,
          claude ? `Claude answers ${settings?.ai_search !== false ? "with live web search" : "from its own knowledge (web search is off)"}; Claude and the answer reading are billed to the Anthropic key.` : "The answer reading is billed to the Anthropic key.",
          dfsEngines.length ? `${spoken(dfsEngines)} ${dfsEngines.length === 1 ? "answers" : "answer"} through DataForSEO (about ${money(dfsPerQ * n)}), inside its daily API cap.` : "",
          !dfsOn && engines.length > asked.length ? "DataForSEO isn't configured on the server, so only Claude is asked." : "",
          marketN ? `Afterwards the AI market view (${LLM_PLATFORMS.map((p) => LLM_LABEL[p]).join(" and ")}) is refreshed: about ${money(marketN * LLM_EST)}.` : "",
          !a.recheck_all && total > n ? `${plural(total - n, "question")} asked in the last week ${total - n === 1 ? "is" : "are"} skipped.` : "",
          `Questions are asked one at a time (about ${QUESTION_SECONDS} seconds each) and a run stops after about ${Math.round(RUN_SECONDS / 60)} minutes${n > PER_RUN ? `: about ${PER_RUN} finish now, so run it again without recheck_all for the rest` : ""}.`,
          dfsEngines.length || marketN ? budget.line : "",
          dfsNone ? "DataForSEO's limit for today is used up, so only Claude would answer." : "",
          dfsSome ? `The remaining DataForSEO limit (${money(budget.left)}) covers the ${spoken(dfsEngines)} answers for about ${plural(Math.floor(budget.left / dfsPerQ), "question")}; after that ${claude ? "only Claude answers" : "the run stops"}.` : "",
          marketShort && !dfsNone ? "The AI market view is skipped if the limit is reached first." : "",
        ].filter(Boolean).join("\n"),
        expectSeconds: runN * QUESTION_SECONDS + (marketN ? 10 : 0) + 5,
      };
    },
    async execute(_x, a) {
      return fromAction(await runAiVisibilityNow(a.recheck_all), "AI visibility checked.", PATHS);
    },
  }),

  write({
    name: "refresh_ai_brand_lookup",
    description: `Fetch the AI brand lookup now (paid DataForSEO, ${money(BRAND_EST)} per lookup, up to ${LOOKUPS.length}): how often real ChatGPT and Google AI Overview answers name the brand and up to 3 competitor brands. Parts under a week old are reused.`,
    schema: z.object({}),
    async prepare(ctx) {
      if (!(await dfsConfigured(ctx.client.id))) return { error: DFS_NOT_CONFIGURED };
      const target = await readTarget(ctx.admin, ctx.client.id);
      if (!target) return { error: NO_TARGET };
      const [brands, { data: rows }, budget] = await Promise.all([
        brandNamesFor(ctx.admin, ctx.client.id, target.domain.replace(/^www\./, "")),
        ctx.admin.from("dfs_cache").select("endpoint, fetched_at, params").eq("client_id", ctx.client.id).in("endpoint", LOOKUPS),
        dfsBudget(ctx.admin, ctx.client.id),
      ]);
      if (brands.length < 2) return { error: "No competitor brands to compare yet: they come from AI visibility answers or Business Profile competitors." };
      // refreshBrandLookup() reuses a stored answer for the same brands that is under a week old (the history only depends on the client's own brand)
      const extra = brands.join("|");
      const fresh = (ep: string) => (rows ?? []).some((r) => {
        const got = String((r.params as { competitor?: string } | null)?.competitor ?? "");
        return r.endpoint === ep && (ep === "llm_brand_history" ? got.split("|")[0] === brands[0] : got === extra) && ageDays(r.fetched_at as string) < 7;
      });
      const stale = LOOKUPS.filter((ep) => !fresh(ep));
      const updated = (rows ?? []).map((r) => String(r.fetched_at)).sort().at(-1)?.slice(0, 10);
      if (!stale.length) return { error: `The brand lookup for ${brands.join(", ")} is under a week old (updated ${updated}); nothing would be fetched. It refreshes weekly by itself.` };
      if (budget.left < BRAND_EST) return { error: budget.exhausted };
      return {
        title: `Fetch the AI brand lookup for ${brands[0]} and ${plural(brands.length - 1, "competitor")}`,
        detail: [
          `Brands: ${brands[0]} (you), ${brands.slice(1).join(", ")}.`,
          `${plural(stale.length, "DataForSEO lookup")} at ${money(BRAND_EST)} ≈ ${money(stale.length * BRAND_EST)}${stale.length < LOOKUPS.length ? ` (${LOOKUPS.length - stale.length} still fresh and reused)` : ""}: ChatGPT answers naming each as a brand, the names in ChatGPT and Google AI Overview answers, and your brand's monthly trend.`,
          updated ? `Last updated ${updated}.` : "",
          budget.line,
        ].filter(Boolean).join("\n"),
        // stored lookups show about 12 s per call, one after another
        expectSeconds: stale.length * 12 + 3,
      };
    },
    async execute() {
      return fromAction(await refreshBrandLookupNow(), "Brand lookup updated.", PATHS);
    },
  }),
];
