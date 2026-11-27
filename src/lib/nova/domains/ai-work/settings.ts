import "server-only";
import { z } from "zod";
import { fetchKeywordData, saveAiSettings } from "@/app/(dashboard)/ai-quick-wins/actions";
import { claudeUsage } from "@/lib/ai/usage";
import { dfsMonthSpend, loadKw } from "@/lib/aiqw/dfs";
import { sourceStatus } from "@/lib/aiqw/platforms";
import { clientSettings } from "@/lib/aiqw/run";
import { DFS_FEATURES, EFFORTS, MODELS, type AiQwSettings, type BusinessProfile, type DfsFeature, type ModelId } from "@/lib/aiqw/settings";
import { claudeMonthSpend } from "@/lib/aiqw/store";
import { SOURCE_LABEL, SOURCES } from "@/lib/aiqw/types";
import { DFS_NOT_CONFIGURED, dfsConfigured } from "@/lib/dataforseo/client";
import { bullets, fromAction, json, read, write, type NovaTool } from "../../kit";
import { clip, storedSettings, usd } from "./util";

/** The "AI and data" settings (clients.settings.ai_qw) and the Keywords screen's DataForSEO fetch. */

const MODEL_IDS = Object.keys(MODELS) as [ModelId, ...ModelId[]];
const DFS_KEYS = Object.keys(DFS_FEATURES) as DfsFeature[];
const BUSINESS_KEYS = ["name", "services", "towns", "phone", "certifications", "tone"] as const satisfies readonly (keyof BusinessProfile)[];
const FEATURE: Record<DfsFeature, string> = { volume: "search volume", serp: "live Google results", competitors: "competitor keyword gap", backlinks: "backlink gap", onpage: "on-page issues", local: "Business Profile and map pack" };
const BUDGET_USERS = "Nova, AI Quick Wins runs, SEO roadmap generation, blog post reading and toolkit AI";
/** Keywords screen: top 300 Search Console queries, DataForSEO Labs keyword overview (~$0.01 a request + $0.0001 a keyword, see lib/dataforseo/rank.ts). */
const KW_TOP = 300, LABS_REQUEST = 0.01, LABS_KEYWORD = 0.0001;

const modelText = (m: ModelId) => `${MODELS[m].label} ($${MODELS[m].input} / $${MODELS[m].output} per million input / output tokens)`;
const onOff = (v: boolean) => (v ? "on" : "off");

const patchSchema = z.object({
  model: z.enum(MODEL_IDS).optional().describe("used by Nova and AI Quick Wins runs"),
  effort: z.enum(EFFORTS).optional(),
  monthly_claude_budget: z.number().min(0).max(1000).optional().describe("dollars per calendar month; 0 = no Claude runs"),
  monthly_dataforseo_limit: z.number().min(0).max(1000).optional().describe("dollars per month for quick wins' DataForSEO calls"),
  nightly_run: z.boolean().optional(),
  dataforseo_features: z.object(Object.fromEntries(DFS_KEYS.map((k) => [k, z.boolean().optional()])) as Record<DfsFeature, z.ZodOptional<z.ZodBoolean>>).optional()
    .describe(`turn features on or off: ${DFS_KEYS.map((k) => `${k} (${FEATURE[k]})`).join(", ")}`),
  location_name: z.string().trim().max(120).optional().describe('DataForSEO location, e.g. "Houston,Texas,United States"; "" = the research target'),
  language_code: z.string().trim().max(10).optional().describe('e.g. "en"; "" = the research target'),
  banned_words: z.array(z.string().trim().min(1).max(40)).max(50).optional().describe("the full list (replaces the current one)"),
  business: z.object({
    name: z.string().trim().max(120).optional(), services: z.string().trim().max(1000).optional(), towns: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(40).optional(), certifications: z.string().trim().max(500).optional(), tone: z.string().trim().max(300).optional(),
  }).optional().describe('facts Claude writes quick wins with; only the fields given change; "" = use the Business Profile'),
  email_recipients: z.array(z.string().trim().min(3).max(254)).max(10).optional().describe("email addresses for the morning email after the nightly run; the full list ([] = owners and admins)"),
});
type Patch = z.output<typeof patchSchema>;

const defined = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

