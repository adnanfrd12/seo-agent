import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { z } from "zod";
import { aiErrorMessage, anthropic } from "@/lib/ai/claude";
import { brief, briefForChat, briefText } from "@/lib/ai/intelligence";
import { getSession } from "@/lib/analytics/client-context";
import { todayIn } from "@/lib/analytics/range";
import { clientSettings } from "@/lib/aiqw/run";
import { callCost } from "@/lib/aiqw/settings";
import { claudeMonthSpend, recordAskCost } from "@/lib/aiqw/store";
import { runTool, toolDefinitions, type NovaCtx, type ToolOutcome } from "@/lib/nova/tools";
import { monthLabel, monthOf } from "@/lib/roadmap/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const body = z.object({
  conversationId: z.uuid().nullable().optional(),
  message: z.string().trim().min(1).max(4000),
  /** the dashboard page open while chatting (label is display text only; data is chosen from the path on the server) */
  page: z.object({ path: z.string().regex(/^\/[A-Za-z0-9_\-/]{0,150}$/), label: z.string().trim().max(120), text: z.string().max(8000).optional() }).nullable().optional(),
});
type Action = { tool: string; ok: boolean; summary: string; detail?: string };
class Done extends Error {}
/** The API needs the conversation to start with a user turn. */
const fromUser = (ms: Anthropic.MessageParam[]) => { const i = ms.findIndex((m) => m.role === "user"); return i < 0 ? ms : ms.slice(i); };

function system(name: string, clientName: string, role: string, canEdit: boolean, today: string, page: { path: string; label: string } | null) {
  return `You are Nova, the AI SEO strategist inside the SEO Insights dashboard, working alongside ${name || "the user"} on the client "${clientName}".

Today is ${today}; the current roadmap month is ${monthLabel(monthOf(today))}. The user's role is ${role}${canEdit ? "" : " (view-only: you can read and explain everything, and mark roadmap tasks done, but not make other changes)"}.

${page ? `The user has the dashboard page "${page.label.replace(/["\n]/g, " ")}" (${page.path}) open. Call get_page_data only when the question is about that page ("this page", "this screen", "here", or what they see on it); otherwise don't bring the page up.\n\n` : ""}What you do: answer questions about the client's data, analyse performance, compare competitors, find problems and opportunities, write strategies, and run the dashboard for the user through your tools: the SEO roadmap, AI quick wins and AI analyses, rank tracking, AI visibility, competitors and brand terms, Search Console and GA4 setup, alerts, reviews, research and audit runs, the SEO Toolkit, the blog, social media, data syncs, PDF imports and client settings. The user should be able to manage everything by chatting with you.

Rules:
- Answer exactly what the user asked, at the depth they asked. Don't volunteer a data summary they didn't ask for. Use tools only when the answer needs data that isn't in the brief; call independent tools together in one turn.
- Everything you write is shown to the user. Before calling tools write nothing, or one short sentence addressed to the user (e.g. "Let me check your Search Console pages."). Never write notes to yourself.
- Ground everything in the client's data: the evidence brief below, or what your tools return. Never invent metrics, pages, keywords, competitors, findings or results. If the data isn't there, say what is missing and what to connect.
- Changes: every create, update, delete or run is prepared by a tool and happens only after the user presses Confirm in the chat. Prepare everything the request needs in one go (use the bulk tools so one Confirm covers many items), then say in one short line what is waiting for their confirmation. Never say a change was made until a later message shows it was confirmed; if a tool returns an error, say plainly that it didn't work.
- Before changing records, read them to get real ids and current values; avoid duplicates. For paid runs, state the cost the tool reports.
- Before suggesting a paid research, audit or local run, check get_seo_data_status: stored data may be fresh enough, and it shows what's left of today's DataForSEO limit.
- Roadmap: find task ids with search_roadmap_tasks; for several tasks use the bulk tools and move_roadmap_tasks (e.g. carrying unfinished work to next month) so the user confirms once.
- Brand names: set_brand_terms is the client's brand list (AI visibility, branded vs non-branded split); the Search Console "brand" list (update_search_console_lists) only changes the Search Console screens. When the user asks to change "the brand terms" without saying where, update both.
- When you add roadmap tasks, make them specific to this client (why, with the numbers; concrete steps; affected pages and keywords from the data; a due date in the month).
- Small numbers are noise; estimates (DataForSEO) are estimates; effects are hypotheses, never guarantees.
- Write clearly for a business owner: short paragraphs, bullet lists, and tables for comparisons. Use Markdown. Keep answers focused; no filler.`;
}

/** Greetings, thanks and "who are you": answered quickly without loading the client's data or tools. */
const SMALL_TALK = /^(hi+|hello+|hey+|hiya|howdy|yo|good (morning|afternoon|evening|day)|thanks?( a lot| so much| very much)?|thank you( so much| very much)?|thx|ty|bye|goodbye|see you|how are you( doing)?|how'?s it going|what'?s up|who are you|what can you do|what do you do)[\s!.?,]*$/i;
/** Questions that deserve deeper reasoning; everything else is answered at low effort, which is much faster. */
const DEEP = /\b(strateg\w*|plan(s|ning)?|audit\w*|analy[sz]\w*|diagnos\w*|forecast\w*|compar\w*|prioriti[sz]\w*|why (did|is|are|has|have)|root cause|deep dive)\b/i;

function smallTalkSystem(name: string, clientName: string, canEdit: boolean) {
  return `You are Nova, the AI SEO strategist inside the SEO Insights dashboard, talking with ${name || "the user"} about the client "${clientName}".
