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
import { DEEP, SMALL_TALK, smallTalkSystem, novaSystem as system } from "@/lib/nova/prompt";
import { runTool, toolDefinitions, type NovaCtx, type ToolOutcome } from "@/lib/nova/tools";
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