/** The stored settings with the patch applied (lists replace, objects merge), normalised like the settings page saves them. */
function applyPatch(cur: AiQwSettings, a: Patch): AiQwSettings {
  return {
    ...cur,
    ...(a.model ? { model: a.model } : {}),
    ...(a.effort ? { effort: a.effort } : {}),
    ...(a.monthly_claude_budget !== undefined ? { monthlyBudget: a.monthly_claude_budget } : {}),
    ...(a.monthly_dataforseo_limit !== undefined ? { dfsMonthlyBudget: a.monthly_dataforseo_limit } : {}),
    ...(a.nightly_run !== undefined ? { nightly: a.nightly_run } : {}),
    dfs: { ...cur.dfs, ...defined(a.dataforseo_features) },
    ...(a.location_name !== undefined ? { locationName: a.location_name } : {}),
    ...(a.language_code !== undefined ? { languageCode: a.language_code } : {}),
    ...(a.banned_words ? { bannedWords: [...new Set(a.banned_words.map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 50) } : {}),
    business: { ...cur.business, ...defined(a.business) },
    ...(a.email_recipients ? { emailTo: [...new Set(a.email_recipients.map((e) => e.trim()))] } : {}),
  };
}

/** "Label: old → new" for every setting that changes. */
function changes(cur: AiQwSettings, next: AiQwSettings, profile: BusinessProfile): string[] {
  const out: string[] = [];
  const ch = <T,>(label: string, a: T, b: T, fmt: (v: T) => string) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${label}: ${fmt(a)} → ${fmt(b)}`); };
  ch("Claude model", cur.model, next.model, modelText);
  ch("Effort", cur.effort, next.effort, String);
  ch("Monthly Claude budget", cur.monthlyBudget, next.monthlyBudget, usd);
  ch("Monthly DataForSEO limit for quick wins", cur.dfsMonthlyBudget, next.dfsMonthlyBudget, usd);
  ch("Nightly run", cur.nightly, next.nightly, onOff);
  for (const k of DFS_KEYS) ch(`DataForSEO ${FEATURE[k]}`, cur.dfs[k], next.dfs[k], onOff);
  ch("DataForSEO location", cur.locationName, next.locationName, (v) => v || "(the research target's)");
  ch("DataForSEO language", cur.languageCode, next.languageCode, (v) => v || "(the research target's)");
  ch("Banned words", cur.bannedWords, next.bannedWords, (v) => (v.length ? v.join(", ") : "(none)"));
  for (const k of BUSINESS_KEYS) ch(`Business ${k}`, cur.business[k], next.business[k], (v) => (v ? `"${clip(v, 90)}"` : profile[k] ? `(empty: "${clip(profile[k], 60)}" from the Business Profile)` : "(empty)"));
  ch("Morning email recipients", cur.emailTo, next.emailTo, (v) => (v.length ? v.join(", ") : "(owners and admins)"));
  return out;
}

export const tools: NovaTool[] = [
  read({
    name: "get_ai_settings",
    description: "AI and data settings: Claude model and effort, monthly Claude budget and this month's spend, DataForSEO limit, spend and features, nightly run, banned words, business facts for Claude, morning email, and which data sources quick wins can use.",
    schema: z.object({}),
    async run(ctx) {
      const id = ctx.client.id;
      const [raw, { settings: eff }, spent, dfs, src, usage] = await Promise.all([
        storedSettings(ctx.admin, id), clientSettings(ctx.admin, id), claudeMonthSpend(ctx.admin, id), dfsMonthSpend(ctx.admin, id, true), sourceStatus(ctx.admin, id),
        // spend details are for owners and admins, as on the Integrations page
        ctx.canEdit ? claudeUsage(ctx.admin, id, ctx.client.timezone) : Promise.resolve(null),
      ]);
      return json({
        claude: {
          model: raw.model, model_name: modelText(raw.model), effort: raw.effort, used_by: "Nova and AI Quick Wins runs (insights, strategy and the roadmap use Claude Opus 5.5, the Coach Claude Sonnet 5.5)",
          monthly_budget: usd(raw.monthlyBudget), spent_toward_budget_this_month: usd(spent), left: usd(Math.max(0, raw.monthlyBudget - spent)),
          budget_applies_to: `${BUDGET_USERS} pause until next month when it's used up`,
          ...(usage ? { spend: { today: usd(usage.today), this_month_all_features: usd(usage.month), total: usd(usage.total), by_feature_all_time: usage.byFeature.slice(0, 10).map(([k, v]) => `${k}: ${usd(v)}`) } } : {}),
        },
        dataforseo: {
          configured: await dfsConfigured(id), monthly_limit_for_quick_wins: usd(raw.dfsMonthlyBudget), spent_this_month: usd(dfs),
          features: Object.fromEntries(DFS_KEYS.map((k) => [k, `${onOff(raw.dfs[k])}: ${DFS_FEATURES[k]}`])),
          location: raw.locationName || "(empty: the research target's)", language: raw.languageCode || "(empty: the research target's)",
        },
        nightly_run: raw.nightly ? "on: every night at 02:00 US Central (half price), then a morning email" : "off",
        morning_email_to: raw.emailTo.length ? raw.emailTo : "owners and admins (no list set)",
        banned_words: raw.bannedWords,
        business_facts_for_claude: Object.fromEntries(BUSINESS_KEYS.map((k) => [k, raw.business[k] || (eff.business[k] ? `(empty: uses "${clip(eff.business[k], 80)}" from the Business Profile)` : "(empty)")])),
        quick_win_sources: Object.fromEntries(SOURCES.map((s) => [s, `${SOURCE_LABEL[s]}: ${src[s]?.ok ? "available" : "not available"} · ${src[s]?.note ?? "no data"}`])),
      });
    },
    summary: () => "Read the AI settings",
  }),

  write({
    name: "update_ai_settings",
    description: "Change the AI and data settings: Claude model or effort, monthly Claude budget, DataForSEO monthly limit or features, nightly run, location/language, banned words, business facts, morning email. Only the fields given change.",
    schema: patchSchema,
    async prepare(ctx, a) {
      const badEmails = (a.email_recipients ?? []).filter((e) => !z.email().safeParse(e).success);
      if (badEmails.length) return { error: `Not an email address: ${badEmails.join(", ")}.` };
      const [cur, { settings: eff }, spent, dfs] = await Promise.all([storedSettings(ctx.admin, ctx.client.id), clientSettings(ctx.admin, ctx.client.id), claudeMonthSpend(ctx.admin, ctx.client.id), dfsMonthSpend(ctx.admin, ctx.client.id, true)]);
      const next = applyPatch(cur, a);
      const lines = changes(cur, next, eff.business);
      if (!lines.length) return { error: "Nothing to change: the settings already have those values." };
      const notes: string[] = [];
      if (next.model !== cur.model) notes.push("Nova (this chat) and the next AI Quick Wins runs use the new model.");
      if (next.monthlyBudget !== cur.monthlyBudget && spent >= next.monthlyBudget) notes.push(`This month's spend toward the budget is already ${usd(spent)}, so ${BUDGET_USERS} stop until next month, including this chat. Only the AI settings page can raise it again then.`);
      if (next.nightly && !cur.nightly) notes.push("The nightly run checks the whole site every night at 02:00 US Central with Claude (half price) and emails the top new quick wins; it spends from the monthly budget.");
      if (next.dfsMonthlyBudget !== cur.dfsMonthlyBudget && dfs >= next.dfsMonthlyBudget) notes.push(`DataForSEO for quick wins has already spent ${usd(dfs)} this month, so deep runs, the nightly run and the Keywords screen stop fetching until next month.`);
      return { title: "Update the AI and data settings", detail: [bullets(lines), ...notes].join("\n") };
    },
    async execute(x, a) {
      // applied to the settings as they are now, so other fields changed meanwhile are kept
      const next = applyPatch(await storedSettings(x.admin, x.client.id), a);
      return fromAction(await saveAiSettings(next), "Saved the AI and data settings.", ["/ai-quick-wins/settings", "/ai-quick-wins", "/integrations"]);
    },
  }),

  write({
    name: "fetch_quick_wins_keyword_data",
    description: "Fetch DataForSEO search volume, difficulty, intent and SERP features for the top 300 Search Console queries (AI Quick Wins → Keywords; paid, at most about $0.04; keywords fetched in the last 24 hours are skipped).",
    schema: z.object({}),
    async prepare(ctx) {
      const id = ctx.client.id;
      const [s, spent, src, kw] = await Promise.all([storedSettings(ctx.admin, id), dfsMonthSpend(ctx.admin, id, true), sourceStatus(ctx.admin, id), loadKw(ctx.admin, id)]);
      if (!(await dfsConfigured(id))) return { error: DFS_NOT_CONFIGURED };
      if (!s.dfs.volume) return { error: "Search volume is switched off in the AI settings (DataForSEO features). Turn it on with update_ai_settings first." };
      if (spent >= s.dfsMonthlyBudget) return { error: `The monthly DataForSEO limit for quick wins is used (${usd(spent)} of ${usd(s.dfsMonthlyBudget)}). Raise it with update_ai_settings first.` };
      if (!src.gsc.ok) return { error: "Connect Search Console first (Integrations)." };
      if (!src.dataforseo.ok) return { error: "Set a research target (the site's domain) for this client first." };
      const fresh = [...kw.values()].filter((k) => Date.now() - Date.parse(k.at) < 86_400_000).length;
      const latest = [...kw.values()].reduce((m, k) => (k.at > m ? k.at : m), "");
      return {
        title: "Fetch DataForSEO keyword data for the top Search Console queries",
        detail: bullets([
          `Search volume, difficulty, intent and SERP features for the ${KW_TOP} Search Console queries with the most impressions (28 days)`,
          `Only queries without data from the last 24 hours are fetched${fresh ? ` (${fresh} stored keywords are that fresh${latest ? `, last fetch ${latest.slice(0, 16).replace("T", " ")} UTC` : ""})` : ""}`,
          `Cost: about ${usd(LABS_REQUEST)} per request + ${usd(LABS_KEYWORD)} per keyword, at most about ${usd(LABS_REQUEST + KW_TOP * LABS_KEYWORD)}; within the monthly DataForSEO limit for quick wins (${usd(spent)} of ${usd(s.dfsMonthlyBudget)} used)`,
          "Shows on AI Quick Wins → Keywords and feeds the next quick-wins run",
        ]),
        expectSeconds: 30,
      };
    },
    async execute() {
      return fromAction(await fetchKeywordData(), "Fetched the keyword data.", ["/ai-quick-wins/keywords"]);
    },
  }),
];