Reply naturally and briefly (1-3 sentences) to greetings, thanks or questions about yourself. When it fits, mention in one short line what you can help with: questions about their analytics and search performance, competitors, ideas and strategies, and ${canEdit ? "running the dashboard by chat (roadmap, rank tracking, AI quick wins, audits and more), always with their confirmation" : "explaining the SEO roadmap and their data"}. Don't quote any numbers or data here. Plain text, no headings.`;
}

/** Puts a cache breakpoint on the last block of a user message (at most one rolling breakpoint besides the fixed ones). */
function cacheLast(m: Anthropic.MessageParam): Anthropic.MessageParam {
  if (typeof m.content === "string") return { ...m, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] };
  const blocks = [...m.content];
  const last = blocks[blocks.length - 1];
  if (last && (last.type === "text" || last.type === "tool_result")) blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
  return { ...m, content: blocks };
}
function uncache(m: Anthropic.MessageParam): Anthropic.MessageParam {
  if (typeof m.content === "string") return m;
  return { ...m, content: m.content.map((b) => ("cache_control" in b && b.cache_control ? (({ cache_control: _c, ...rest }) => { void _c; return rest; })(b) as typeof b : b)) };
}

export async function POST(req: Request) {
  const { client, user } = await getSession();
  if (!client) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Write a message (up to 4,000 characters)." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });

  const admin = createAdminClient();
  const smallTalk = SMALL_TALK.test(p.data.message.trim());
  // start reading the data brief now (in parallel with the checks below); a stale one is rebuilt after the answer
  const briefP = briefForChat(admin, client.id, client.timezone);
  briefP.catch(() => undefined);
  after(async () => {
    const r = await briefP.catch(() => null);
    if (r?.refresh) await brief(admin, client.id, client.timezone, { fresh: true }).catch(() => undefined);
  });

  let conversationId = p.data.conversationId ?? null;
  const [{ settings }, spent, owned, db] = await Promise.all([
    clientSettings(admin, client.id),
    claudeMonthSpend(admin, client.id),
    // the conversation must belong to this user and client
    conversationId ? admin.from("nova_conversations").select("id").eq("id", conversationId).eq("client_id", client.id).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    createClient(),
  ]);
  if (spent >= settings.monthlyBudget) return Response.json({ error: `The monthly Claude budget ($${settings.monthlyBudget}) is used up. An owner can raise it in AI Quick Wins → Settings.` }, { status: 402 });
  if (!owned.data) conversationId = null;
  if (!conversationId) {
    const { data, error } = await admin.from("nova_conversations").insert({ client_id: client.id, user_id: user.id, title: p.data.message.replace(/\s+/g, " ").slice(0, 80) }).select("id").single();
    if (error) return Response.json({ error: "Could not start the conversation (apply migration 20261125000025)." }, { status: 500 });
    conversationId = data.id as string;
  }
  const convId = conversationId;
  const { data: past } = p.data.conversationId && owned.data
    ? await admin.from("nova_messages").select("role, content, actions").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(16)
    : { data: [] as { role: string; content: string; actions: unknown }[] };
  // saved while the answer streams; awaited before the answer is saved so the order is kept
  const userSaved = admin.from("nova_messages").insert({ conversation_id: convId, client_id: client.id, user_id: user.id, role: "user", content: p.data.message });

  const history: Anthropic.MessageParam[] = (past ?? []).reverse().filter((m) => m.content || (m.actions as Action[]).length).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.role === "assistant" && (m.actions as Action[]).length ? `${m.content}\n\n[Actions: ${(m.actions as Action[]).map((a) => `${a.ok ? "✓" : "✗"} ${a.summary}`).join("; ")}]` : m.content || "(no text)",
  }));
  // the API needs strictly alternating turns that start with the user
  const messages: Anthropic.MessageParam[] = [];
  for (const m of [...history, { role: "user" as const, content: p.data.message }]) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else if (messages.length || m.role === "user") messages.push({ ...m });
  }

  const ctx: NovaCtx = {
    admin, db, client: { id: client.id, name: client.name, timezone: client.timezone, role: client.role },
    userId: user.id, conversationId: convId, canEdit: ["owner", "admin"].includes(client.role), brief: async () => (await briefP).brief, page: p.data.page ?? null,
  };
  const today = todayIn(client.timezone);
  const firstName = (user.fullName ?? "").split(" ")[0];
  const tools = toolDefinitions();
  const effort = DEEP.test(p.data.message) || p.data.message.length > 400 ? "medium" : "low";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Record<string, unknown>) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`)); } catch { /* client went away */ } };
      send({ t: "start", conversationId: convId });
      let text = "", cost = 0;
      const actions: Action[] = [];
      try {
        if (smallTalk) {
          const s = anthropic().messages.stream({
            model: settings.model, max_tokens: 400, output_config: { effort: "low" },
            system: smallTalkSystem(firstName, client.name, ctx.canEdit), messages: fromUser(messages.slice(-6)),
          }, { signal: req.signal });
          s.on("text", (delta) => { text += delta; send({ t: "text", v: delta }); });
          cost += callCost(settings.model, (await s.finalMessage()).usage);
          throw new Done();
        }
        const b = (await briefP).brief;
        const sys: Anthropic.TextBlockParam[] = [
          { type: "text", text: system(firstName, client.name, client.role, ctx.canEdit, today, ctx.page) },
          { type: "text", text: `CLIENT DATA BRIEF (compact evidence package; ask tools for detail):\n${briefText(b)}`, cache_control: { type: "ephemeral" } },
        ];
        // cache the conversation up to the new question, so the next message reuses it
        messages[messages.length - 1] = cacheLast(messages[messages.length - 1]);
        let rolling: number | null = null;
        for (let turn = 0; turn < 8; turn++) {
          const s = anthropic().messages.stream({
            model: settings.model, max_tokens: 8000, thinking: { type: "adaptive" }, output_config: { effort },
            system: sys, tools, messages,
          }, { signal: req.signal });
          s.on("text", (delta) => { text += delta; send({ t: "text", v: delta }); });
          const msg = await s.finalMessage();
          cost += callCost(settings.model, msg.usage);
          if (msg.stop_reason === "refusal") { send({ t: "text", v: "\n\nI can't help with that request." }); text += "\n\nI can't help with that request."; break; }
          if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
          const uses = msg.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
          if (!uses.length) break;
          if (msg.stop_reason === "max_tokens") { send({ t: "text", v: "\n\n(The answer was cut off.)" }); break; }
          messages.push({ role: "assistant", content: msg.content });
          // independent tools run together; results keep the model's order
          for (const u of uses) send({ t: "tool", id: u.id, name: u.name, status: "running" });
          const outs: ToolOutcome[] = await Promise.all(uses.map(async (u) => {
            const out = await runTool(ctx, u.name, u.input);
            if (out.action) send({ t: "tool", id: u.id, name: u.name, status: out.action.ok && !out.isError ? "done" : "failed", summary: out.action.summary });
            else send({ t: "tool", id: u.id, name: u.name, status: out.isError ? "failed" : "done" });
            return out;
          }));
          const results: Anthropic.ToolResultBlockParam[] = uses.map((u, i) => {
            const out = outs[i];
            if (out.action) actions.push(out.action);
            if (out.confirm) send({ t: "confirm", ...out.confirm });
            if (out.changed) send({ t: "changed" });
            return { type: "tool_result", tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
          });
          // one rolling breakpoint on the newest tool results (the question's breakpoint stays): at most 3 in use
          if (rolling !== null) messages[rolling] = uncache(messages[rolling]);
          messages.push(cacheLast({ role: "user", content: results }));
          rolling = messages.length - 1;
          if (text && !text.endsWith("\n")) { text += "\n\n"; send({ t: "text", v: "\n\n" }); }
        }
      } catch (e) {
        if (e instanceof Done) { /* answered */ }
        else if (!(e instanceof Anthropic.APIUserAbortError)) {
          const m = aiErrorMessage(e);
          send({ t: "error", message: m });
          if (!text) text = `(${m})`;
        }
      }
      cost = Number(cost.toFixed(4));
      await userSaved;
      const [{ data: saved }] = await Promise.all([
        admin.from("nova_messages").insert({ conversation_id: convId, client_id: client.id, user_id: user.id, role: "assistant", content: text.trim(), actions, cost_usd: cost }).select("id").single(),
        admin.from("nova_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId),
        cost > 0 ? recordAskCost(admin, client.id, cost).catch(() => undefined) : null,
      ]);
      send({ t: "done", conversationId: convId, messageId: saved?.id ?? null });
      try { controller.close(); } catch { /* closed */ }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
